import { fitnessTerm } from "../../utils/fitness_locale";
import { MUSCLE_IDS } from "../heatmap/training_map_engine";
import { getBodyProgress } from "./body/body_service";
import { progressRange, shiftDate, ProgressRange } from "./progress_range";
import { ListQuery, ProgressError, RangeQuery } from "./progress_types";
import { trainingData } from "./training/training_data";
import { trainingSummary } from "./training/training_summary";
import { exerciseList } from "./training/exercise_service";
import { sessionRows } from "./training/session_service";
import { getWellnessProgress } from "./wellness/wellness_service";
import prisma from "../../config/prisma";
import { inRange } from "./progress_range";

export async function getProgressOverview(
  owner: string,
  query: RangeQuery,
  locale: string,
) {
  const [training, body, wellness, savedPlans] = await Promise.all([
    trainingData(
      owner,
      query.period === "custom" ? query.end! : query.date,
      query.dataset,
    ),
    getBodyProgress(owner, query),
    getWellnessProgress(owner, query),
    prisma.weeklyPersonalPlan.findMany({
      where: { userId: owner, synthetic: false, status: { in: ['ACTIVE', 'ARCHIVED', 'DRAFT'] },
        weekStart: { lte: query.period === 'custom' ? query.end! : query.date,
          ...(query.period === 'custom' ? { gte: shiftDate(query.start!, -6) } : {}) } },
      select: { id: true, weekStart: true, status: true, version: true },
      orderBy: [{ weekStart: 'desc' }, { version: 'desc' }],
    }),
  ]);
  const earliest = [
    training.sets[0]?.date,
    ...training.sessions.map((row) => row.date),
    body.range.start,
    wellness.range.start,
    ...savedPlans.map(plan => plan.weekStart),
  ]
    .filter((date): date is string => !!date)
    .sort()[0];
  const range = progressRange(query, earliest);
  const result = trainingSummary(training, range);
  const exercises = exerciseList(training, query, locale);
  return {
    range,
    updatedAt: new Date().toISOString(),
    dataset: query.dataset ?? "real",
    hasPreview: false,
    ...result,
    muscles: result.muscles.map((muscle) => ({
      ...muscle,
      label: fitnessTerm(muscle.label, locale),
    })),
    exercises,
    personalBests: result.personalBests.map(record => ({
      ...record,
      name: exercises.find(exercise => exercise.id === record.exerciseId)!.name,
    })),
    recentSessions: sessionRows(
      training,
      locale,
      training.sessions.filter((row) => inRange(row.date, range)).slice(0, 3),
    ),
    body,
    wellness,
    planHistory: progressPlanRows(savedPlans, range),
  };
}

export function progressPlanRows<T extends { weekStart: string }>(plans: T[], range: ProgressRange) {
  const weeks = new Set<string>();
  return plans.filter(plan => {
    if (weeks.has(plan.weekStart)) return false;
    const intersects = Array.from({ length: 7 }, (_, i) => shiftDate(plan.weekStart, i))
      .some(date => inRange(date, range));
    if (intersects) weeks.add(plan.weekStart);
    return intersects;
  }).slice(0, 3);
}

export async function getMuscle(
  owner: string,
  id: string,
  query: ListQuery,
  locale: string,
) {
  if (!(MUSCLE_IDS as readonly string[]).includes(id))
    throw new ProgressError("Muscle not found", 404);
  const training = await trainingData(
    owner,
    query.period === "custom" ? query.end! : query.date,
    query.dataset,
  );
  const range = progressRange(query, training.sets[0]?.date);
  const allSummary = trainingSummary(training, range);
  const muscle = allSummary.muscles.find((row) => row.id === id)!;
  const sets = training.sets.filter((set) =>
    training.mappings
      .get(set.workoutItem.workout.id)
      ?.primary.includes(id as (typeof MUSCLE_IDS)[number]),
  );
  const direct = trainingSummary({ ...training, sets }, range);
  return {
    muscle: { ...muscle, label: fitnessTerm(muscle.label, locale) },
    weeks: direct.weeks,
    exercises: exerciseList({ ...training, sets }, query, locale),
    range,
  };
}
