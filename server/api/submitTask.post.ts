import { createClient } from '@supabase/supabase-js';
import {
  adjustCreditsWithRetry,
  authenticateCreditUser,
  isDateOnly,
  normalizeText,
} from '../utils/creditSecurity';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const buildJsonResponse = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });

const getShanghaiDateStr = () => {
  const now = new Date();
  const offsetMs = (8 * 60 + now.getTimezoneOffset()) * 60 * 1000;
  const shanghaiNow = new Date(now.getTime() + offsetMs);
  const y = shanghaiNow.getFullYear();
  const m = String(shanghaiNow.getMonth() + 1).padStart(2, '0');
  const d = String(shanghaiNow.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export default defineEventHandler(async (event) => {
  if (getMethod(event) === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const userData = await readBody<Record<string, any>>(event);
    if (!userData || typeof userData !== 'object') {
      return buildJsonResponse(400, { success: false, error: '请求体为空或格式错误' });
    }
    if (userData.reservedCredit === false) {
      return buildJsonResponse(400, { success: false, error: '无效请求：reservedCredit 必须为 true' });
    }

    const session = (userData as any).session || {};
    const stuNumber = normalizeText(session.stuNumber);
    const token = normalizeText(session.token);
    if (!stuNumber || !token) {
      return buildJsonResponse(400, { success: false, error: '缺少 session.stuNumber 或 session.token' });
    }

    const auth = await authenticateCreditUser(stuNumber, token);
    if (!auth.success) {
      return buildJsonResponse(401, { success: false, error: auth.message });
    }

    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return buildJsonResponse(500, { success: false, error: '缺少 Supabase 环境变量' });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const customDate = normalizeText((userData as any).customDate);
    const isBackfill = isDateOnly(customDate);
    const creditTable = isBackfill ? 'backfill_run_credits' : 'sunrun_credits';

    // 服务端再做一次幂等检查，避免直接刷接口重复入队
    if (isBackfill) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from('Tasks')
        .select('id')
        .in('status', ['PENDING', 'PROCESSING', 'SUCCESS'])
        .contains('user_data', { session: { stuNumber } })
        .eq('user_data->>customDate', customDate)
        .limit(1);

      if (duplicateError) {
        return buildJsonResponse(500, {
          success: false,
          error: `重复任务检查失败: ${duplicateError.message}`,
        });
      }

      if (Array.isArray(duplicate) && duplicate.length > 0) {
        return buildJsonResponse(409, { success: false, error: `日期 ${customDate} 已存在任务` });
      }
    } else {
      const today = getShanghaiDateStr();
      const dayStart = new Date(`${today}T00:00:00+08:00`).toISOString();
      const dayEnd = new Date(`${today}T23:59:59.999+08:00`).toISOString();

      const { data: duplicate, error: duplicateError } = await supabase
        .from('Tasks')
        .select('id')
        .in('status', ['PENDING', 'PROCESSING', 'SUCCESS'])
        .contains('user_data', { session: { stuNumber } })
        .gte('created_at', dayStart)
        .lte('created_at', dayEnd)
        .limit(1);

      if (duplicateError) {
        return buildJsonResponse(500, {
          success: false,
          error: `重复任务检查失败: ${duplicateError.message}`,
        });
      }

      if (Array.isArray(duplicate) && duplicate.length > 0) {
        return buildJsonResponse(409, { success: false, error: '今天已存在任务' });
      }
    }

    const consume = await adjustCreditsWithRetry({
      supabase,
      table: creditTable,
      userId: stuNumber,
      delta: -1,
      initialCredits: 1,
      minCredits: 0,
    });

    if (!consume.success) {
      const message = consume.insufficient
        ? isBackfill
          ? `补跑次数不足（剩余 ${consume.credits ?? 0}）`
          : `阳光跑次数不足（剩余 ${consume.credits ?? 0}）`
        : consume.message;

      return buildJsonResponse(409, {
        success: false,
        error: message,
        credits: consume.credits ?? null,
      });
    }

    const { data, error } = await supabase
      .from('Tasks')
      .insert([{ user_data: userData, status: 'PENDING' }])
      .select()
      .single();

    if (error) {
      const refund = await adjustCreditsWithRetry({
        supabase,
        table: creditTable,
        userId: stuNumber,
        delta: 1,
        initialCredits: 1,
        minCredits: 0,
      });

      const refundNote = refund.success ? '' : `；且次数回滚失败：${refund.message}`;
      return buildJsonResponse(500, {
        success: false,
        error: `任务入队失败：${error.message}${refundNote}`,
      });
    }

    return buildJsonResponse(202, {
      success: true,
      status: 'PENDING',
      taskId: data.id,
      credits: consume.credits,
    });
  } catch (error) {
    return buildJsonResponse(500, {
      success: false,
      error: `龙猫服务器错误 (Cloudflare): ${(error as Error).message}`,
    });
  }
});
