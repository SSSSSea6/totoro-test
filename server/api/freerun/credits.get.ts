import { getHeader, getQuery } from 'h3';
import { getSupabaseAdminClient, isSupabaseConfigured } from '../../utils/supabaseAdminClient';
import { authenticateCreditUser, getOrInitCredits, normalizeText } from '../../utils/creditSecurity';

const INITIAL_KM = 1;

export default defineEventHandler(async (event) => {
  if (!isSupabaseConfigured()) {
    return { success: false, message: 'Supabase 未配置', credits: null, records: [] };
  }

  const query = getQuery(event);
  const headerToken = getHeader(event, 'x-totoro-token');
  const auth = await authenticateCreditUser(query.userId, query.token || headerToken);
  if (!auth.success) {
    return { success: false, message: auth.message, credits: null, records: [] };
  }

  const userId = auth.userId;
  const supabase = getSupabaseAdminClient();

  const credits = await getOrInitCredits({
    supabase,
    table: 'free_run_credits',
    userId,
    initialCredits: INITIAL_KM,
  });
  if (!credits.success) {
    return { success: false, message: credits.message, credits: null, records: [] };
  }

  const { data: records, error: recError } = await supabase
    .from('free_run_records')
    .select('distance_km, scantron_id, created_at')
    .eq('user_id', normalizeText(userId))
    .order('created_at', { ascending: false })
    .limit(10);

  if (recError && recError.code !== 'PGRST116') {
    return { success: false, message: recError.message, credits: credits.credits, records: [] };
  }

  return { success: true, credits: credits.credits, records: records || [] };
});
