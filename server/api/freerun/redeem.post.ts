import { getSupabaseAdminClient, isSupabaseConfigured } from '../../utils/supabaseAdminClient';
import {
  authenticateCreditUser,
  claimRedeemCodeAndAddCredits,
  normalizeText,
} from '../../utils/creditSecurity';

export default defineEventHandler(async (event) => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase 未配置' };
  }

  const body = await readBody(event);
  const auth = await authenticateCreditUser(body?.userId, body?.token);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const userId = auth.userId;
  const supabase = getSupabaseAdminClient();
  const res = await claimRedeemCodeAndAddCredits({
    supabase,
    codeTable: 'free_run_codes',
    creditsTable: 'free_run_credits',
    userId,
    code: normalizeText(body?.code),
    initialCredits: 0,
  });

  if (!res.success) {
    return { success: false, message: res.message };
  }

  return {
    success: true,
    message: `成功兑换 ${res.amount} 公里`,
    credits: res.credits,
  };
});
