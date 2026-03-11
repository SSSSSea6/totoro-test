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

  const ensureSunrunExists = async () =>
    ensureCreditsRow({
      supabase,
      table: 'sunrun_credits',
      userId,
      initialCredits: INITIAL_BONUS,
    });

  if (action === 'get') {
    const backfill = await getOrInitCredits({
      supabase,
      table: 'backfill_run_credits',
      userId,
      initialCredits: INITIAL_BONUS,
    });
    if (!backfill.success) {
      return { success: false, message: backfill.message };
    }

    const sunrun = await ensureSunrunExists();
    if (!sunrun.success) {
      return { success: false, message: sunrun.message };
    }

    return { success: true, credits: backfill.credits };
  }

  if (action === 'redeem') {
    const res = await claimRedeemCodeAndAddCredits({
      supabase,
      codeTable: 'backfill_redeem_codes',
      creditsTable: 'backfill_run_credits',
      userId,
      code: normalizeText(body?.code),
      initialCredits: INITIAL_BONUS,
    });
    if (!res.success) {
      return { success: false, message: res.message };
    }

    const sunrun = await ensureSunrunExists();
    if (!sunrun.success) {
      return { success: false, message: sunrun.message };
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
