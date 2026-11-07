import {
  exerciseStrength,
  STRENGTH_LEVELS,
  StrengthProfile,
  StrengthSet,
} from "./strength_rank";
import type { LoggedSet } from "./training_data";
import { recordEvents } from "./exercise_engine";

// These are personal training milestones, not population strength standards.
const levels = [
  { id: "STARTING", title: "Getting started", days: 0 },
  { id: "FIRST_STEPS", title: "First steps", days: 1 },
  { id: "MOMENTUM", title: "Building momentum", days: 5 },
  { id: "CONSISTENT", title: "Consistent", days: 12 },
] as const;

export function exerciseRank(
  sets: LoggedSet[],
  exerciseId: string,
  asOf: string,
  profile: StrengthProfile | null = null,
  exercise?: StrengthSet["exercise"],
) {
  // Keep retries, other exercise variants, invalid sets and future logs out.
  const unique = new Map<string, LoggedSet>();
  for (const set of sets) {
    if (set.workoutItem.workout.id !== exerciseId || set.date > asOf) continue;
    if (!Number.isFinite(set.reps) || set.reps <= 0) continue;
    if (set.weight != null && (!Number.isFinite(set.weight) || set.weight < 0))
      continue;
    const key = [set.userWorkoutItemId, set.date, set.setNumber].join(":");
    const previous = unique.get(key);
    if (!previous || set.createdAt >= previous.createdAt) unique.set(key, set);
  }

  const logs = [...unique.values()].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id),
  );
  const dates = [...new Set(logs.map((set) => set.date))];
  // The first training day establishes a baseline; warm-up increases are not a badge.
  const events = recordEvents(logs).filter((event) => event.date > dates[0]!);
  const days = dates.length;
  const level = levels.filter((level) => days >= level.days).at(-1)!;
  const tier = levels.indexOf(level);
  const goal =
    days < 5
      ? 5
      : days < 12
        ? 12
        : days < 25
          ? 25
          : (Math.floor(days / 25) + 1) * 25;

  const movement = exercise ??
    logs[0]?.workoutItem.workout ?? { id: exerciseId, name: "", equipment: "" };
  const strength = exerciseStrength(
    logs.map((set) => ({
      id: set.id,
      itemId: set.userWorkoutItemId,
      setNumber: set.setNumber,
      date: set.date,
      weight: set.weight,
      reps: set.reps,
      createdAt: set.createdAt,
      exercise: set.workoutItem.workout,
      weightUnit: (set.workoutItem.setTargets as { weightUnit?: string } | null)
        ?.weightUnit,
    })),
    movement,
    profile,
    asOf,
  );

  return {
    version: 2,
    kind: "PERSONAL_TRAINING" as const,
    exerciseId,
    asOf,
    level: level.id,
    title: level.title,
    tier,
    trainingDays: days,
    loggedSets: logs.length,
    personalBests: events.length,
    nextMilestone: { trainingDays: goal, progress: Math.min(days / goal, 1) },
    strengthRank: strength,
    strengthRankReason: strength.reason,
    strengthBadges: STRENGTH_LEVELS.slice(1).map((title, index) => ({
      id: "STRENGTH_" + (index + 1),
      title,
      tier: index + 1,
      earned: !strength.provisional && strength.tier >= index + 1,
      description:
        "An estimated exercise level from repeated logged performance and a matching bodyweight reference.",
    })),
    badges: [
      {
        id: "FIRST_LOG",
        title: "First log",
        description: "Log a set of this exercise.",
        tier: 1,
        earned: days > 0,
        earnedAt: dates[0] ?? null,
        current: Math.min(days, 1),
        target: 1,
      },
      {
        id: "FIVE_DAYS",
        title: "Five training days",
        description: "Train this exercise on five different days.",
        tier: 2,
        earned: days >= 5,
        earnedAt: dates[4] ?? null,
        current: Math.min(days, 5),
        target: 5,
      },
      {
        id: "PERSONAL_BEST",
        title: "Personal best",
        description: "Improve a previous load, rep or volume record.",
        tier: 3,
        earned: events.length > 0,
        earnedAt: events[0]?.date ?? null,
        current: Math.min(events.length, 1),
        target: 1,
      },
    ],
  };
}
