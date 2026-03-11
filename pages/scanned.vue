<script setup lang="ts">
import type RunPoint from '~/src/types/RunPoint';
import { supabase, supabaseReady } from '~/src/services/supabaseClient';
import TotoroApiWrapper from '~/src/wrappers/TotoroApiWrapper';
import normalizeSession from '~/src/utils/normalizeSession';

interface HistoryRecord {
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

interface QueueSubmitResult {
  ok: boolean;
  taskId?: number;
  error?: string;
}

const sunrunPaper = useSunRunPaper();
const session = useSession();
const route = useRoute();
const hydratedSession = computed(() => normalizeSession(session.value || {}));
const SEMESTER_SUBMIT_GRACE_DAYS = 5;
const SEMESTER_BLOCK_MESSAGE = '本学期已结束或新学期未开始，请等待新学期开始后再跑步';

const selectValue = ref('');
const showBackfill = ref(route.query.mode === 'backfill');
const calendarMonthOffset = ref(0);
const selectedDates = ref<string[]>([]);
const completedDates = ref<string[]>([]);
const runHistoryRecords = ref<HistoryRecord[]>([]);
const historyDialog = ref(false);
const loadingHistory = ref(false);

const credits = ref(0);
const loadingCredits = ref(false);
const redeemDialog = ref(false);
const redeemCode = ref('');

const sunCredits = ref(0);
const loadingSunCredits = ref(false);
const sunRedeemDialog = ref(false);
const sunRedeemCode = ref('');

const submitted = ref(false);
const isSubmitting = ref(false);
const statusMessage = ref('');
const resultLog = ref('');
const taskIds = ref<number[]>([]);

const supabaseEnabled = computed(() => supabaseReady && Boolean(supabase));
const routeList = computed(() => sunrunPaper.value?.runPointList || []);
const target = computed<RunPoint | null>(
  () => routeList.value.find((item) => item.pointId === selectValue.value) || null,
);
const routeChosen = computed(() => Boolean(target.value));

watch(
  () => route.query.mode,
  (mode) => {
    showBackfill.value = mode === 'backfill';
    submitted.value = false;
    statusMessage.value = '';
    resultLog.value = '';
    taskIds.value = [];
    if (mode !== 'backfill') {
      selectedDates.value = [];
    }
  },
);

const formatDateOnly = (date: Date) => {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const getShanghaiDateStr = () => {
  const now = new Date();
  const offsetMs = (8 * 60 + now.getTimezoneOffset()) * 60 * 1000;
  const shanghaiNow = new Date(now.getTime() + offsetMs);
  return formatDateOnly(shanghaiNow);
};

const todayStr = computed(() => getShanghaiDateStr());

const startDateObj = computed(() => {
  const raw = sunrunPaper.value?.startDate;
  return raw ? new Date(`${raw}T00:00:00+08:00`) : null;
});

const endDateObj = computed(() => {
  const raw = sunrunPaper.value?.endDate;
  return raw ? new Date(`${raw}T23:59:59+08:00`) : null;
});
const submitBlockedBySemester = computed(() => {
  const start = startDateObj.value;
  const end = endDateObj.value;
  if (!start || !end) return false;

  const now = new Date();
  if (now < start) return true;

  const graceEnd = new Date(end.getTime());
  graceEnd.setDate(graceEnd.getDate() + SEMESTER_SUBMIT_GRACE_DAYS);
  return now > graceEnd;
});

const startMonthFloor = computed(() => {
  if (!startDateObj.value) return null;
  return new Date(startDateObj.value.getFullYear(), startDateObj.value.getMonth(), 1);
});

const endMonthFloor = computed(() => {
  if (!endDateObj.value) return null;
  return new Date(endDateObj.value.getFullYear(), endDateObj.value.getMonth(), 1);
});

const monthToRender = computed(() => {
  const start = startDateObj.value;
  const end = endDateObj.value;
  let base = start ? new Date(start.getFullYear(), start.getMonth(), 1) : new Date();
  if (end && base > end) {
    base = new Date(end.getFullYear(), end.getMonth(), 1);
  }
  const monthBase = new Date(base);
  monthBase.setMonth(monthBase.getMonth() + calendarMonthOffset.value);
  return monthBase;
});

const prevDisabled = computed(() => {
  if (!startMonthFloor.value) return false;
  const prev = new Date(monthToRender.value);
  prev.setMonth(prev.getMonth() - 1);
  return prev < startMonthFloor.value;
});

const nextDisabled = computed(() => {
  if (!endMonthFloor.value) return false;
  const next = new Date(monthToRender.value);
  next.setMonth(next.getMonth() + 1);
  return next > endMonthFloor.value;
});

const monthLabel = computed(() => {
  const m = monthToRender.value;
  return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
});

const selectedDateSet = computed(() => new Set(selectedDates.value));
const completedDateSet = computed(() => new Set(completedDates.value));
const selectedCount = computed(() => selectedDates.value.length);

const calendarDays = computed(() => {
  const start = startDateObj.value;
  const end = endDateObj.value;
  if (!start || !end) return [];

  const days: Array<{
    label: string;
    iso: string;
    disabled: boolean;
    selected: boolean;
    completed: boolean;
    placeholder: boolean;
  }> = [];

  const monthStart = new Date(monthToRender.value);
  const firstWeekday = monthStart.getDay() || 7;
  for (let i = 1; i < firstWeekday; i += 1) {
    days.push({
      label: '',
      iso: '',
      disabled: true,
      selected: false,
      completed: false,
      placeholder: true,
    });
  }

  const cursor = new Date(monthStart);
  while (cursor <= end) {
    const iso = formatDateOnly(cursor);
    const completed = completedDateSet.value.has(iso);
    const disabled =
      cursor < start ||
      cursor > end ||
      iso >= todayStr.value ||
      completed ||
      (showBackfill.value && !routeChosen.value);

    days.push({
      label: String(cursor.getDate()),
      iso,
      disabled,
      selected: selectedDateSet.value.has(iso),
      completed,
      placeholder: false,
    });

    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDate() === 1) break;
  }

  return days;
});

const displayCampus = computed(
  () =>
    hydratedSession.value?.campusName ||
    (session.value as any)?.campusName ||
    (session.value as any)?.schoolName ||
    '-',
);
const displayCollege = computed(
  () =>
    hydratedSession.value?.collegeName ||
    (session.value as any)?.collegeName ||
    (session.value as any)?.naturalName ||
    '-',
);
const displayStuNumber = computed(
  () => hydratedSession.value?.stuNumber || (session.value as any)?.stuNumber || '-',
);
const displayStuName = computed(
  () => hydratedSession.value?.stuName || (session.value as any)?.stuName || '-',
);

const randomSelect = () => {
  if (!routeList.value.length) return;
  const idx = Math.floor(Math.random() * routeList.value.length);
  selectValue.value = routeList.value[idx]!.pointId;
};

const toggleDate = (iso: string, disabled: boolean) => {
  if (!iso || disabled) return;
  const set = new Set(selectedDates.value);
  if (set.has(iso)) {
    set.delete(iso);
  } else {
    set.add(iso);
  }
  selectedDates.value = Array.from(set).sort();
};

const randomPeriod = (): 'AM' | 'PM' => (Math.random() < 0.5 ? 'AM' : 'PM');

const hasTaskOnDate = async (date: string) => {
  if (!supabaseEnabled.value || !supabase || !session.value?.stuNumber) return false;
  const { data, error } = await supabase
    .from('Tasks')
    .select('id')
    .in('status', ['PENDING', 'PROCESSING', 'SUCCESS'])
    .contains('user_data', { session: { stuNumber: session.value.stuNumber } })
    .eq('user_data->>customDate', date)
    .limit(1);

  if (error) {
    console.warn('[queue] duplicate-check failed', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

const hasTaskToday = async () => {
  if (!supabaseEnabled.value || !supabase || !session.value?.stuNumber) return false;
  const today = getShanghaiDateStr();
  const dayStart = new Date(`${today}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${today}T23:59:59.999+08:00`).toISOString();

  const { data, error } = await supabase
    .from('Tasks')
    .select('id')
    .in('status', ['PENDING', 'PROCESSING', 'SUCCESS'])
    .contains('user_data', { session: { stuNumber: session.value.stuNumber } })
    .gte('created_at', dayStart)
    .lte('created_at', dayEnd)
    .limit(1);

  if (error) {
    console.warn('[queue] today duplicate-check failed', error);
    return false;
  }

  return Array.isArray(data) && data.length > 0;
};

const fetchSunCredits = async () => {
  if (!session.value?.stuNumber || !session.value?.token) return;
  loadingSunCredits.value = true;
  try {
    const res = await $fetch<{ success?: boolean; credits?: number }>('/api/sunrun/credits', {
      method: 'POST',
      body: { action: 'get', userId: session.value.stuNumber, token: session.value.token },
    });
    if (typeof res.credits === 'number') {
      sunCredits.value = res.credits;
    }
  } catch (error) {
    console.warn('[sunrun] fetch credits failed', error);
  } finally {
    loadingSunCredits.value = false;
  }
};

const fetchCredits = async () => {
  if (!session.value?.stuNumber || !session.value?.token) return;
  loadingCredits.value = true;
  try {
    const res = await $fetch<{ success?: boolean; credits?: number }>('/api/backfill/credits', {
      method: 'POST',
      body: { action: 'get', userId: session.value.stuNumber, token: session.value.token },
    });
    if (typeof res.credits === 'number') {
      credits.value = res.credits;
    }
  } catch (error) {
    console.warn('[backfill] fetch credits failed', error);
  } finally {
    loadingCredits.value = false;
  }
};

const handleRedeem = async () => {
  if (!session.value?.stuNumber || !session.value?.token || !redeemCode.value.trim()) return;
  loadingCredits.value = true;
  try {
    const res = await $fetch<{ success?: boolean; credits?: number; message?: string }>(
      '/api/backfill/credits',
      {
        method: 'POST',
        body: {
          action: 'redeem',
          userId: session.value.stuNumber,
          token: session.value.token,
          code: redeemCode.value.trim(),
        },
      },
    );
    if (res.success && typeof res.credits === 'number') {
      credits.value = res.credits;
      redeemDialog.value = false;
      redeemCode.value = '';
      statusMessage.value = res.message || '兑换成功';
    } else if (res.message) {
      statusMessage.value = res.message;
    }
  } catch (error) {
    console.warn('[backfill] redeem failed', error);
    statusMessage.value = '兑换失败，请稍后重试';
  } finally {
    loadingCredits.value = false;
  }
};

const handleSunRedeem = async () => {
  if (!session.value?.stuNumber || !session.value?.token || !sunRedeemCode.value.trim()) {
    statusMessage.value = '请输入兑换码';
    return;
  }
  loadingSunCredits.value = true;
  try {
    const res = await $fetch<{ success?: boolean; credits?: number; message?: string }>(
      '/api/sunrun/credits',
      {
        method: 'POST',
        body: {
          action: 'redeem',
          userId: session.value.stuNumber,
          token: session.value.token,
          code: sunRedeemCode.value.trim(),
        },
      },
    );
    if (res.success && typeof res.credits === 'number') {
      sunCredits.value = res.credits;
      sunRedeemDialog.value = false;
      sunRedeemCode.value = '';
      statusMessage.value = res.message || '兑换成功';
    } else if (res.message) {
      statusMessage.value = res.message;
    }
  } catch (error) {
    console.warn('[sunrun] redeem failed', error);
    statusMessage.value = '兑换失败，请稍后重试';
  } finally {
    loadingSunCredits.value = false;
  }
};

const loadCompletedDates = async () => {
  if (
    !session.value?.stuNumber ||
    !session.value?.token ||
    !session.value?.schoolId ||
    !sunrunPaper.value?.startDate ||
    !sunrunPaper.value?.endDate
  ) {
    completedDates.value = [];
    runHistoryRecords.value = [];
    return;
  }

  loadingHistory.value = true;
  try {
    const data = await $fetch<{
      success?: boolean;
      dates?: string[];
      records?: HistoryRecord[];
      message?: string;
    }>('/api/run/history', {
      method: 'POST',
      body: {
        session: {
          stuNumber: session.value.stuNumber,
          token: session.value.token,
          schoolId: session.value.schoolId,
          campusId: session.value.campusId,
        },
        startDate: sunrunPaper.value.startDate,
        endDate: sunrunPaper.value.endDate,
      },
    });

    const normalizedDates = Array.isArray(data?.dates)
      ? Array.from(new Set(data.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))))
      : [];
    completedDates.value = normalizedDates;

    runHistoryRecords.value = Array.isArray(data?.records)
      ? [...data.records].sort((a, b) => b.runTime.localeCompare(a.runTime))
      : [];

    if (data?.message) {
      statusMessage.value = data.message;
    }
  } catch (error) {
    console.warn('[history] load failed', error);
    completedDates.value = [];
    runHistoryRecords.value = [];
  } finally {
    loadingHistory.value = false;
  }
};

const buildJobPayload = (params: {
  customDate: string | null;
  customPeriod: 'AM' | 'PM' | null;
  reservedCredit: boolean;
}) => {
  if (!target.value) throw new Error('未选择路线');

  return {
    routeId: target.value.pointId,
    taskId: target.value.taskId,
    mileage: sunrunPaper.value?.mileage,
    minTime: sunrunPaper.value?.minTime,
    maxTime: sunrunPaper.value?.maxTime,
    runPoint: target.value,
    customDate: params.customDate,
    customPeriod: params.customPeriod,
    startDate: sunrunPaper.value?.startDate || null,
    session: {
      campusId: session.value.campusId,
      schoolId: session.value.schoolId,
      stuNumber: session.value.stuNumber,
      token: session.value.token,
      phoneNumber: session.value.phoneNumber,
    },
    reservedCredit: params.reservedCredit,
    retryCount: 0,
    queuedAt: new Date().toISOString(),
  };
};

const submitTaskToQueue = async (payload: Record<string, any>): Promise<QueueSubmitResult> => {
  try {
    const response = await fetch('/api/submitTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (response.status === 202 && data?.success && typeof data.taskId === 'number') {
      return { ok: true, taskId: data.taskId };
    }

    return {
      ok: false,
      error: data?.error || data?.message || `状态码 ${response.status}`,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message || '网络错误' };
  }
};

const submitBackfillJobs = async () => {
  if (!target.value) {
    statusMessage.value = '请先选择路线';
    return;
  }

  const dates = [...selectedDates.value].sort();
  if (!dates.length) {
    statusMessage.value = '请至少选择 1 天';
    return;
  }

  statusMessage.value = '正在校验重复任务...';
  resultLog.value = '';
  submitted.value = false;
  taskIds.value = [];

  const duplicateChecks = await Promise.all(
    dates.map(async (date) => ({ date, duplicated: await hasTaskOnDate(date) })),
  );
  const duplicatedDates = duplicateChecks.filter((item) => item.duplicated).map((item) => item.date);

  if (duplicatedDates.length) {
    statusMessage.value = '以下日期已在队列或已完成，请取消后重试';
    resultLog.value = duplicatedDates.join('、');
    return;
  }
  const createdTaskIds: number[] = [];
  const failedDetails: string[] = [];

  statusMessage.value = `正在提交 ${dates.length} 个任务到队列...`;

  try {
    for (const date of dates) {
      const payload = buildJobPayload({
        customDate: date,
        customPeriod: randomPeriod(),
        reservedCredit: true,
      });
      const submitRes = await submitTaskToQueue(payload);
      if (submitRes.ok && typeof submitRes.taskId === 'number') {
        createdTaskIds.push(submitRes.taskId);
      } else {
        failedDetails.push(`${date}: ${submitRes.error || '入队失败'}`);
      }
    }

    taskIds.value = createdTaskIds;
    if (createdTaskIds.length > 0) {
      submitted.value = true;
      selectedDates.value = [];
      statusMessage.value = `已成功入队 ${createdTaskIds.length} 个任务`;
      if (failedDetails.length > 0) {
        resultLog.value = `以下日期入队失败（未成功入队的不扣次数）：${failedDetails.join('；')}`;
      } else {
        resultLog.value =
          '每个任务失败后会自动重试 2 次，若 3 次仍失败，worker 会自动返还该任务扣减次数。';
      }
    } else {
      submitted.value = false;
      statusMessage.value = '提交失败，未成功创建任务';
      resultLog.value = failedDetails.length ? failedDetails.join('；') : '未知错误';
    }
  } catch (error) {
    submitted.value = false;
    statusMessage.value = '提交异常';
    resultLog.value = (error as Error).message;
  } finally {
    await fetchCredits();
    await loadCompletedDates();
  }
};

const submitSunRunJob = async () => {
  if (!target.value) {
    statusMessage.value = '请先选择路线';
    return;
  }

  statusMessage.value = '正在提交任务...';
  resultLog.value = '';
  submitted.value = false;
  taskIds.value = [];

  const duplicated = await hasTaskToday();
  if (duplicated) {
    statusMessage.value = '今天已有任务在队列或已完成，请勿重复提交';
    return;
  }
  try {
    const payload = buildJobPayload({ customDate: null, customPeriod: null, reservedCredit: true });
    const submitRes = await submitTaskToQueue(payload);
    if (!submitRes.ok || typeof submitRes.taskId !== 'number') {
      statusMessage.value = `提交失败：${submitRes.error || '未知错误'}`;
      return;
    }

    taskIds.value = [submitRes.taskId];
    submitted.value = true;
    statusMessage.value = '任务已入队';
    resultLog.value = `任务ID：${submitRes.taskId}`;
  } catch (error) {
    statusMessage.value = '提交失败';
    resultLog.value = (error as Error).message;
  } finally {
    await fetchSunCredits();
  }
};

const submitJobs = async () => {
  if (isSubmitting.value) return;
  if (submitBlockedBySemester.value) {
    submitted.value = false;
    statusMessage.value = SEMESTER_BLOCK_MESSAGE;
    resultLog.value = '';
    return;
  }
  isSubmitting.value = true;
  try {
    if (showBackfill.value) {
      await submitBackfillJobs();
    } else {
      await submitSunRunJob();
    }
  } finally {
    isSubmitting.value = false;
  }
};

const init = async () => {
  if (!session.value?.token) {
    statusMessage.value = '请先登录';
    return;
  }

  try {
    const data = await TotoroApiWrapper.getSunRunPaper({
      token: session.value.token,
      campusId: session.value.campusId,
      schoolId: session.value.schoolId,
      stuNumber: session.value.stuNumber,
    });

    sunrunPaper.value = data;
    selectValue.value = '';
    selectedDates.value = [];
    calendarMonthOffset.value = 0;

    await Promise.all([fetchSunCredits(), fetchCredits()]);
    await loadCompletedDates();
  } catch (error) {
    statusMessage.value = '获取路线失败';
    resultLog.value = (error as Error).message;
  }
};

await init();
</script>

<template>
  <div class="p-4 space-y-4">
    <div>
      <p>请核对个人信息</p>
      <VTable density="compact" class="mb-6 mt-4">
        <tbody>
          <tr>
            <td>学校</td>
            <td>{{ displayCampus }}</td>
          </tr>
          <tr>
            <td>学院</td>
            <td>{{ displayCollege }}</td>
          </tr>
          <tr>
            <td>学号</td>
            <td>{{ displayStuNumber }}</td>
          </tr>
          <tr>
            <td>姓名</td>
            <td>{{ displayStuName }}</td>
          </tr>
        </tbody>
      </VTable>
    </div>

    <div class="space-y-2">
      <div class="flex items-center justify-between gap-3">
        <div class="text-body-2 text-gray-600">路线</div>
        <div class="flex items-center gap-2">
          <VBtn size="small" variant="text" @click="randomSelect">随机路线</VBtn>
          <VBtn
            size="small"
            variant="flat"
            class="bg-[#e9dcff] text-[#5e34a4] font-semibold"
            :loading="loadingHistory"
            @click="historyDialog = true"
          >
            查看记录
          </VBtn>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <VBtn
          v-for="routeItem in routeList"
          :key="routeItem.pointId"
          block
          variant="tonal"
          class="justify-start transition-all"
          :class="
            routeItem.pointId === selectValue
              ? 'bg-blue-200 text-blue-900 ring-2 ring-blue-300'
              : 'opacity-80'
          "
          :elevation="routeItem.pointId === selectValue ? 8 : 0"
          @click="selectValue = routeItem.pointId"
        >
          {{ routeItem.pointName }}
        </VBtn>
      </div>
      <div v-if="!routeChosen" class="text-sm text-orange-700">请先点击选择一个路线，才能继续下面操作。</div>
    </div>

    <VCard v-if="!showBackfill" class="p-3 space-y-2" variant="tonal">
      <div class="flex flex-wrap items-center gap-3">
        <div class="font-medium">阳光跑次数：</div>
        <div class="text-2xl font-bold text-green-600">{{ sunCredits }}</div>
        <VBtn size="small" variant="text" :loading="loadingSunCredits" @click="fetchSunCredits">
          刷新
        </VBtn>
        <VBtn size="small" color="primary" @click="sunRedeemDialog = true">添加次数</VBtn>
      </div>
      <div class="text-caption text-orange-700">
        提交后会预扣 1 次，若入队失败会立即返还。
      </div>
    </VCard>

    <div v-if="showBackfill" class="space-y-3">
      <div class="font-medium text-body-1">阳光跑补跑（仅本学期）</div>

      <VCard class="p-3 space-y-2" variant="tonal">
        <div class="flex items-center gap-3 flex-wrap">
          <div class="font-medium">次数余额：</div>
          <div class="text-2xl font-bold text-green-600">{{ credits }}</div>
          <VBtn size="small" variant="text" :loading="loadingCredits" @click="fetchCredits">刷新</VBtn>
          <VBtn size="small" color="primary" @click="redeemDialog = true">添加次数</VBtn>
        </div>
        <div class="text-caption text-orange-700">
          每个日期会扣除 1 次；每个任务会随机上午或下午时间段，不再手动选择。
        </div>
      </VCard>

      <div class="rounded-md border border-orange-300 bg-orange-50 p-3 text-sm">
        <span>已选择 </span>
        <span class="text-red-600 font-bold text-base">{{ selectedCount }}</span>
        <span> 天，将扣除 </span>
        <span class="text-red-600 font-bold text-base">{{ selectedCount }}</span>
        <span> 次</span>
      </div>

      <div class="flex items-center justify-between max-w-2xl">
        <div class="font-medium">选择日期（仅本学期，可多选）</div>
        <div class="space-x-2">
          <VBtn size="small" variant="text" :disabled="prevDisabled" @click="calendarMonthOffset--">
            上一月
          </VBtn>
          <VBtn size="small" variant="text" :disabled="nextDisabled" @click="calendarMonthOffset++">
            下一月
          </VBtn>
        </div>
      </div>

      <div class="text-sm text-gray-600">当前月份：{{ monthLabel }}</div>

      <div class="max-w-2xl border rounded-md p-3">
        <div class="grid grid-cols-7 text-center text-caption text-gray-500 mb-2">
          <div>一</div>
          <div>二</div>
          <div>三</div>
          <div>四</div>
          <div>五</div>
          <div>六</div>
          <div>日</div>
        </div>

        <div class="grid grid-cols-7 gap-1">
          <button
            v-for="day in calendarDays"
            :key="`${day.iso}-${day.label}`"
            class="h-10 rounded text-sm border flex items-center justify-center"
            :class="[
              day.placeholder ? 'bg-gray-100 border-gray-100 text-gray-200 cursor-default' : '',
              !day.placeholder && day.completed
                ? 'bg-emerald-100 text-emerald-700 border-emerald-300 cursor-not-allowed font-semibold'
                : '',
              !day.placeholder && !day.completed && day.selected
                ? 'bg-orange-500 text-white border-orange-600 font-bold'
                : '',
              !day.placeholder && !day.completed && !day.selected && day.disabled
                ? 'bg-gray-200 text-gray-400 border-gray-200 cursor-not-allowed'
                : '',
              !day.placeholder && !day.completed && !day.selected && !day.disabled
                ? 'bg-white text-gray-800 border-gray-200 hover:border-orange-400 hover:text-orange-600'
                : '',
            ]"
            :disabled="day.disabled || day.placeholder"
            @click="toggleDate(day.iso, day.disabled || day.placeholder)"
          >
            {{ day.label }}
          </button>
        </div>
      </div>
    </div>

    <VDialog v-model="historyDialog" max-width="980">
      <VCard>
        <VCardTitle class="flex items-center justify-between gap-3">
          <span>运动记录</span>
          <VBtn size="small" variant="text" :loading="loadingHistory" @click="loadCompletedDates">
            刷新
          </VBtn>
        </VCardTitle>

        <VCardText>
          <div v-if="loadingHistory" class="py-6 text-center text-gray-500">正在加载记录...</div>

          <div v-else-if="!runHistoryRecords.length" class="py-6 text-center text-gray-500">
            暂无记录
          </div>

          <VTable v-else density="compact">
            <thead>
              <tr>
                <th>日期</th>
                <th>时间</th>
                <th>里程(km)</th>
                <th>用时</th>
                <th>卡路里</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in runHistoryRecords" :key="item.scoreId || `${item.date}-${item.runTime}`">
                <td>{{ item.date || item.runTime.slice(0, 10) }}</td>
                <td>{{ item.runTime }}</td>
                <td>{{ item.mileage }}</td>
                <td>{{ item.usedTime }}</td>
                <td>{{ item.calorie }}</td>
                <td>{{ item.status }}</td>
              </tr>
            </tbody>
          </VTable>
        </VCardText>

        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="historyDialog = false">关闭</VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="sunRedeemDialog" max-width="420">
      <VCard title="阳光跑次数充值">
        <VCardText>
          <VTextField v-model="sunRedeemCode" label="兑换码" variant="outlined" />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="sunRedeemDialog = false">取消</VBtn>
          <VBtn color="primary" :loading="loadingSunCredits" @click="handleSunRedeem">兑换</VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VDialog v-model="redeemDialog" max-width="420">
      <VCard title="补跑次数充值">
        <VCardText>
          <VTextField v-model="redeemCode" label="兑换码" variant="outlined" />
        </VCardText>
        <VCardActions>
          <VSpacer />
          <VBtn variant="text" @click="redeemDialog = false">取消</VBtn>
          <VBtn color="primary" :loading="loadingCredits" @click="handleRedeem">兑换</VBtn>
        </VCardActions>
      </VCard>
    </VDialog>

    <VBtn
      v-if="!submitted"
      block
      color="primary"
      size="large"
      :disabled="
        !routeChosen ||
        isSubmitting ||
        (showBackfill && selectedCount === 0) ||
        (showBackfill && selectedCount > credits)
      "
      :loading="isSubmitting"
      @click="submitJobs"
    >
      {{ showBackfill ? '提交所选日期任务' : '提交今日任务' }}
    </VBtn>

    <VAlert v-else type="success" variant="tonal" class="mt-2">
      <div>任务已提交，任务ID：{{ taskIds.join('、') }}</div>
      <div class="text-caption mt-1">可离开本页，后台会继续执行并写回状态。</div>
    </VAlert>

    <VAlert v-if="statusMessage" type="info" variant="tonal" class="mt-2">
      <div>{{ statusMessage }}</div>
      <div v-if="resultLog" class="text-caption mt-1">详情：{{ resultLog }}</div>
    </VAlert>

    <div v-if="sunrunPaper?.runPointList?.length" class="h-50vh w-full md:w-50vw">
      <ClientOnly>
        <AMap :target="selectValue" @update:target="selectValue = $event" />
      </ClientOnly>
    </div>
  </div>
</template>
