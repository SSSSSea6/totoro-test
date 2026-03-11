import { getSupabaseAdminClient, isSupabaseConfigured } from '../../utils/supabaseAdminClient';
import {
  authenticateCreditUser,
  claimRedeemCodeAndAddCredits,
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

  if (action === 'get') {
    const credits = await getOrInitCredits({
      supabase,
      table: 'user_credits',
      userId,
      initialCredits: INITIAL_BONUS,
    });
    if (!credits.success) {
      return { success: false, message: credits.message };
    }

    return { success: true, credits: credits.credits };
  }

  if (action === 'redeem') {
    const res = await claimRedeemCodeAndAddCredits({
      supabase,
      codeTable: 'redemption_codes',
      creditsTable: 'user_credits',
      userId,
      code: normalizeText(body?.code),
      initialCredits: INITIAL_BONUS,
    });
    if (!res.success) {
      return { success: false, message: res.message };
    }

    return {
      success: true,
      message: `成功兑换 ${res.amount} 次`,
      credits: res.credits,
    };
  }

  return { success: false, message: '未知操作' };
});
