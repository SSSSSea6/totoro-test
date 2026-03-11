import { getSupabaseAdminClient, isSupabaseConfigured } from '../../utils/supabaseAdminClient';
import {
  authenticateCreditUser,
  claimRedeemCodeAndAddCredits,
  ensureCreditsRow,
  getOrInitCredits,
  normalizeText,
} from '../../utils/creditSecurity';

const INITIAL_BONUS = 1;

export default defineEventHandler(async (event) => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase 未配置' };
  }

  const body = await readBody(event);
  const action = normalizeText(body?.action).toLowerCase();
  const auth = await authenticateCreditUser(body?.userId, body?.token);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const userId = auth.userId;
  const supabase = getSupabaseAdminClient();

  const ensureBackfillExists = async () =>
    ensureCreditsRow({
      supabase,
      table: 'backfill_run_credits',
      userId,
      initialCredits: INITIAL_BONUS,
    });

  if (action === 'get') {
    const sunrun = await getOrInitCredits({
      supabase,
      table: 'sunrun_credits',
      userId,
      initialCredits: INITIAL_BONUS,
    });
    if (!sunrun.success) {
      return { success: false, message: sunrun.message };
    }

    const backfill = await ensureBackfillExists();
    if (!backfill.success) {
      return { success: false, message: backfill.message };
    }

    return { success: true, credits: sunrun.credits };
  }

  if (action === 'redeem') {
    const res = await claimRedeemCodeAndAddCredits({
      supabase,
      codeTable: 'sunrun_redeem_codes',
      creditsTable: 'sunrun_credits',
      userId,
      code: normalizeText(body?.code),
      initialCredits: INITIAL_BONUS,
    });
    if (!res.success) {
      return { success: false, message: res.message };
    }

    const backfill = await ensureBackfillExists();
    if (!backfill.success) {
      return { success: false, message: backfill.message };
    }

    return {
      success: true,
      message: `成功兑换 ${res.amount} 次`,
      credits: res.credits,
    };
  }

  if (action === 'consume' || action === 'refund') {
    return {
      success: false,
      message: '该接口已下线旧版扣减/返还动作，请刷新页面后重试',
    };
  }

  return { success: false, message: '未知操作' };
});
