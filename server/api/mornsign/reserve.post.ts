import { getSupabaseAdminClient, isSupabaseConfigured } from '../../utils/supabaseAdminClient';
import { adjustCreditsWithRetry, authenticateCreditUser } from '../../utils/creditSecurity';

export default defineEventHandler(async (event) => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase 未配置' };
  }

  const body = await readBody(event);
  const { token, userId, signPoint, scheduledTime, deviceInfo } = body || {};

  if (!token || !userId || !signPoint || !scheduledTime) {
    return { success: false, message: '缺少必要参数' };
  }

  const auth = await authenticateCreditUser(userId, token);
  if (!auth.success) {
    return { success: false, message: auth.message };
  }

  const supabase = getSupabaseAdminClient();
  const validatedUserId = auth.userId;

  const parsed = new Date(scheduledTime);
  if (Number.isNaN(parsed.getTime())) {
    return { success: false, message: '预约时间无效' };
  }
  const scheduledIso = parsed.toISOString();

  // 同一天仅可预约一次（按预约时间所在日）
  const startOfDay = new Date(parsed);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const { data: existsTask, error: existsError } = await supabase
    .from('morning_sign_tasks')
    .select('id')
    .eq('user_id', validatedUserId)
    .gte('scheduled_time', startOfDay.toISOString())
    .lte('scheduled_time', endOfDay.toISOString())
    .limit(1)
    .maybeSingle();

  if (!existsError && existsTask) {
    return { success: false, message: '同一天只能预约一次' };
  }

  const deduct = await adjustCreditsWithRetry({
    supabase,
    table: 'user_credits',
    userId: validatedUserId,
    delta: -1,
    initialCredits: 1,
    minCredits: 0,
  });

  if (!deduct.success) {
    if (deduct.insufficient) {
      return { success: false, message: '余额不足' };
    }
    return { success: false, message: `扣费失败，请重试: ${deduct.message}` };
  }

  const { error: insertError } = await supabase.from('morning_sign_tasks').insert({
    user_id: validatedUserId,
    token,
    device_info: deviceInfo || null,
    sign_point: signPoint,
    scheduled_time: scheduledIso,
    status: 'pending',
  });

  if (insertError) {
    const refund = await adjustCreditsWithRetry({
      supabase,
      table: 'user_credits',
      userId: validatedUserId,
      delta: 1,
      initialCredits: 1,
      minCredits: 0,
    });
    const refundNote = refund.success ? '' : `；且回滚余额失败：${refund.message}`;
    return { success: false, message: `预约失败: ${insertError.message}${refundNote}` };
  }

  return { success: true, message: '预约成功', scheduledTime: scheduledIso };
});
