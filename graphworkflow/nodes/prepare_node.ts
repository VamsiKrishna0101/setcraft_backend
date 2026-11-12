import { activeLimitations, explicitExcludedMuscles } from "../common/constraints";
import { resolvedSplit, focusedGroups } from "../common/training_style";
import {
  SelectedSchedule,
  validateSelectedSchedule,
} from "../common/calendar_schedule";
import { weekday } from "../../modules/workout/session/session_types";
import { PlannerState, StageReporter } from "../common/state";
import { Region, REGIONS, TrainingDay } from "../common/types";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../config/prisma";
import { preferredExerciseMedia } from '../../utils/exercise_media';
import {
  realMealWhere,
  realSnapshotWhere,
  isRealBodyEntry,
} from "../../utils/real_data";
import { metricsSchema } from "../../modules/body/body_types";
import { mapExercise } from "../../modules/heatmap/training_map_engine";
import {
  Snapshot,
  Profile,
  PlannerError,
  addDays,
  dateInZone,
  PROMPT_VERSION,
  RULE_VERSION,
  planSchema,
} from "../common/types";
import {
  curatedExercise,
  equipmentAllowed,
  curatedFood,
  foodAllowed,
} from "../common/catalog";
import { buildRegionInput, isFocusedRegion } from "../common/region_input";
import { exerciseEligible } from "../common/coaching";
import { exerciseRules } from "../common/loading";
import { prescriptionSeconds } from "../common/session_quality";
import { enteredMeasurements, plannerSnapshot } from "../common/measurements";
import { contentLocale } from "../../utils/app_locale";
import {
  nutritionSettings,
  routineMealsForWeek,
} from "../../modules/nutrition/food_planning_service";

function setTarget(value: unknown, setNumber: number) {
  const targets = value as {
    sets?: Array<{ setNumber: number; repsMin: number; repsMax: number }>;
  } | null;
  return targets?.sets?.find((set) => set.setNumber === setNumber);
}

// Keep every valid metric of a scan instead of dropping the whole scan for one bad value.
function validMetrics(metrics: unknown) {
  const valid: Record<string, unknown> = {};

  if (metrics && typeof metrics === "object") {
    for (const [key, value] of Object.entries(metrics)) {
      if (metricsSchema.safeParse({ [key]: value }).success) {
        valid[key] = value;
      }
    }
  }

  return valid;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_, entry) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)),
        )
      : entry,
  );
}

export function hashContext(snapshot: Snapshot) {
  // Database rows and JSONB keys have no meaningful order. Profile arrays retain
  // their order; only the top-level collections are compared as collections.
  const context = Object.fromEntries(
    Object.entries(plannerSnapshot(snapshot))
      .filter(([key]) => key !== "onboardingStarter")
      .map(([key, value]) => [
        key,
        Array.isArray(value)
          ? [...value].sort((a, b) =>
              canonicalJson(a).localeCompare(canonicalJson(b)),
            )
          : value,
      ]),
  );

  return createHash("sha256")
    .update(
      canonicalJson({
        snapshot: context,
        promptVersion: PROMPT_VERSION,
        ruleVersion: RULE_VERSION,
      }),
    )
    .digest("hex");
}
export async function loadSnapshot(
  userId: string,
  weekStart: string,
  timezone: string,
  includeDemo = false,
  db: Prisma.TransactionClient = prisma,
  onboardingStarter = false,
  selectedSchedule?: SelectedSchedule,
): Promise<Snapshot> {
  if (includeDemo) {
    throw new PlannerError(
      "DEMO_HISTORY_DISABLED",
      "Plans use your real profile and saved history only.",
    );
  }
  const today = dateInZone(timezone);
  const selected = selectedSchedule
    ? validateSelectedSchedule(weekStart, today, selectedSchedule)
    : undefined;

  if (
    !onboardingStarter &&
    new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== 1
  ) {
    throw new PlannerError(
      "INVALID_WEEK",
      "Choose a Monday for the start of your plan.",
    );
  }

  if (
    (onboardingStarter || selected
      ? addDays(weekStart, 6) < today
      : weekStart < today) ||
    weekStart > addDays(today, 28)
  ) {
    throw new PlannerError(
      "INVALID_WEEK",
      "Generate an upcoming week within the next four weeks.",
    );
  }

  const cutoff = addDays(today, -1);

  const historyStart = addDays(cutoff, -20);

  const profile = await db.onboarding.findUnique({ where: { userId } });
  const foodSettings = await nutritionSettings(userId, db);
  const routineMeals =
    foodSettings.mode === "TRACK"
      ? []
      : await routineMealsForWeek(userId, weekStart, db);

  if (!profile) {
    throw new PlannerError(
      "PROFILE_REQUIRED",
      "Finish your training preferences first.",
    );
  }

  const trainingProfile: Profile = {
    nutritionMode: foodSettings.mode as Profile["nutritionMode"],
    mealSlots: foodSettings.mealSlots as Profile["mealSlots"],
    age: profile.age,
    gender: profile.gender,
    height: profile.height,
    weight: profile.weight,
    targetWeight: profile.targetWeight ?? null,
    goal: profile.workingToward,
    experience: profile.experience,
    daysPerWeek: Math.min(
      6,
      Number(profile.daysPerWeek.match(/\d+/)?.[0] ?? 3),
    ),
    minutes: Math.min(
      90,
      Number(profile.workoutDuration.match(/\d+/)?.[0] ?? 45),
    ),
    trainingDays: profile.trainingDays,
    trainingSplit: profile.trainingSplit as Profile["trainingSplit"],
    customTrainingSplit:
      profile.customTrainingSplit as Profile["customTrainingSplit"],
    equipment: profile.equipment,
    equipmentIds: profile.equipmentIds,
    location: profile.trainingLocation,
    limitations: profile.limitations,
    customLimitations: profile.customLimitations,
    focusMuscles: profile.focusMuscles,
    language: profile.language,
    eatingStyle: profile.eatingStyle,
    activityLevel: profile.activityLevel,
    sleepDuration: profile.sleepDuration,
    preferredTime: profile.preferredTime,
    customEatingStyle: profile.customEatingStyle,
    weeklyFoodBudget: profile.weeklyFoodBudget,
    allergies: profile.foodAllergies,
    dislikes: profile.dislikedFoods,
    countryCode: profile.countryCode,
    budgetAmount: profile.foodBudgetAmount,
    budgetCurrency: profile.foodBudgetCurrency,
  };

  if (trainingProfile.age < 18) {
    throw new PlannerError(
      "ADULT_PROFILE_REQUIRED",
      "This planner currently supports adult training profiles.",
    );
  }

  const dates = Array.from({ length: 21 }, (_, index) =>
    addDays(historyStart, index),
  );

  const years = [...new Set(dates.map((date) => date.slice(0, 4)))];

  const months = [
    ...new Set(
      dates.flatMap((date) => [
        date.slice(5, 7),
        String(Number(date.slice(5, 7))),
      ]),
    ),
  ];

  const range = { userId, year: { in: years }, month: { in: months } };
  // Query actual calendar fields, not createdAt: backfilled sets retain their workout date.

  const [
    setRows,
    exerciseRows,
    foodRows,
    sessions,
    wellness,
    health,
    meals,
    water,
    savedBodyAssessments,
    muscleCheckIns,
    previousPlan,
  ] = await Promise.all([
    db.workoutSetLog.findMany({
      where: {
        ...range,
        workoutItem: { sourceProvider: "USER", userWorkout: { userId } },
      },
      orderBy: [
        { year: "asc" },
        { month: "asc" },
        { day: "asc" },
        { setNumber: "asc" },
        { id: "asc" },
      ],
      select: {
        id: true,
        userWorkoutItemId: true,
        setNumber: true,
        day: true,
        month: true,
        year: true,
        reps: true,
        weight: true,
        rpe: true,
        workoutItem: {
          select: {
            workoutId: true,
            targetReps: true,
            targetSets: true,
            setTargets: true,
            workout: {
              select: {
                id: true,
                name: true,
                bodyPart: true,
                target: true,
                muscleGroup: true,
                secondaryMuscles: true,
              },
            },
          },
        },
      },
    }),
    db.workout.findMany({
      where: { catalogStatus: { notIn: ["STAGED", "ARCHIVED"] } },
      select: {
        id: true,
        name: true,
        namesByLang: true,
        equipment: true,
        difficulty: true,
        coachingMetadata: true,
        mediaVariants: true,
        target: true,
        muscleGroup: true,
        bodyPart: true,
        secondaryMuscles: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.nutrition.findMany({
      where: { userId: null, isVerified: true, isArchived: false },
      select: {
        id: true,
        name: true,
        servingUnit: true,
        servingSize: true,
        caloriesPerServing: true,
        proteinPerServing: true,
        carbsPerServing: true,
        fatPerServing: true,
        imageUrl: true,
        sourceName: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.workoutSession.findMany({
      where: { userId, date: { gte: historyStart, lte: cutoff } },
      include: {
        userWorkout: {
          include: {
            items: { select: { targetSets: true, sourceProvider: true } },
          },
        },
      },
      orderBy: { date: "asc" },
    }),
    db.dailyWellnessEntry.findMany({
      where: { userId, date: { gte: historyStart, lte: today } },
      orderBy: { date: "asc" },
    }),
    db.healthKitSnapshot.findMany({
      where: {
        userId,
        date: { gte: historyStart, lte: today },
        AND: [realSnapshotWhere],
      },
      orderBy: { date: "asc" },
    }),
    db.userMealLog.findMany({
      where: { ...range, status: "LOGGED", AND: [realMealWhere] },
      include: {
        nutrition: {
          select: { name: true, servingSize: true, servingUnit: true },
        },
      },
    }),
    db.userWaterLog.findMany({ where: { ...range, sourceProvider: "USER" } }),
    db.bodyAssessment.findMany({
      // Entered measurements recorded today can inform an upcoming plan.
      where: {
        userId,
        status: "SAVED",
        recordedDate: { lte: dateInZone(timezone) },
      },
      orderBy: [
        { recordedDate: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
      select: {
        id: true,
        recordedDate: true,
        metrics: true,
        method: true,
        quality: true,
        analysisVersion: true,
      },
    }),
    db.muscleCheckIn.findMany({
      where: { userId, date: { gte: historyStart, lte: today } },
      select: { id: true, muscleId: true, date: true, soreness: true },
      orderBy: [{ date: "asc" }, { muscleId: "asc" }],
    }),
    db.weeklyPersonalPlan.findFirst({
      where: {
        userId,
        synthetic: false,
        status: { in: ["ACTIVE", "ARCHIVED"] },
        weekStart: { lt: weekStart },
      },
      orderBy: [{ weekStart: "desc" }, { version: "desc" }],
      select: { id: true, weekStart: true, payload: true },
    }),
  ]);

  const dateOf = (record: { day: string; month: string; year: string }) =>
    `${record.year}-${record.month.padStart(2, "0")}-${record.day.padStart(2, "0")}`;

  const within = (date: string) => date >= historyStart && date <= cutoff;

  const sets = setRows
    .map((record) => ({
      id: record.id,
      exerciseId: record.workoutItem.workoutId,
      workoutItemId: record.userWorkoutItemId,
      date: dateOf(record),
      set: record.setNumber,
      reps: record.reps,
      weight: record.weight,
      rpe: record.rpe,
      synthetic: false,
      exerciseName: record.workoutItem.workout.name,
      primaryMuscles: mapExercise(record.workoutItem.workout).primary,
      secondaryMuscles: mapExercise(record.workoutItem.workout).secondary,
      plannedRepsMin:
        setTarget(record.workoutItem.setTargets, record.setNumber)?.repsMin ??
        (Number(record.workoutItem.targetReps.match(/\d+/)?.[0]) || null),
      plannedRepsMax:
        setTarget(record.workoutItem.setTargets, record.setNumber)?.repsMax ??
        (Number(record.workoutItem.targetReps.match(/\d+/g)?.at(-1)) || null),
      plannedSets: record.workoutItem.targetSets,
      weightUnit: (
        record.workoutItem.setTargets as {
          weightUnit?: "per_hand" | "total_load" | "as_logged" | "bodyweight";
        } | null
      )?.weightUnit,
    }))
    .filter((record) => within(record.date))
    .sort(
      (first, second) =>
        first.date.localeCompare(second.date) ||
        first.set - second.set ||
        first.id.localeCompare(second.id),
    );

  const bodyAssessments = savedBodyAssessments.filter(isRealBodyEntry);
  const recentWeight = bodyAssessments
    .filter((entry) => entry.recordedDate >= addDays(today, -30))
    .map(
      (entry) =>
        validMetrics(entry.metrics).weightKg as
          { value: number; source: string } | undefined,
    )
    .find(
      (metric) => metric && ["scale", "smart_scale"].includes(metric.source),
    );
  if (recentWeight) trainingProfile.weight = recentWeight.value;

  const previous = previousPlan && planSchema.safeParse(previousPlan.payload);

  const snapshot: Snapshot = {
    version: 1,
    ...(onboardingStarter ? { onboardingStarter: true } : {}),
    ...(selected ? { selectedSchedule: selected } : {}),
    userId,
    weekStart,
    timezone,
    cutoff,
    recoveryCutoff: today,
    historyStart,
    synthetic: false,
    profile: trainingProfile,
    routineMeals,
    ...(muscleCheckIns.length ? { muscleCheckIns } : {}),
    ...(previousPlan &&
      previous?.success && {
        programmeMemory: {
          planId: previousPlan.id,
          weekStart: previousPlan.weekStart,
          programme: previous.data.programme,
          exerciseIds: [
            ...new Set(
              previous.data.workouts.flatMap((day) =>
                day.exercises.map((e) => e.exerciseId),
              ),
            ),
          ],
        },
      }),
    candidates: exerciseRows
      .filter(row => preferredExerciseMedia(row.mediaVariants, trainingProfile.gender === 'FEMALE' ? 'female' : 'male'))
      .map((row) => {
        const candidate = curatedExercise(row);
        const names = row.namesByLang as Record<string, unknown> | null;
        const name = names?.[contentLocale(trainingProfile.language)];
        return onboardingStarter && candidate && typeof name === "string"
          ? { ...candidate, displayName: name }
          : candidate;
      })
      .filter(
        (candidate): candidate is NonNullable<typeof candidate> =>
          !!candidate &&
          equipmentAllowed(candidate, trainingProfile),
      ),
    foods: foodRows
      .map(curatedFood)
      .filter(
        (food): food is NonNullable<typeof food> =>
          !!food && foodAllowed(food, trainingProfile),
      ),
    sets,
    sessions: sessions.map((record) => ({
      date: record.date,
      status: record.status,
      durationSeconds: record.durationSeconds,
      plannedSets: record.userWorkout.items
        .filter((item) => item.sourceProvider === "USER")
        .reduce((total, item) => total + item.targetSets, 0),
      loggedSets: sets.filter((entry) => entry.date === record.date).length,
    })),
    wellness: wellness.map((record) => ({
      date: record.date,
      sleepMinutes: record.sleepMinutes,
      energy: record.energy,
      rested: record.rested,
      soreness: record.soreness,
      source: record.source,
    })),
    health: health.map((record) => ({
      date: record.date,
      steps: record.steps,
      sleepMinutes: record.sleepTotalMinutes,
      hrv: record.hrv,
      restingHR: record.restingHR,
      source: record.sourceProvider,
    })),
    meals: meals
      .map((record) => ({
        date: dateOf(record),
        foodId: record.nutritionId,
        name: record.nutrition.name,
        mealType: record.mealType,
        servings: record.servings,
        grams:
          record.nutrition.servingUnit === "g"
            ? record.servings * record.nutrition.servingSize
            : null,
        calories: record.calories,
        protein: record.protein,
        carbs: record.carbs,
        fat: record.fat,
        synthetic: false,
      }))
      .filter((record) => within(record.date)),
    water: water
      .map((record) => ({
        date: dateOf(record),
        amountMl: record.amountMl,
        synthetic: false,
      }))
      .filter((record) => within(record.date)),
    measurements: enteredMeasurements(
      bodyAssessments
        .map((record) => ({
          id: record.id,
          date: record.recordedDate,
          metrics: validMetrics(record.metrics),
          source: record.method,
        }))
        .filter((record) => Object.keys(record.metrics).length > 0),
    ),
    coverage: { loggedDays: 0, weeksWithLogs: 0, syntheticDays: 0 },
  };

  snapshot.sets.sort(
    (first, second) =>
      first.date.localeCompare(second.date) || first.set - second.set,
  );

  const loggedDays = [...new Set(snapshot.sets.map((entry) => entry.date))];
  snapshot.coverage = {
    loggedDays: loggedDays.length,
    weeksWithLogs: new Set(
      loggedDays.map((date) =>
        Math.floor(
          (Date.parse(date) - Date.parse(historyStart)) / 86400000 / 7,
        ),
      ),
    ).size,
    syntheticDays: new Set(
      snapshot.sets
        .filter((entry) => entry.synthetic)
        .map((entry) => entry.date),
    ).size,
  };

  snapshot.candidates = snapshot.candidates.filter((candidate) =>
    exerciseEligible(snapshot, candidate),
  );
  // Validate the training schedule; body measurements are optional context.

  trainingSchedule(snapshot);
  return snapshot;
}

export function trainingDates(snapshot: Snapshot) {
  if (snapshot.selectedSchedule)
    return [...snapshot.selectedSchedule.trainingDates];
  const days = Array.from({ length: 7 }, (_, index) =>
    addDays(snapshot.weekStart, index),
  );

  if (snapshot.profile.trainingDays.length) {
    const preferred = snapshot.profile.trainingDays.map((date) =>
      date.toUpperCase(),
    );

    if (
      new Set(preferred).size !== preferred.length ||
      preferred.some(
        (date) =>
          ![
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ].includes(date),
      )
    ) {
      throw new PlannerError(
        "INVALID_SCHEDULE",
        "Update your training days first.",
      );
    }

    if (preferred.length > 6) {
      throw new PlannerError(
        "REST_DAY_REQUIRED",
        "Choose at least one rest day.",
      );
    }

    return days.filter((date) => preferred.includes(weekday(date)));
  }

  const indexes: Record<number, number[]> = {
    2: [0, 3],
    3: [0, 2, 4],
    4: [0, 1, 3, 4],
    5: [0, 1, 2, 4, 5],
    6: [0, 1, 2, 3, 4, 5],
  };

  return (indexes[snapshot.profile.daysPerWeek] ?? indexes[3]!).map(
    (index) => days[index]!,
  );
}

export function trainingSchedule(snapshot: Snapshot): TrainingDay[] {
  const dates = trainingDates(snapshot);
  const canTrain = (region: Region) =>
    snapshot.candidates.some(
      (candidate) =>
        candidate.region === region && exerciseEligible(snapshot, candidate),
    );
  const home = snapshot.profile.location === "HOME";

  const configuredSplit = resolvedSplit(snapshot.profile, dates.length);
  // A short first week needs coverage, not the first two days of a six-day split.
  const split =
    (snapshot.selectedSchedule || snapshot.onboardingStarter) &&
    dates.length < 3 &&
    configuredSplit !== "CUSTOM"
      ? "FULL_BODY"
      : snapshot.onboardingStarter &&
          configuredSplit === "MUSCLE_FOCUSED" &&
          dates.length < 3 &&
          snapshot.profile.minutes < 30
        ? "FULL_BODY"
        : configuredSplit;

  const upper: Region[] = ["chest", "back", "shoulders", "biceps", "triceps"];

  const lower: Region[] = ["legs", "core"];

  const pushPullLegs: Region[][] = [
    ["chest", "shoulders", "triceps"],
    ["back", "biceps"],
    ["legs", "core"],
  ];

  if (split === "PUSH_PULL_LEGS" && dates.length < 3) {
    throw new PlannerError(
      "INVALID_SPLIT",
      "Push / pull / legs needs at least three training days.",
      422,
    );
  }

  if (
    split === "MUSCLE_FOCUSED" &&
    dates.length < 3 &&
    snapshot.profile.minutes < 30
  )
    throw new PlannerError(
      "INVALID_SPLIT",
      "For two short sessions, choose full body or allow at least 30 minutes for a muscle-focused split.",
      422,
    );

  const hasLimitations =
    explicitExcludedMuscles(snapshot.profile).size > 0 ||
    activeLimitations(snapshot.profile).size > 0;
  const trainableRegions = REGIONS.filter((region) => canTrain(region));

  return dates.map((date, index) => {
    let regions: Region[];

    if (split === "CUSTOM") {
      regions = snapshot.profile.customTrainingSplit?.[weekday(date)] ?? [];

      if (
        !regions.length ||
        regions.some((region) => !REGIONS.includes(region))
      ) {
        if (!snapshot.onboardingStarter) {
          throw new PlannerError(
            "INVALID_SPLIT",
            "Choose muscles for every custom training day.",
            422,
          );
        }
        regions = trainableRegions.slice(0, 3);
      }
    } else if (split === "MUSCLE_FOCUSED") {
      regions = focusedGroups(dates.length)[index]!;
    } else if (split === "PUSH_PULL_LEGS") {
      regions = pushPullLegs[index % 3]!;
    } else if (split === "UPPER_LOWER") {
      if (index % 2 === 0 && snapshot.profile.minutes < 30) {
        const accessory: Region[] = ["shoulders", "biceps", "triceps"];
        regions = [
          "chest",
          "back",
          accessory[Math.floor(index / 2) % accessory.length]!,
        ];
      } else regions = index % 2 === 0 ? upper : lower;
    } else {
      regions = (["chest", "back", "legs"] as Region[]).filter(
        (region) => region !== "back" || !home || canTrain(region),
      );

      if (snapshot.profile.minutes >= 30 || regions.length < 3) {
        const accessories: Region[] = (
          ["core", "shoulders", "biceps", "triceps"] as Region[]
        ).filter((region) => canTrain(region));
        const focusedAccessory = accessories.find((region) =>
          isFocusedRegion(snapshot.profile.focusMuscles, region),
        );
        const ordered = focusedAccessory
          ? [
              focusedAccessory,
              ...accessories.filter((region) => region !== focusedAccessory),
            ]
          : accessories;

        if (ordered.length) regions.push(ordered[index % ordered.length]!);
      }
    }

    regions = [...new Set(regions)];
    // Respect explicit muscle exclusions and injury limitations even when a whole region is excluded.
    if (hasLimitations || snapshot.onboardingStarter) {
      regions = regions.filter((region) => canTrain(region));
    }
    if (home && split !== "CUSTOM" && split !== "MUSCLE_FOCUSED") {
      regions = regions.filter(
        (region) => ["chest", "legs"].includes(region) || canTrain(region),
      );
    }
    if (!regions.length && snapshot.onboardingStarter && trainableRegions.length) {
      const compoundFallback = trainableRegions.filter((r) =>
        ["chest", "back", "legs"].includes(r),
      );
      const accessoryFallback = trainableRegions.filter(
        (r) => !["chest", "back", "legs"].includes(r),
      );
      regions = compoundFallback.length
        ? [
            ...compoundFallback.slice(0, 3),
            ...(accessoryFallback.length
              ? [accessoryFallback[index % accessoryFallback.length]!]
              : []),
          ]
        : trainableRegions.slice(0, 3);
    }
    if (!regions.length)
      throw new PlannerError(
        "INVALID_SPLIT",
        "Your equipment and movement restrictions leave no exercises for this session. Choose other muscle groups or review your training preferences.",
        422,
      );

    const availableMinutes = snapshot.profile.minutes - 5;

    const minimumShareFor = (region: Region) => {
      const durations = snapshot.candidates
        .filter((c) => c.region === region && exerciseEligible(snapshot, c))
        .map((candidate) => {
          const rules = exerciseRules(snapshot, candidate, false);
          return (
            prescriptionSeconds(2, rules.minReps, rules.minRestSeconds) / 60
          );
        });
      return durations.length ? Math.min(...durations) : 4;
    };

    if (snapshot.onboardingStarter) {
      while (
        regions.length > 1 &&
        regions.reduce((sum, region) => sum + minimumShareFor(region), 0) >
          availableMinutes
      ) {
        regions = regions.slice(0, -1);
      }
    }

    const minutesPerRegion = availableMinutes / regions.length;

    // Allocate by useful movement work, not equal shares for an entire lower
    // body and a core accessory. Granular goals (glutes/lats/etc.) map to regions.
    const baseWeight: Record<Region, number> = {
      chest: 1,
      back: 1.25,
      legs: regions.length <= 2 ? 3.5 : 1.65,
      shoulders: 0.7,
      biceps: 0.6,
      triceps: 0.6,
      core: 0.65,
    };
    const weights = regions.map(
      (region) =>
        baseWeight[region] *
        (isFocusedRegion(snapshot.profile.focusMuscles, region) ? 1.3 : 1),
    );

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

    const minimumShares = regions.map(minimumShareFor);
    const minimumTotal = minimumShares.reduce((sum, m) => sum + m, 0);
    if (minimumTotal > availableMinutes)
      throw new PlannerError(
        "INVALID_SPLIT",
        "These muscle groups do not fit your session time with appropriate rest. Choose fewer muscles or a longer session.",
        422,
      );
    const flexibleMinutes = Math.max(0, availableMinutes - minimumTotal);
    const minutesByRegion = Object.fromEntries(
      regions.map((region, position) => [
        region,
        minimumShares[position]! +
          (flexibleMinutes * weights[position]!) / totalWeight,
      ]),
    ) as Partial<Record<Region, number>>;

    const isBeginner = snapshot.profile.experience === "BEGINNER";
    const isDedicatedDay = regions.length === 1;
    const isFullBody = split === "FULL_BODY";

    const maxSlotsForRegion = (region: Region) => {
      const isFocus = isFocusedRegion(snapshot.profile.focusMuscles, region);
      if (isDedicatedDay) {
        return isBeginner ? 4 : 5;
      }
      if (isFullBody) {
        if (snapshot.profile.minutes >= 40 && ["legs", "back"].includes(region))
          return 2;
        return isFocus && snapshot.profile.minutes >= 55 ? 2 : 1;
      }
      if (region === "legs") return isBeginner ? 3 : 4;
      return isFocus ? 3 : isBeginner ? 2 : 3;
    };

    const exerciseSlots = Object.fromEntries(
      regions.map((region) => [
        region,
        Math.max(
          1,
          Math.min(
            maxSlotsForRegion(region),
            Math.floor((minutesByRegion[region] ?? 0) / 4),
          ),
        ),
      ]),
    ) as Partial<Record<Region, number>>;

    return {
      date,
      regions,
      minutesPerRegion,
      minutesByRegion,
      exerciseSlots,
    };
  });
}

export async function prepareNode(
  state: PlannerState,
  reportStage: StageReporter,
) {
  const snapshot = plannerSnapshot(state.snapshot);

  const schedule = trainingSchedule(snapshot);

  const inputs = {} as Record<Region, Record<string, unknown>>;

  for (const region of REGIONS) {
    const input = buildRegionInput(snapshot, schedule, region);

    if (input.days.length && !input.exercises.length) {
      throw new PlannerError(
        "CATALOG_GAP",
        `No ${region} exercises match your equipment and movement restrictions. Review your split or equipment.`,
        422,
      );
    }

    inputs[region] = input;
  }

  await reportStage("specialists", "history");

  return { snapshot, schedule, inputs, promptVersion: PROMPT_VERSION };
}
