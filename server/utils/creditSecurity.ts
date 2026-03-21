import type { SupabaseClient } from '@supabase/supabase-js';
import TotoroApiWrapper from '~~/src/wrappers/TotoroApiWrapper';

const TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;
const CREDIT_UPDATE_MAX_RETRY = 6;

const tokenOwnerCache = new Map<string, { userId: string; expiresAt: number }>();
const tokenOwnerPending = new Map<string, Promise<string>>();

const cleanupTokenCache = () => {
  const now = Date.now();
  for (const [token, value] of tokenOwnerCache.entries()) {
    if (value.expiresAt <= now) {
      tokenOwnerCache.delete(token);
    }
  }
};

export const normalizeText = (raw: unknown) => (typeof raw === 'string' ? raw.trim() : '');

export const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

const resolveTokenOwner = async (token: string) => {
  const cached = tokenOwnerCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.userId;
  }

  const pending = tokenOwnerPending.get(token);
  if (pending) {
    return pending;
  }

  const request = (async () => {
    const loginRes = (await TotoroApiWrapper.login({ token })) as any;
    const tokenOwner = normalizeText(loginRes?.stuNumber);
    if (!tokenOwner) {
      throw new Error('TOKEN_OWNER_MISSING');
    }

    tokenOwnerCache.set(token, {
      userId: tokenOwner,
      expiresAt: Date.now() + TOKEN_CACHE_TTL_MS,
    });

    return tokenOwner;
  })();

  tokenOwnerPending.set(token, request);

  try {
    return await request;
  } finally {
    if (tokenOwnerPending.get(token) === request) {
      tokenOwnerPending.delete(token);
    }
  }
};

export const authenticateCreditUser = async (rawUserId: unknown, rawToken: unknown) => {
  const userId = normalizeText(rawUserId);
  const token = normalizeText(rawToken);
  if (!userId) {
    return { success: false as const, message: '缺少 userId' };
  }
  if (!token) {
    return { success: false as const, message: '缺少 token' };
  }

  cleanupTokenCache();

  const cached = tokenOwnerCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    if (cached.userId !== userId) {
      return { success: false as const, message: 'userId 与 token 不匹配' };
    }
    return { success: true as const, userId };
  }

  try {
    const tokenOwner = await resolveTokenOwner(token);
    if (tokenOwner !== userId) {
      return { success: false as const, message: 'userId 与 token 不匹配' };
    }
    return { success: true as const, userId };
  } catch (error) {
    if ((error as Error).message === 'TOKEN_OWNER_MISSING') {
      return { success: false as const, message: 'token 校验失败，请重新扫码登录' };
    }
    return { success: false as const, message: 'token 已失效，请重新扫码登录' };
  }
};

type CreditsRowResult =
  | { success: true; credits: number }
  | { success: false; message: string };

export const getOrInitCredits = async ({
  supabase,
  table,
  userId,
  initialCredits,
}: {
  supabase: SupabaseClient;
  table: string;
  userId: string;
  initialCredits: number;
}): Promise<CreditsRowResult> => {
  const { data, error } = await supabase
    .from(table)
    .select('credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    return { success: false, message: error.message };
  }

  if (!error && data) {
    return { success: true, credits: Number(data.credits ?? 0) };
  }

  const now = new Date().toISOString();
  const { data: inserted, error: upsertError } = await supabase
    .from(table)
    .upsert({
      user_id: userId,
      credits: initialCredits,
      updated_at: now,
    })
    .select('credits')
    .single();

  if (upsertError) {
    return { success: false, message: upsertError.message };
  }

  return { success: true, credits: Number(inserted?.credits ?? initialCredits) };
};

export const ensureCreditsRow = async ({
  supabase,
  table,
  userId,
  initialCredits,
}: {
  supabase: SupabaseClient;
  table: string;
  userId: string;
  initialCredits: number;
}) => {
  const existing = await supabase
    .from(table)
    .select('credits')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing.error && existing.error.code !== 'PGRST116') {
    return { success: false as const, message: existing.error.message };
  }
  if (!existing.error && existing.data) {
    return { success: true as const };
  }

  const { error } = await supabase.from(table).upsert({
    user_id: userId,
    credits: initialCredits,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    return { success: false as const, message: error.message };
  }
  return { success: true as const };
};

export const adjustCreditsWithRetry = async ({
  supabase,
  table,
  userId,
  delta,
  initialCredits,
  minCredits = 0,
}: {
  supabase: SupabaseClient;
  table: string;
  userId: string;
  delta: number;
  initialCredits: number;
  minCredits?: number;
}) => {
  for (let i = 0; i < CREDIT_UPDATE_MAX_RETRY; i += 1) {
    const base = await getOrInitCredits({ supabase, table, userId, initialCredits });
    if (!base.success) {
      return { success: false as const, message: base.message };
    }

    const current = Number(base.credits ?? 0);
    const next = Number((current + delta).toFixed(4));
    if (!Number.isFinite(next)) {
      return { success: false as const, message: '次数计算异常' };
    }
    if (next < minCredits) {
      return {
        success: false as const,
        insufficient: true as const,
        credits: current,
        message: `次数不足（需 ${Math.abs(delta)}，剩余 ${current}）`,
      };
    }

    const now = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from(table)
      .update({ credits: next, updated_at: now })
      .eq('user_id', userId)
      .eq('credits', current)
      .select('credits')
      .maybeSingle();

    if (updateError && updateError.code !== 'PGRST116') {
      return { success: false as const, message: updateError.message };
    }

    if (updated) {
      return {
        success: true as const,
        credits: Number(updated.credits ?? next),
      };
    }
  }

  return { success: false as const, message: '并发冲突，请重试' };
};

export const claimRedeemCodeAndAddCredits = async ({
  supabase,
  codeTable,
  creditsTable,
  userId,
  code,
  initialCredits,
}: {
  supabase: SupabaseClient;
  codeTable: string;
  creditsTable: string;
  userId: string;
  code: string;
  initialCredits: number;
}) => {
  const now = new Date().toISOString();
  const normalizedCode = normalizeText(code).toUpperCase();
  if (!normalizedCode) {
    return { success: false as const, message: '缺少兑换码' };
  }

  const { data: claimed, error: claimError } = await supabase
    .from(codeTable)
    .update({ is_used: true, used_by: userId, used_at: now })
    .eq('code', normalizedCode)
    .eq('is_used', false)
    .select('amount')
    .maybeSingle();

  if (claimError) {
    return { success: false as const, message: claimError.message };
  }
  if (!claimed) {
    return { success: false as const, message: '兑换码无效或已使用' };
  }

  const amount = Number(claimed.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    // 兑换码异常，尽力回滚占用状态
    await supabase
      .from(codeTable)
      .update({ is_used: false, used_by: null, used_at: null })
      .eq('code', normalizedCode)
      .eq('used_by', userId)
      .eq('used_at', now);
    return { success: false as const, message: '兑换码金额异常' };
  }

  const creditRes = await adjustCreditsWithRetry({
    supabase,
    table: creditsTable,
    userId,
    delta: amount,
    initialCredits,
    minCredits: 0,
  });

  if (!creditRes.success) {
    // 加点失败，尽力回滚兑换码占用
    await supabase
      .from(codeTable)
      .update({ is_used: false, used_by: null, used_at: null })
      .eq('code', normalizedCode)
      .eq('used_by', userId)
      .eq('used_at', now);
    return { success: false as const, message: creditRes.message };
  }

  return {
    success: true as const,
    amount,
    credits: creditRes.credits,
  };
};
