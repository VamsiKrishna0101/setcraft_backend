import { dailyNutritionTargets } from "./common/daily_nutrition_targets";
import type { Snapshot } from "./common/types";
import prisma from "../config/prisma";
import { getExerciseById } from "../modules/workout/workout_service";
import { getmysubscription } from "../modules/subscription/subscription_service";
import { REGIONS, WeeklyPlan } from "./common/types";
import { effectivePlan } from "../modules/workout/session/schedule_service";

export function starterPreview(plan: WeeklyPlan) {
  const first = plan.workouts.find((day) => !day.restDay);
  const exercises = [
    ...new Map(
      plan.workouts
        .flatMap((day) => day.exercises)
        .map((exercise) => [exercise.exerciseId, exercise]),
    ).values(),
  ];
  const groups = REGIONS.map((region) => ({
    region,
    exercises: exercises.filter((exercise) => exercise.region === region),
  })).filter((group) => group.exercises.length);
  // At most two distinct real exercises are public, shared across all preview sections.
  const visible = [
    ...new Map(
      (first?.exercises ?? exercises).map((exercise) => [
        exercise.exerciseId,
        exercise,
      ]),
    ).values(),
  ].slice(0, 2);
  const visibleIds = new Set(visible.map((exercise) => exercise.exerciseId));
  const sample = (
    exercise: WeeklyPlan["workouts"][number]["exercises"][number],
  ) => ({
    exerciseId: exercise.exerciseId,
    exercise: null as Record<string, unknown> | null,
    name: exercise.displayName ?? exercise.name,
    sets: exercise.sets,
    repsMin: exercise.repsMin,
    repsMax: exercise.repsMax,
  });
  return {
    source: plan.model === "starter:rules-v1" ? "rules" : "ai",
    weekStart: plan.weekStart,
    muscleGroups: groups.map((group) => ({
      region: group.region,
      exerciseCount: group.exercises.length,
      lockedCount: group.exercises.filter(
        (exercise) => !visibleIds.has(exercise.exerciseId),
      ).length,
      exercises: group.exercises
        .filter((exercise) => visibleIds.has(exercise.exerciseId))
        .map(sample),
    })),
    workouts: plan.workouts.map((day) => ({
      date: day.date,
      name: day.name,
      restDay: day.restDay,
      estimatedMinutes: day.estimatedMinutes,
      exerciseCount: day.exercises.length,
    })),
    firstWorkout: first
      ? {
          date: first.date,
          name: first.name,
          estimatedMinutes: first.estimatedMinutes,
          exerciseCount: first.exercises.length,
          exercises: first.exercises
            .filter((exercise) => visibleIds.has(exercise.exerciseId))
            .map(sample),
        }
      : null,
  };
}

// Redaction happens on the server; locked details never reach the preview client.
export async function publicStarterPlan<
  T extends { id?: string; model?: string; payload: unknown },
>(
  userId: string,
  plan: T,
): Promise<
  T & { locked?: boolean; preview?: ReturnType<typeof starterPreview> }
> {
  plan = await effectivePlan(userId, plan);
  // Older saved weeks omitted intake targets in Routine/Track mode. Restore
  // the estimates from that generation snapshot without rewriting history.
  const payload = plan.payload as WeeklyPlan | null;
  if (plan.id && payload?.nutrition && !payload.nutrition.targets) {
    const saved = await prisma.weeklyPersonalPlan.findFirst({
      where: {id: plan.id, userId}, select: {run: {select: {input: true}}},
    });
    const profile = (saved?.run?.input as unknown as Snapshot | undefined)?.profile;
    const targets = profile ? dailyNutritionTargets(profile) : null;
    if (targets) plan = {...plan, payload: {...payload, nutrition: {...payload.nutrition, targets}}};
  }
  if (!plan.model?.startsWith("starter:")) return plan;
  const preview = starterPreview(plan.payload as WeeklyPlan);
  const [access, profile] = await Promise.all([
    getmysubscription(userId, false),
    prisma.onboarding.findUnique({where: {userId}, select: {language: true, gender: true}}),
  ]);
  const gender = profile?.gender === "FEMALE" ? "female" : profile?.gender === "MALE" ? "male" : undefined;
  await Promise.all((preview.firstWorkout?.exercises ?? []).map(async sample => {
    try {
      sample.exercise = {...await getExerciseById(sample.exerciseId, profile?.language ?? "en", gender)};
    } catch {
      // A temporarily unavailable guide must not discard the generated plan.
    }
  }));
  return {
    ...plan,
    payload: access.hasAccess ? plan.payload : null,
    locked: !access.hasAccess,
    preview,
  };
}
