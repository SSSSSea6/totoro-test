import { fetchSunRunHistory, type HistorySession } from '../../utils/sunrunHistory';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody<{
      session?: HistorySession;
      startDate?: string;
      endDate?: string;
    }>(event);

    return await fetchSunRunHistory({
      session: body?.session,
      startDate: body?.startDate,
      endDate: body?.endDate,
    });
  } catch (error) {
    return {
      success: false,
      message: (error as Error).message,
      dates: [],
      records: [],
    };
  }
});
