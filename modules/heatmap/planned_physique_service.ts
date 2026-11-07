import prisma from '../../config/prisma';
import {contentLocale} from '../../utils/app_locale';
import {calendarWindow, Exercise, mapExercise} from './training_map_engine';
import {effectivePlan} from '../workout/session/schedule_service';

type SavedDay = {date: string; name?: string; restDay?: boolean; estimatedMinutes?: number;
  exercises?: Array<{exerciseId: string; reason?: string; progression?: string}>};
type Scheduled = {scheduledDate: string | null; status: string; items: Array<{
  id: string; targetSets: number; targetReps: string; targetWeight: number | null;
  targetRpe: number | null; restSeconds: number; setTargets: unknown; status: string;
  workout: Exercise & {namesByLang?: unknown};
}>};

export function buildPlannedPhysiqueMap(input: {date: string; gender: string; language?: string;
  selectedWeek?: string;
  plan: {id: string; weekStart: string; payload: unknown} | null;
  scheduled: Scheduled[]; days: Array<{date: string; name: string; restDay: boolean}>}) {
  const payload = input.plan?.payload as {summary?: string; workouts?: SavedDay[]} | undefined;
  const end = input.selectedWeek ? new Date(`${input.selectedWeek}T00:00:00Z`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end?.toISOString().slice(0, 10);
  const savedDays = (Array.isArray(payload?.workouts) ? payload.workouts : [])
    .filter(day => !input.selectedWeek || day.date >= input.selectedWeek && day.date <= weekEnd!);
  const dates = savedDays.map(d => d.date).sort();
  const status = !input.plan || input.selectedWeek && !dates.length ? 'none' : input.selectedWeek ? 'active' : !dates.length || dates[dates.length - 1]! < input.date
    ? 'expired' : dates[0]! > input.date ? 'upcoming' : 'active';
  const language = contentLocale(input.language || 'en');
  return {date: input.date, gender: input.gender, planId: input.plan?.id ?? null,
    weekStart: input.selectedWeek ?? input.plan?.weekStart ?? null, weekEnd: weekEnd ?? null, status,
    summary: payload?.summary ?? '',
    workouts: status === 'none' || status === 'expired' ? [] : savedDays.map(day => {
      const live = input.scheduled.find(w => w.scheduledDate === day.date);
      const override = input.days.find(d => d.date === day.date);
      const restDay = override?.restDay ?? day.restDay === true;
      return {date: day.date, name: override?.name || day.name || 'Workout', restDay,
        status: restDay ? 'REST_DAY' : live?.status ?? 'NOT_STARTED',
        estimatedMinutes: day.estimatedMinutes ?? null,
        exercises: restDay || live?.status === 'SKIPPED' ? [] : (live?.items ?? [])
          .filter(item => item.status !== 'SKIPPED' && item.targetSets > 0).map(item => {
            const original = day.exercises?.find(e => e.exerciseId === item.workout.id);
            const translations = item.workout.namesByLang as Record<string, string> | null;
            return {itemId: item.id, exerciseId: item.workout.id,
              name: translations?.[language] || item.workout.name,
              sets: item.targetSets, targetReps: item.targetReps, weightKg: item.targetWeight,
              targetRpe: item.targetRpe, restSeconds: item.restSeconds,
              weightBasis: (item.setTargets as {weightBasis?: string} | null)?.weightBasis ?? null,
              weightUnit: (item.setTargets as {weightUnit?: string} | null)?.weightUnit ?? null,
              setPrescriptions: (item.setTargets as {sets?: unknown} | null)?.sets ?? [],
              reason: original?.reason ?? null, progression: original?.progression ?? null,
              ...mapExercise(item.workout)};
          })};
    })};
}

export async function getPlannedPhysiqueMap(userId: string, date: string, offset: number, language?: string) {
  const {weekStart} = calendarWindow(date, offset);
  const end = new Date(`${weekStart}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  const weekEnd = end.toISOString().slice(0, 10);
  const [profile, plans] = await Promise.all([
    prisma.onboarding.findUnique({where: {userId}, select: {gender: true, language: true}}),
    prisma.weeklyPersonalPlan.findMany({where: {userId, status: {in: ['ACTIVE', 'ARCHIVED']}, synthetic: false},
      orderBy: [{createdAt: 'desc'}, {version: 'desc'}], select: {id: true, weekStart: true, payload: true}}),
  ]);
  // Resolve each calendar day from the newest real saved plan covering it.
  // Never substitute the current/next plan when a historical week is empty.
  const chosen = new Map<string, SavedDay>();
  let base: typeof plans[number] | undefined;
  for (const candidate of await Promise.all(plans.map(plan => effectivePlan(userId, plan)))) {
    for (const day of (candidate.payload as {workouts?: SavedDay[]})?.workouts ?? []) {
      if (day.date < weekStart || day.date > weekEnd || chosen.has(day.date)) continue;
      chosen.set(day.date, day);
      base ??= candidate;
    }
  }
  const dates = [...chosen.keys()].sort();
  const plan = base ? {id: base.id, weekStart, payload: {
    summary: (base.payload as {summary?: string})?.summary ?? '', workouts: dates.map(day => chosen.get(day)!),
  }} : null;
  const [scheduled, days] = dates.length ? await Promise.all([
    prisma.userWorkout.findMany({where: {userId, scheduledDate: {in: dates}},
      select: {scheduledDate: true, status: true, items: {where: {sourceProvider: 'USER'}, orderBy: {orderIndex: 'asc'},
        select: {id: true, targetSets: true, targetReps: true, targetWeight: true, targetRpe: true,
          restSeconds: true, setTargets: true, status: true, workout: {select: {
            id: true, name: true, namesByLang: true, target: true, muscleGroup: true,
            bodyPart: true, secondaryMuscles: true, equipment: true,
          }}}}}}),
    prisma.workoutDay.findMany({where: {userId, date: {in: dates}}, select: {date: true, name: true, restDay: true}}),
  ]) : [[], []];
  return buildPlannedPhysiqueMap({date, gender: profile?.gender ?? 'OTHER', language: language || profile?.language,
    selectedWeek: weekStart, plan, scheduled, days});
}
