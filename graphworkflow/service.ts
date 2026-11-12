import { DayOfWeek, Prisma } from "@prisma/client";
import prisma from "../config/prisma";
import {assertAiPlanningConsent} from '../modules/privacy/ai_consent';
import { planHistoryWhere } from './plan_history_filter';
import { loadSnapshot, hashContext } from "./nodes/prepare_node";
import { Snapshot, WeeklyPlan, PlannerError, dateInZone } from "./common/types";
import { validatePlan } from "./nodes/validation_node";
import { planProgress } from "./progress";
import { publicStarterPlan } from "./starter_preview";
import { canRetryPlan, MAX_PLAN_ATTEMPTS } from './common/retry_policy';
import { SelectedSchedule, localMidnight } from './common/calendar_schedule';
import { addDays } from './common/types';
import { weekday } from "../modules/workout/session/session_types";
import { invalidateUserWorkoutCache } from "../modules/workout/workout_service";
import {
  invalidateUserNutritionCache,
  invalidateMealPlanCache,
} from "../modules/nutrition/nutrition_service";

const databaseJson = (value: unknown) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

const GENERATION_INTERVAL = 7 * 24 * 60 * 60 * 1000;

export async function getPlanAvailability(
  userId: string,
  database: Prisma.TransactionClient = prisma,
  now = new Date(),
) {
  const latestPlan = await database.weeklyPersonalPlan.findFirst({
    where: { userId, synthetic: false },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, weekStart: true, run: {select: {input: true}} },
  });

  // A plan only counts while its week is running or still ahead.
  const activePlan = await database.weeklyPersonalPlan.findFirst({
    where: { userId, synthetic: false, status: "ACTIVE" },
    orderBy: { weekStart: "desc" },
    select: { weekStart: true, run: { select: { input: true } } },
  });
  const activeTimezone = (activePlan?.run.input as unknown as Snapshot | undefined)?.timezone;
  let today = now.toISOString().slice(0, 10);
  try { if (activeTimezone) today = dateInZone(activeTimezone, now); } catch {}
  const hasCurrentPlan = !!activePlan && activePlan.weekStart >= addDays(today, -6);

  const pendingRun = await database.weeklyPlanRun.findFirst({
    where: { userId, status: { in: ["QUEUED", "RUNNING"] } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      stage: true,
      weekStart: true,
      progress: true,
    },
  });

  let nextGenerationAt = latestPlan
    ? new Date(latestPlan.createdAt.getTime() + GENERATION_INTERVAL)
    : null;
  const latestSnapshot = latestPlan?.run.input as unknown as Snapshot | undefined;
  if (latestPlan && latestSnapshot?.selectedSchedule) {
    const nextWeek = localMidnight(addDays(latestPlan.weekStart, 7), latestSnapshot.timezone);
    if (nextGenerationAt && nextWeek < nextGenerationAt) nextGenerationAt = nextWeek;
  }

  const cooldownActive = nextGenerationAt !== null && now < nextGenerationAt;

  return {
    canGenerate: !cooldownActive && pendingRun === null,
    cooldownActive,
    nextGenerationAt: nextGenerationAt?.toISOString() ?? null,
    lastPlanId: latestPlan?.id ?? null,
    hasCurrentPlan,
    pendingRun: pendingRun
      ? {
          ...pendingRun,
          progress: planProgress(pendingRun.progress, false),
        }
      : null,
  };
}

function checkGenerationCooldown(
  availability: Awaited<ReturnType<typeof getPlanAvailability>>,
) {
  if (availability.cooldownActive) {
    throw new PlannerError(
      "PLAN_COOLDOWN",
      "Your weekly plan is saved. Check the next available generation date.",
      429,
      {
        nextGenerationAt: availability.nextGenerationAt!,
        lastPlanId: availability.lastPlanId!,
      },
    );
  }
}

export async function requestPlan(
  userId: string,
  weekStart: string,
  timezone: string,
  includeDemo = false,
  selectedSchedule?: SelectedSchedule,
) {
  await assertAiPlanningConsent(userId);
  if (includeDemo) {
    throw new PlannerError(
      "DEMO_HISTORY_DISABLED",
      "Plans use your real profile and saved history only.",
    );
  }
  return prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;

      const availability = await getPlanAvailability(userId, transaction);
      checkGenerationCooldown(availability);

      const snapshot = await loadSnapshot(
        userId,
        weekStart,
        timezone,
        includeDemo,
        transaction,
        false,
        selectedSchedule,
      );
      const contextHash = hashContext(snapshot);

      const existing = await transaction.weeklyPlanRun.findUnique({
        where: {
          userId_weekStart_contextHash: { userId, weekStart, contextHash },
        },
        select: {
          id: true,
          status: true,
          stage: true,
          weekStart: true,
          errorCode: true,
        },
      });

      if (existing) {
        return existing;
      }

      if (availability.pendingRun) {
        throw new PlannerError(
          "ALREADY_GENERATING",
          "Your plan is already being prepared. Check its progress.",
          429,
        );
      }

      return transaction.weeklyPlanRun.create({
        data: { userId, weekStart, contextHash, input: databaseJson(snapshot) },
        select: {
          id: true,
          status: true,
          stage: true,
          weekStart: true,
          errorCode: true,
        },
      });
    },
    { timeout: 20000 },
  );
}

export async function retryPlan(userId: string, runId: string) {
  await assertAiPlanningConsent(userId);
  await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;

    const run = await transaction.weeklyPlanRun.findFirst({
      where: { id: runId, userId },
    });

    if (!run) {
      throw new PlannerError("NOT_FOUND", "Plan request not found.", 404);
    }

    const availability = await getPlanAvailability(userId, transaction);
    checkGenerationCooldown(availability);

    if (availability.pendingRun) {
      throw new PlannerError(
        "ALREADY_GENERATING",
        "Your plan is already being prepared. Check its progress.",
        429,
      );
    }

    if (
      run.status !== "FAILED" ||
      !canRetryPlan(run.errorCode, run.attempts)
    ) {
      throw new PlannerError(
        "RETRY_UNAVAILABLE",
        "This request cannot be retried. Update your preferences and generate again.",
        409,
      );
    }

    await transaction.weeklyPlanRun.update({
      where: { id: runId },
      data: { status: "QUEUED", stage: "queued", errorCode: null, leaseUntil: null, leaseToken: null },
    });
  });

  return getRun(userId, runId);
}
export async function getRun(userId: string, id: string) {
  const run = await prisma.weeklyPlanRun.findFirst({
    where: { id, userId },
    select: {
      id: true,
      status: true,
      stage: true,
      weekStart: true,
      errorCode: true,
      progress: true,
      attempts: true,
      leaseUntil: true,
      plan: {
        select: {
          id: true,
          status: true,
          synthetic: true,
          version: true,
          payload: true,
          model: true,
        },
      },
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!run) {
    throw new PlannerError("NOT_FOUND", "Plan request not found.", 404);
  }

  return {
    ...run,
    retryAt: run.status === 'QUEUED' ? run.leaseUntil?.toISOString() ?? null : null,
    maxAttempts: MAX_PLAN_ATTEMPTS,
    plan: run.plan ? await publicStarterPlan(userId, run.plan) : null,
    canRetry:
      run.status === "FAILED" &&
      canRetryPlan(run.errorCode, run.attempts),
    progress: planProgress(
      run.progress,
      run.status === "COMPLETED" && run.plan !== null,
    ),
  };
}
export async function listPlans(userId: string) {
  const plans = await prisma.weeklyPersonalPlan.findMany({
    where: { userId, synthetic: false },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      weekStart: true,
      version: true,
      status: true,
      synthetic: true,
      payload: true,
      model: true,
    },
  });
  return Promise.all(plans.map((plan) => publicStarterPlan(userId, plan)));
}

export async function listPlanHistory(userId: string, cursor?: string,
    range?: import('../modules/progress/progress_range').ProgressRange) {
  if (cursor) {
    const previous = await prisma.weeklyPersonalPlan.findFirst({
      where: { id: cursor, userId, synthetic: false },
      select: { id: true },
    });

    if (!previous) {
      throw new PlannerError("NOT_FOUND", "Saved week not found.", 404);
    }
  }

  const rows = await prisma.weeklyPersonalPlan.findMany({
    where: planHistoryWhere(userId, range),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    cursor: cursor ? { id: cursor } : undefined,
    skip: cursor ? 1 : 0,
    take: 21,
    select: {
      id: true,
      weekStart: true,
      version: true,
      status: true,
      synthetic: true,
      createdAt: true,
      payload: true,
    },
  });

  const items = rows.slice(0, 20).map(({ payload, ...plan }) => {
    const saved = payload as unknown as WeeklyPlan;

    return {
      ...plan,
      trainingDays:
        saved.workouts?.filter((day) => day.restDay === false).length ?? 0,
      foodPlanIncluded:
        saved.nutrition?.status === "RECOMMENDED" &&
        (saved.nutrition.days?.length ?? 0) > 0,
    };
  });

  return {
    items,
    nextCursor: rows.length > 20 ? items.at(-1)!.id : null,
  };
}

export async function getSavedPlan(userId: string, id: string) {
  const plan = await prisma.weeklyPersonalPlan.findFirst({
    where: { id, userId, synthetic: false },
    select: {
      id: true,
      weekStart: true,
      version: true,
      status: true,
      synthetic: true,
      payload: true,
      model: true,
    },
  });

  if (!plan) {
    throw new PlannerError("NOT_FOUND", "Saved week not found.", 404);
  }

  return publicStarterPlan(userId, plan);
}

export async function saveCompletedPlan(
  runId: string,
  plan: WeeklyPlan,
  leaseToken?: string,
) {
  const savedPlan = await prisma.$transaction(
    async (transaction) => {
      const run = await transaction.weeklyPlanRun.findUniqueOrThrow({
        where: { id: runId },
      });
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${run.userId} FOR UPDATE`;

      const existing = await transaction.weeklyPersonalPlan.findUnique({
        where: { runId },
      });

      if (existing) {
        return existing;
      }

      // Protect completion too, including jobs queued before this restriction.
      const availability = await getPlanAvailability(run.userId, transaction);
      checkGenerationCooldown(availability);

      if (
        leaseToken &&
        (run.status !== "RUNNING" ||
          run.leaseToken !== leaseToken ||
          !run.leaseUntil ||
          run.leaseUntil.getTime() < Date.now())
      ) {
        throw new PlannerError(
          "LEASE_LOST",
          "The job was resumed by another worker.",
        );
      }
      validatePlan(run.input as unknown as Snapshot, plan);

      const latest = await transaction.weeklyPersonalPlan.aggregate({
        where: { userId: run.userId, weekStart: run.weekStart },
        _max: { version: true },
      });

      const saved = await transaction.weeklyPersonalPlan.create({
        data: {
          userId: run.userId,
          runId,
          weekStart: run.weekStart,
          version: (latest._max.version ?? 0) + 1,
          synthetic: plan.synthetic,
          payload: databaseJson(plan),
          model: plan.model,
          promptVersion: plan.promptVersion,
          ruleVersion: plan.ruleVersion,
        },
      });
      // Publishing and saving complete together. A protected/logged week rolls back
      // the whole transaction, so a failed generation does not consume the cooldown.
      if (
        !plan.synthetic &&
        !(run.input as unknown as Snapshot).onboardingStarter
      ) {
        await publishPlan(transaction, run.userId, saved.id);
      }

      await transaction.weeklyPlanRun.update({
        where: { id: runId },
        data: {
          status: "COMPLETED",
          stage: "complete",
          progress: databaseJson({
            ...(run.progress as Record<string, boolean>),
            saved: true,
          }),
          leaseUntil: null,
          leaseToken: null,
          errorCode: null,
        },
      });

      return transaction.weeklyPersonalPlan.findUniqueOrThrow({
        where: { id: saved.id },
      });
    },
    { timeout: 20000 },
  );

  if (savedPlan.status === "ACTIVE") {
    await refreshPlanCaches(savedPlan.userId, savedPlan.weekStart);
  }

  return savedPlan;
}
async function publishPlan(
  transaction: Prisma.TransactionClient,
  userId: string,
  planId: string,
) {
  const row = await transaction.weeklyPersonalPlan.findFirst({
    where: { id: planId, userId },
    include: { run: true },
  });

  if (!row) {
    throw new PlannerError("NOT_FOUND", "Plan not found.", 404);
  }

  if (row.synthetic) {
    throw new PlannerError(
      "TEST_PLAN",
      "Test plans cannot replace your real workout or meal schedule.",
      409,
    );
  }

  if (row.status === "ACTIVE") {
    return { id: row.id, status: row.status };
  }

  if (row.status !== "DRAFT") {
    throw new PlannerError(
      "ARCHIVED_PLAN",
      "Generate a new plan instead of activating an archived version.",
      409,
    );
  }

  const snapshot = row.run.input as unknown as Snapshot;

  const plan = validatePlan(snapshot, row.payload);

  const today = dateInZone(plan.timezone);
  if (
    row.weekStart < today &&
    (!(snapshot.onboardingStarter || snapshot.selectedSchedule) ||
      plan.workouts.every((day) => day.date < today))
  ) {
    throw new PlannerError("PAST_PLAN", "Generate a new upcoming week.", 409);
  }

  const currentProfile = await transaction.onboarding.findUnique({
    where: { userId },
  });

  if (!currentProfile) {
    throw new PlannerError(
      "PROFILE_REQUIRED",
      "Your profile is unavailable.",
      409,
    );
  }

  const freshSnapshot = await loadSnapshot(
    userId,
    snapshot.weekStart,
    snapshot.timezone,
    false,
    transaction,
    snapshot.onboardingStarter === true,
    snapshot.selectedSchedule,
  );

  const comparable = snapshot.onboardingStarter
    ? {
        ...freshSnapshot,
        cutoff: snapshot.cutoff,
        historyStart: snapshot.historyStart,
      }
    : freshSnapshot;
  if (hashContext(comparable) !== hashContext(snapshot)) {
    throw new PlannerError(
      "STALE_PLAN",
      "Your history or preferences changed. Generate an updated plan.",
      409,
    );
  }

  const exerciseIds = plan.workouts.flatMap((workout) =>
    workout.exercises.map((exercise) => exercise.exerciseId),
  );

  if (
    (await transaction.workout.count({
      where: { id: { in: exerciseIds } },
    })) !== new Set(exerciseIds).size
  ) {
    throw new PlannerError(
      "CATALOG_CHANGED",
      "The exercise catalog changed. Generate again.",
      409,
    );
  }

  const dates = plan.workouts.map((workout) => workout.date);

  const startedSessions = await transaction.workoutSession.count({
    where: { userId, date: { in: dates } },
  });

  const oldWorkouts = await transaction.userWorkout.findMany({
    where: { userId, scheduledDate: { in: dates } },
    include: { items: { include: { setLogs: { select: { id: true } } } } },
  });

  // Days the user already started or logged are kept untouched; the rest are replaced.
  const lockedDates = new Set<string>(
    (
      await transaction.workoutSession.findMany({
        where: { userId, date: { in: dates } },
        select: { date: true },
      })
    ).map((session) => session.date),
  );

  for (const workout of oldWorkouts) {
    if (
      workout.status !== "NOT_STARTED" ||
      workout.items.some(
        (index) => index.setLogs.length || index.status !== "NOT_STARTED",
      )
    ) {
      if (workout.scheduledDate) {
        lockedDates.add(workout.scheduledDate);
      }
    }
  }

  if (lockedDates.size === dates.length) {
    throw new PlannerError(
      "WEEK_STARTED",
      "Every day of this week is already started or logged. Pick another week.",
      409,
    );
  }

  const oldMeal = await transaction.userMealPlan.findUnique({
    where: { userId_weekLabel: { userId, weekLabel: plan.weekStart } },
    include: { items: true },
  });

  const mealsLocked = Boolean(
    oldMeal?.items.some(
      (index) => index.status !== "PENDING" || index.mealLogId,
    ),
  );

  for (const day of plan.workouts) {
    if (day.date < today) continue;
    if (lockedDates.has(day.date)) {
      continue;
    }

    const previous = oldWorkouts.find(
      (workout) => workout.scheduledDate === day.date,
    );

    if (previous) {
      await transaction.userWorkout.delete({ where: { id: previous.id } });
    } // Only wholly unstarted drafts checked above.
    await transaction.workoutDay.upsert({
      where: { userId_date: { userId, date: day.date } },
      create: {
        userId,
        date: day.date,
        name: day.name,
        restDay: day.restDay,
      },
      update: { name: day.name, restDay: day.restDay },
    });

    if (!day.restDay) {
      await transaction.userWorkout.create({
        data: {
          userId,
          weekLabel: plan.weekStart,
          scheduledDate: day.date,
          aiNote: plan.summary,
          warmup: day.warmup ? databaseJson(day.warmup) : undefined,
          items: {
            create: day.exercises.map((exercise, index) => ({
              workoutId: exercise.exerciseId,
              dayOfWeek: weekday(day.date) as DayOfWeek,
              orderIndex: index,
              targetSets: exercise.sets,
              targetReps:
                exercise.repsMin === exercise.repsMax
                  ? String(exercise.repsMax)
                  : `${exercise.repsMin}-${exercise.repsMax}`,
              targetWeight: exercise.weightKg,
              setTargets: databaseJson({
                weightBasis: exercise.weightBasis,
                weightUnit: exercise.weightUnit ?? "as_logged",
                sets: exercise.setPrescriptions,
              }),
              targetRpe: exercise.targetRpe,
              restSeconds: exercise.restSeconds,
              sourceProvider: "USER",
            })),
          },
        },
      });
    }
  }

  if (plan.nutrition.status === "RECOMMENDED" && !mealsLocked) {
    const foodIds = plan.nutrition.days.flatMap((nutritionDay) =>
      nutritionDay.meals.filter(meal => !meal.routineId).flatMap((meal) =>
        meal.foods.map((food) => food.foodId),
      ),
    );

    if (
      (await transaction.nutrition.count({
        where: {
          id: { in: foodIds },
          userId: null,
          isVerified: true,
          isArchived: false,
        },
      })) !== new Set(foodIds).size
    ) {
      throw new PlannerError(
        "CATALOG_CHANGED",
        "The food catalog changed. Generate again.",
        409,
      );
    }

    if (oldMeal) {
      await transaction.userMealPlan.delete({ where: { id: oldMeal.id } });
    }
    await transaction.userMealPlan.create({
      data: {
        userId,
        weekLabel: plan.weekStart,
        aiNote: plan.nutrition.reason,
        items: {
          create: plan.nutrition.days.flatMap((nutritionDay) =>
            nutritionDay.meals.filter(meal => !meal.routineId).flatMap((meal) =>
              meal.foods.map((food) => ({
                nutritionId: food.foodId,
                dayOfWeek: weekday(nutritionDay.date) as DayOfWeek,
                mealType: meal.mealType,
                mealName: food.name,
                servings: food.grams! / 100,
                targetCalories: food.nutrients.calories,
                targetProtein: food.nutrients.protein,
                targetCarbs: food.nutrients.carbs,
                targetFat: food.nutrients.fat,
                status: "PENDING",
              })),
            ),
          ),
        },
      },
    });
  }
  await transaction.weeklyPersonalPlan.updateMany({
    where: { userId, weekStart: plan.weekStart, status: "ACTIVE" },
    data: { status: "ARCHIVED" },
  });
  await transaction.weeklyPersonalPlan.update({
    where: { id: row.id },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });

  return { id: row.id, status: "ACTIVE" };
}

async function refreshPlanCaches(userId: string, weekStart: string) {
  await Promise.allSettled([
    invalidateUserWorkoutCache(userId),
    invalidateUserNutritionCache(
      userId,
      weekStart.slice(8),
      weekStart.slice(5, 7),
      weekStart.slice(0, 4),
    ),
    invalidateMealPlanCache(userId, weekStart),
  ]);
}

export async function activatePlan(userId: string, planId: string) {
  const result = await prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;

      return publishPlan(transaction, userId, planId);
    },
    { timeout: 20000 },
  );

  const plan = await prisma.weeklyPersonalPlan.findUniqueOrThrow({
    where: { id: planId },
    select: { weekStart: true },
  });

  await refreshPlanCaches(userId, plan.weekStart);

  return result;
}

export async function assertFreshPlan(userId: string, id: string) {
  const savedPlan = await prisma.weeklyPersonalPlan.findFirst({
    where: { id, userId },
    include: { run: true },
  });

  if (!savedPlan) {
    throw new PlannerError("NOT_FOUND", "Plan not found.", 404);
  }

  if (savedPlan.status === "ACTIVE") {
    return;
  }

  const previous = savedPlan.run.input as unknown as Snapshot;

  const freshSnapshot = await loadSnapshot(
    userId,
    previous.weekStart,
    previous.timezone,
    previous.synthetic,
    prisma,
    previous.onboardingStarter === true,
    previous.selectedSchedule,
  );

  const comparable = previous.onboardingStarter
    ? {
        ...freshSnapshot,
        cutoff: previous.cutoff,
        historyStart: previous.historyStart,
      }
    : freshSnapshot;
  if (hashContext(comparable) !== hashContext(previous)) {
    throw new PlannerError(
      "STALE_PLAN",
      "Your history or preferences changed. Generate an updated plan.",
      409,
    );
  }
}
