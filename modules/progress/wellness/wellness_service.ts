import prisma from '../../../config/prisma';
import { realMealWhere, realSnapshotWhere } from '../../../utils/real_data';
import { calendarDate, RangeQuery } from '../progress_types';
import { inRange, progressRange } from '../progress_range';
import { calcTargets } from '../../home/home_service';
import { previewDays } from '../preview/preview_data';

export async function getWellnessProgress(owner: string, query: RangeQuery) {
  if (query.dataset === 'preview') {
    const days = await previewDays(owner, query.date);
    const range = progressRange(query, days[0]?.date);
    const selected = days.filter(day => inRange(day.date, range));
    return {
      range,
      currentTargets: null,
      sleep: [],
      recovery: selected.map(day => ({ date: day.date, ...day.data.recovery, source: 'preview' })),
      nutrition: selected.map(day => ({ date: day.date, ...day.data.nutrition, mealLogs: 3 })),
    };
  }
  const [snapshots, meals, water, profile, manualSleep] = await Promise.all([
    prisma.healthKitSnapshot.findMany({
      where: { userId: owner, date: { lte: query.date }, ...realSnapshotWhere },
      select: { date: true, recoveryScore: true, sleepTotalMinutes: true, hrv: true, hrvMethod: true,
        restingHR: true, sourceProvider: true, steps: true, activeCalories: true },
      orderBy: { date: 'asc' },
    }),
    prisma.userMealLog.findMany({
      where: { userId: owner, status: 'LOGGED', ...realMealWhere },
      select: { day: true, month: true, year: true, calories: true, protein: true, carbs: true, fat: true },
    }),
    prisma.userWaterLog.findMany({
      where: { userId: owner, sourceProvider: 'USER' },
      select: { day: true, month: true, year: true, amountMl: true },
    }),
    prisma.onboarding.findUnique({ where: { userId: owner } }),
    prisma.dailyWellnessEntry.findMany({ where: { userId: owner, date: { lte: query.date } }, orderBy: { date: 'asc' } }),
  ]);
  const dateOf = (row: { year: string; month: string; day: string }) => `${row.year}-${row.month.padStart(2, '0')}-${row.day.padStart(2, '0')}`;
  const dates = [
    ...snapshots.map(row => row.date),
    ...meals.map(dateOf),
    ...water.map(dateOf),
    ...manualSleep.map(row => row.date),
  ].filter(date => calendarDate.safeParse(date).success && date <= query.date).sort();
  const range = progressRange(query, dates[0]);
  const recovery = snapshots.filter(row => inRange(row.date, range)).map(row => ({
    date: row.date,
    recovery: row.sleepTotalMinutes != null && row.sleepTotalMinutes > 0 && (row.hrv != null || row.restingHR != null)
      ? row.recoveryScore : null,
    sleep: row.sleepTotalMinutes == null ? null : Math.round(row.sleepTotalMinutes / 60 * 10) / 10,
    hrv: row.hrv,
    hrvMethod: row.hrvMethod ?? (row.sourceProvider === 'GOOGLE_HEALTH_CONNECT' ? 'RMSSD' : row.sourceProvider === 'APPLE_HEALTHKIT' ? 'SDNN' : null),
    rhr: row.restingHR,
    steps: row.steps,
    activeCalories: row.activeCalories,
    source: row.sourceProvider,
  }));
  for (const log of manualSleep.filter(row => inRange(row.date, range))) {
    const device = recovery.find(row => row.date === log.date);
    if (device) {
      if (device.sleep == null) device.sleep = Math.round(log.sleepMinutes / 6) / 10;
    } else {
      recovery.push({ date: log.date, recovery: null, sleep: Math.round(log.sleepMinutes / 6) / 10,
        hrv: null, hrvMethod: null, rhr: null, steps: null, activeCalories: null, source: log.source });
    }
  }
  recovery.sort((a, b) => a.date.localeCompare(b.date));
  type NutritionDay = {
    date: string;
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
    water: number | null;
    mealLogs: number;
  };
  const nutrition = new Map<string, NutritionDay>();
  const dayRow = (date: string) => {
    if (!nutrition.has(date)) nutrition.set(date, { date, calories: null, protein: null, carbs: null, fat: null, water: null, mealLogs: 0 });
    return nutrition.get(date)!;
  };
  for (const meal of meals) {
    const date = dateOf(meal);
    if (!calendarDate.safeParse(date).success || !inRange(date, range)) continue;
    const row = dayRow(date);
    row.calories = (row.calories ?? 0) + meal.calories;
    row.protein = (row.protein ?? 0) + meal.protein;
    row.carbs = (row.carbs ?? 0) + meal.carbs;
    row.fat = (row.fat ?? 0) + meal.fat;
    row.mealLogs++;
  }
  for (const log of water) {
    const date = dateOf(log);
    if (!calendarDate.safeParse(date).success || !inRange(date, range)) continue;
    const row = dayRow(date);
    row.water = (row.water ?? 0) + log.amountMl;
  }
  return {
    range,
    recovery,
    sleep: manualSleep.filter(row => inRange(row.date, range)).map(row => ({
      date: row.date, sleep: row.sleepMinutes / 60, source: 'manual',
    })),
    currentTargets: profile ? calcTargets(profile) : null,
    nutrition: [...nutrition.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}
