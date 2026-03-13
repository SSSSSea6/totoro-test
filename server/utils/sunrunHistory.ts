import TotoroApiWrapper from '~~/src/wrappers/TotoroApiWrapper';

export interface HistorySession {
  stuNumber: string;
  token: string;
  schoolId: string;
  campusId?: string;
}

interface ScoreItem {
  scoreId?: string;
  mileage?: string;
  usedTime?: string;
  runTime?: string;
  status?: string;
  calorie?: string;
  runType?: string;
  flag?: string;
}

export interface SunRunHistoryRecord {
  scoreId: string;
  date: string;
  runTime: string;
  mileage: string;
  usedTime: string;
  calorie: string;
  status: string;
  runType: string;
  flag: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (input: string, endOfDay = false) => {
  const suffix = endOfDay ? 'T23:59:59+08:00' : 'T00:00:00+08:00';
  return new Date(`${input}${suffix}`);
};

const isDateInRange = (datePart: string, start: Date, end: Date) => {
  if (!DATE_RE.test(datePart)) return false;
  const dateObj = parseDate(datePart);
  return !Number.isNaN(dateObj.getTime()) && dateObj >= start && dateObj <= end;
};

export const fetchSunRunHistory = async ({
  session,
  startDate,
  endDate,
}: {
  session?: HistorySession;
  startDate?: string;
  endDate?: string;
}) => {
  if (!session?.stuNumber || !session?.token || !session?.schoolId) {
    return { success: false as const, message: '缺少 session 信息', dates: [], records: [] };
  }

  if (!startDate || !endDate) {
    return { success: false as const, message: '缺少 startDate / endDate', dates: [], records: [] };
  }

  const start = parseDate(startDate);
  const end = parseDate(endDate, true);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return { success: false as const, message: '日期范围不合法', dates: [], records: [] };
  }

  const basicReq = {
    stuNumber: session.stuNumber,
    token: session.token,
    schoolId: session.schoolId,
    campusId: session.campusId ?? '',
  };

  const termResp = await TotoroApiWrapper.getSchoolTerm(basicReq);
  const terms = Array.isArray(termResp?.data) ? termResp.data : [];

  const records: SunRunHistoryRecord[] = [];

  for (const term of terms) {
    const termId = (term as any)?.termId || (term as any)?.id;
    if (!termId) continue;

    const monthResp = await TotoroApiWrapper.getSchoolMonthByTerm(termId, basicReq);
    const monthList = (monthResp as any)?.monthList || (monthResp as any)?.data || [];

    for (const month of monthList) {
      const monthId = (month as any)?.monthId || (month as any)?.id || (month as any)?.monthCode;
      if (!monthId) continue;

      try {
        const archResp = await TotoroApiWrapper.getSunRunArch(monthId, termId, basicReq);
        const scoreList = Array.isArray((archResp as any)?.data)
          ? ((archResp as any).data as ScoreItem[])
          : [];

        for (const score of scoreList) {
          const runTime = String(score.runTime || '').trim();
          if (!runTime) continue;

          const datePart = runTime.split(' ')[0] || '';
          if (!isDateInRange(datePart, start, end)) continue;

          records.push({
            scoreId: String(score.scoreId || ''),
            date: datePart,
            runTime,
            mileage: String(score.mileage || ''),
            usedTime: String(score.usedTime || ''),
            calorie: String(score.calorie || ''),
            status: String(score.status || ''),
            runType: String(score.runType || ''),
            flag: String(score.flag || ''),
          });
        }
      } catch (error) {
        console.warn('[history] getSunRunArch failed', monthId, (error as Error).message);
      }
    }
  }

  records.sort((a, b) => b.runTime.localeCompare(a.runTime));

  return {
    success: true as const,
    dates: Array.from(new Set(records.map((item) => item.date))),
    records,
  };
};
