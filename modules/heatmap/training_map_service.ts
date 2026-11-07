import { loadStrengthProfile } from "../progress/training/strength_rank";
import { contentLocale } from "../../utils/app_locale";
import { localizeTrainingMap } from "./training_map_locale";
import { realPlanWhere } from "../../utils/real_data";
import prisma from "../../config/prisma";
import { weekDates } from "../workout/session/session_types";
import { trainingMapSchedule } from "./training_map_schedule";
import {
  buildTrainingMap,
  calendarWindow,
  Exercise,
  MuscleId,
  TrainingSet,
  TrainingSelection,
} from "./training_map_engine";

const exerciseSelect = {
  id: true,
  name: true,
  namesByLang: true,
  target: true,
  muscleGroup: true,
  bodyPart: true,
  secondaryMuscles: true,
  equipment: true,
} as const;

export async function getTrainingMap(
  userId: string,
  date: string,
  utcOffsetMinutes: number,
  locale?: string,
  period: "day" | "week" = "week",
  selection?: TrainingSelection,
) {
  const window = calendarWindow(date, utcOffsetMinutes);
  const earliest = selection?.from ?? selection?.dates?.slice().sort()[0];
  const start = earliest
    ? calendarWindow(earliest, utcOffsetMinutes).startUtc
    : window.startUtc;
  const since = new Date(
    Math.min(start.getTime(), window.startUtc.getTime() - 90 * 86_400_000),
  );
  const dates = weekDates(date);
  const [profile, plans, logs, checkIns, restDays] = await Promise.all([
    loadStrengthProfile(userId, date),
    prisma.userWorkout.findMany({
      where: {
        userId,
        AND: [realPlanWhere],
        // Dated workouts keep their targets after completion, including past days.
        OR: [
          { scheduledDate: null, session: null },
          { scheduledDate: { in: dates } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        scheduledDate: true,
        status: true,
        createdAt: true,
        items: {
          where: { sourceProvider: "USER" },
          select: {
            id: true,
            dayOfWeek: true,
            targetSets: true,
            status: true,
            workout: { select: exerciseSelect },
          },
        },
      },
    }),
    prisma.workoutSetLog.findMany({
      where: {
        userId,
        // Recorded calendar dates, including backdated logs, determine filters.
        // createdAt is only a fallback for legacy rows with invalid date fields.
        ...(selection?.all
          ? {}
          : {
              OR: [
                { year: { gte: since.getUTCFullYear().toString() } },
                { createdAt: { gte: since } },
              ],
            }),
        workoutItem: { sourceProvider: "USER", userWorkout: { userId } },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        userWorkoutItemId: true,
        setNumber: true,
        weight: true,
        reps: true,
        day: true,
        month: true,
        year: true,
        createdAt: true,
        workoutItem: {
          select: { setTargets: true, workout: { select: exerciseSelect } },
        },
      },
    }),
    prisma.muscleCheckIn.findMany({
      where: { userId, date },
      select: { muscleId: true, date: true, soreness: true },
    }),
    prisma.workoutDay.findMany({
      where: { userId, date: { in: dates }, restDay: true },
      select: { date: true },
    }),
  ]);
  // The newest active plan is the app's reusable weekly schedule. Completed
  // historical plans are included only when created in the displayed week.
  const plan = plans.find(
    (p) =>
      p.scheduledDate == null &&
      p.status !== "SKIPPED" &&
      p.createdAt < window.endUtc &&
      (p.status !== "COMPLETED" || p.createdAt >= window.startUtc),
  );
  const plannedItems = trainingMapSchedule(
    plans.map((plan) => ({
      ...plan,
      items: plan.items.map((item) => ({
        ...item,
        itemId: item.id,
        exercise: item.workout,
      })),
    })),
    period === "day" ? [date] : dates,
    restDays.map((row) => row.date),
    utcOffsetMinutes,
  );
  const sets: TrainingSet[] = logs.map((log) => {
    const recordedDate = `${log.year.padStart(4, "0")}-${log.month.padStart(2, "0")}-${log.day.padStart(2, "0")}`;
    const parsed = new Date(`${recordedDate}T00:00:00Z`);
    const localDate =
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === recordedDate
        ? recordedDate
        : new Date(log.createdAt.getTime() + utcOffsetMinutes * 60_000)
            .toISOString()
            .slice(0, 10);
    return {
      id: log.id,
      itemId: log.userWorkoutItemId,
      setNumber: log.setNumber,
      date: localDate,
      weight: log.weight,
      reps: log.reps,
      createdAt: log.createdAt,
      weightUnit: (log.workoutItem.setTargets as { weightUnit?: string } | null)
        ?.weightUnit,
      exercise: log.workoutItem.workout as Exercise,
    };
  });
  const language = contentLocale(locale || profile?.language || "en");
  const names = new Map<string, string>();
  for (const exercise of [
    ...plans.flatMap((plan) => plan.items.map((item) => item.workout)),
    ...logs.map((log) => log.workoutItem.workout),
  ]) {
    const translations = exercise.namesByLang as Record<string, string> | null;
    names.set(exercise.name, translations?.[language] || exercise.name);
  }
  const map = buildTrainingMap({
    date,
    utcOffsetMinutes,
    sets,
    period,
    selection,
    strengthProfile: profile,
    planned: plannedItems.map((item) => ({
      itemId: item.itemId,
      dayOfWeek: item.dayOfWeek,
      targetSets: item.targetSets,
      exercise: item.exercise,
    })),
    checkIns,
    focusMuscles: profile?.focusMuscles ?? [],
    limitations: profile?.limitations ?? [],
  });
  return {
    ...localizeTrainingMap(map, language, names),
    gender: profile?.gender ?? "OTHER",
    planId: plan?.id ?? null,
  };
}

export async function saveMuscleCheckIn(
  userId: string,
  muscleId: MuscleId,
  date: string,
  soreness: number,
) {
  return prisma.muscleCheckIn.upsert({
    where: { userId_muscleId_date: { userId, muscleId, date } },
    create: { userId, muscleId, date, soreness },
    update: { soreness },
    select: { muscleId: true, date: true, soreness: true },
  });
}
