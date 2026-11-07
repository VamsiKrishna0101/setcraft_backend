import prisma from "../../config/prisma";
import {
  previewDays,
  previewTraining,
  PreviewPayload,
} from "../progress/preview/preview_data";
import { monday, shiftDate } from "../progress/progress_range";
import { MUSCLE_IDS, buildTrainingMap } from "../heatmap/training_map_engine";
import { localizeTrainingMap } from "../heatmap/training_map_locale";
import { calcTargets } from "../home/home_service";
import { formatExercise } from "../workout/workout_service";
import { fitnessTerm, localizedExercise } from "../../utils/fitness_locale";

export async function previewStatus(owner: string) {
  const [first, last, count] = await Promise.all([
    prisma.progressPreviewDay.findFirst({
      where: { userId: owner },
      orderBy: { date: "asc" },
      select: { date: true },
    }),
    prisma.progressPreviewDay.findFirst({
      where: { userId: owner },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
    prisma.progressPreviewDay.count({ where: { userId: owner } }),
  ]);
  return {
    available: count > 0,
    days: count,
    start: first?.date,
    end: last?.date,
  };
}

async function context(owner: string, date: string) {
  const days = await previewDays(owner, date);
  const day = days.find((row) => row.date === date);
  const profile = await prisma.onboarding.findUnique({
    where: { userId: owner },
  });
  return { days, day, profile };
}

export async function previewHeatmap(
  owner: string,
  date: string,
  offset: number,
  locale: string,
) {
  const [training, profile] = await Promise.all([
    previewTraining(owner, date),
    prisma.onboarding.findUnique({ where: { userId: owner } }),
  ]);
  const map = buildTrainingMap({
    date,
    utcOffsetMinutes: offset,
    sets: training.sets.map((set) => ({
      id: set.id,
      itemId: set.userWorkoutItemId,
      setNumber: set.setNumber,
      date: set.date,
      weight: set.weight,
      reps: set.reps,
      exercise: set.workoutItem.workout,
    })),
    planned: [],
    checkIns: [],
    focusMuscles: [],
    limitations: [],
  });
  return {
    ...localizeTrainingMap(map, locale, new Map()),
    gender: profile?.gender,
    source: "preview",
    countingMethod: "Preview data",
    planId: null,
  };
}

export async function previewTrainingDay(
  owner: string,
  date: string,
  locale: string,
) {
  const { days, day } = await context(owner, date);
  const sample = day?.data;
  const exerciseIds = [
    ...new Set(sample?.sets.map((set) => set.exerciseId) ?? []),
  ];
  const catalog = await prisma.workout.findMany({
    where: { id: { in: exerciseIds } },
  });
  const items = exerciseIds.flatMap((id) => {
    const exercise = catalog.find((row) => row.id === id);
    const sets = sample!.sets.filter((set) => set.exerciseId === id);
    if (!exercise) return [];
    return [
      {
        id: sets[0]!.itemId,
        status: "COMPLETED",
        targetSets: sets.length,
        targetReps: sets[0]!.reps,
        targetWeight: sets[0]!.weight ?? 0,
        restSeconds: 90,
        workout: localizedExercise(formatExercise(exercise), locale),
        setLogs: sets,
      },
    ];
  });
  return {
    date,
    source: "preview",
    name: fitnessTerm(sample?.session?.name ?? "Workout", locale),
    restDay: !!day && !sample?.session,
    session: sample?.session
      ? {
          ...sample.session,
          status: "COMPLETED",
          startedAt: `${date}T12:00:00Z`,
          finishedAt: `${date}T13:00:00Z`,
        }
      : null,
    planId: sample?.session?.id ?? null,
    items,
    summary: {
      sets: sample?.sets.length ?? 0,
      completed: items.length,
      skipped: 0,
      volume:
        sample?.sets.reduce(
          (total, set) => total + (set.weight ?? 0) * set.reps,
          0,
        ) ?? 0,
    },
    week: Array.from({ length: 7 }, (_, index) => {
      const value = shiftDate(monday(date), index);
      const saved = days.find((row) => row.date === value);
      return {
        date: value,
        status: saved
          ? saved.data.session
            ? "COMPLETED"
            : "REST_DAY"
          : "EMPTY",
      };
    }),
    routines: [
      {
        id: "preview-upper",
        name: fitnessTerm("Upper body", locale),
        count: 4,
      },
      {
        id: "preview-lower",
        name: fitnessTerm("Lower body", locale),
        count: 4,
      },
    ],
  };
}

export async function previewNutrition(
  owner: string,
  date: string,
  locale = "en",
) {
  const { day, profile } = await context(owner, date);
  const n = day?.data.nutrition;
  const t = profile ? calcTargets(profile) : null;
  const portions = [0.25, 0.35, 0.4];
  const names = [
    "Oats, yogurt & fruit",
    "Rice & grilled chicken",
    "Salmon & roasted vegetables",
  ];
  const logs = n
    ? portions.map((part, index) => {
        const calories = Math.round(n.calories * part);
        const protein = Math.round(n.protein * part * 10) / 10;
        const carbs = Math.round(n.carbs * part * 10) / 10;
        const fat = Math.round(n.fat * part * 10) / 10;
        return {
          id: `preview-meal-${date}-${index}`,
          mealType: ["BREAKFAST", "LUNCH", "DINNER"][index],
          servings: 1,
          status: "LOGGED",
          calories,
          protein,
          carbs,
          fat,
          source: "preview",
          createdAt: `${date}T12:00:00Z`,
          nutrition: {
            id: `preview-food-${index}`,
            name: fitnessTerm(names[index]!, locale),
            category: "PROTEIN_SOURCE",
            servingSize: 1,
            servingUnit: fitnessTerm("Portion", locale),
            caloriesPerServing: calories,
            proteinPerServing: protein,
            carbsPerServing: carbs,
            fatPerServing: fat,
          },
        };
      })
    : [];
  return {
    source: "preview",
    logs,
    dailySummary: {
      totalCalories: n?.calories ?? 0,
      totalProtein: n?.protein ?? 0,
      totalCarbs: n?.carbs ?? 0,
      totalFat: n?.fat ?? 0,
    },
    targets: {
      calories: t?.targetCalories ?? 0,
      protein: t?.targetProtein ?? 0,
      carbs: t?.targetCarbs ?? 0,
      fat: t?.targetFat ?? 0,
      water: Math.round((profile?.weight ?? 0) * 35),
    },
    waterConsumed: n?.water ?? 0,
  };
}

function bodyEntry(
  date: string,
  data: PreviewPayload,
  gender?: string,
  locale = "en",
) {
  const focus = new Set(["chest", "upper_back", "quads"]);
  const directions: Record<string, string> = {
    chest: "Balance pressing with controlled chest movements.",
    shoulders: "Include lateral and overhead movements.",
    biceps: "Include controlled curls alongside pulling movements.",
    triceps: "Include extensions alongside pressing movements.",
    forearms: "Build grip strength alongside your main lifts.",
    upper_back: "Include rows for balanced upper-body training.",
    lats: "Include vertical pulling movements.",
    lower_back: "Build controlled hip-hinge technique.",
    core: "Include bracing and anti-rotation movements.",
    glutes: "Include hip extension and squat patterns.",
    quads: "Include squat or leg-press patterns.",
    hamstrings: "Include leg curls and hip-hinge patterns.",
    calves: "Include controlled calf raises.",
  };
  const regions = MUSCLE_IDS.map((region) => ({
    region,
    status: focus.has(region) ? "focus" : "balanced",
    reason: fitnessTerm(directions[region]!, locale),
    basis: "profile_goal",
  }));
  return {
    id: `preview-body-${date}`,
    recordedDate: date,
    updatedAt: `${date}T12:00:00Z`,
    status: "SAVED",
    method: "preview",
    modelVersion: "preview",
    gender,
    metrics: Object.fromEntries(
      Object.entries(data.body).map(([key, value]) => [
        key,
        { value, source: "preview" },
      ]),
    ),
    summary: fitnessTerm(
      "Sample whole-body direction: balance pushing, pulling and lower-body movements.",
      locale,
    ),
    observations: regions
      .filter((row) => focus.has(row.region))
      .map((row) => ({
        region: row.region,
        kind: "suggested_focus",
        observation: row.reason,
        confidence: "low",
        basis: "profile_goal",
      })),
    quality: {
      focusStatus: "ready",
      focusBasis: "preview",
      bodyRegions: regions,
      notes: ["Preview data"],
      physiqueAssessment: {
        version: "physique-v2",
        photosUsed: 0,
        model: "preview",
        overview: fitnessTerm(
          "Preview report with example measurements. No photos were analysed.",
          locale,
        ),
        regions: regions.map((row) => ({
          region: row.region,
          appearanceStatus: "not_provided",
          visualObservation: fitnessTerm("No photos were analysed.", locale),
          visualEvidenceViews: [],
          trainingDirection: row.reason,
          basis: "profile_goal",
          limitations: [],
        })),
      },
    },
    photos: [],
    source: "preview",
  };
}

export async function previewBody(owner: string, date: string, locale = "en") {
  const { days, profile } = await context(owner, date);
  return {
    source: "preview",
    profile,
    records: days
      .filter((row) => Object.keys(row.data.body).length)
      .reverse()
      .map((row) => bodyEntry(row.date, row.data, profile?.gender, locale)),
  };
}

export async function previewHome(owner: string, date: string, locale: string) {
  const [{ day, profile }, training, nutrition] = await Promise.all([
    context(owner, date),
    previewTrainingDay(owner, date, locale),
    previewNutrition(owner, date, locale),
  ]);
  const recovery = day?.data.recovery;
  const macro = (consumed: number, target: number) => ({ consumed, target });
  return {
    source: "preview",
    dataVersion: 6,
    calendarDate: date,
    user: { name: profile?.name ?? "", streakDays: 0 },
    sleepLog: null,
    readiness: recovery
      ? {
          score: recovery.recovery / 10,
          source: "preview",
          date,
          label: fitnessTerm(
            recovery.recovery >= 80
              ? "Optimal Recovery"
              : recovery.recovery >= 60
                ? "Good to Go"
                : "Moderate – Take it easy",
            locale,
          ),
          aiTarget: "",
          hrvMs: recovery.hrv,
          restingHrBpm: recovery.rhr,
          sleepMinutes: Math.round(recovery.sleep * 60),
          steps: 0,
          activeCalories: 0,
        }
      : null,
    todayWorkout: training.items.length
      ? {
          userWorkoutId: training.planId,
          weekLabel: date,
          sessionTitle: training.name,
          workoutTitle: training.name,
          category: "strength",
          exerciseCount: training.items.length,
          durationMinutes: Math.round(
            (training.session?.durationSeconds ?? 0) / 60,
          ),
          status: "COMPLETED",
          aiNote: null,
        }
      : null,
    nutrition: {
      calories: macro(
        nutrition.dailySummary.totalCalories,
        nutrition.targets.calories,
      ),
      protein: macro(
        nutrition.dailySummary.totalProtein,
        nutrition.targets.protein,
      ),
      carbs: macro(nutrition.dailySummary.totalCarbs, nutrition.targets.carbs),
      fat: macro(nutrition.dailySummary.totalFat, nutrition.targets.fat),
      water: macro(nutrition.waterConsumed, nutrition.targets.water),
    },
    weeklyStreak: training.week.map((row) => ({
      day: new Date(`${row.date}T12:00:00Z`).toLocaleDateString("en", {
        weekday: "short",
      }),
      dateNum: Number(row.date.slice(8)),
      status: row.status === "EMPTY" ? "UNAVAILABLE" : row.status,
      isToday: row.date === date,
    })),
  };
}

export async function previewRecovery(
  owner: string,
  date: string,
  count: number,
) {
  const days = await previewDays(owner, date);
  return days
    .filter((row) => row.date >= shiftDate(date, 1 - count))
    .map((row) => ({
      date: row.date,
      recoveryScore: row.data.recovery.recovery,
      sleepHours: row.data.recovery.sleep,
      hrv: row.data.recovery.hrv,
      restingHR: row.data.recovery.rhr,
      source: "preview",
    }));
}
