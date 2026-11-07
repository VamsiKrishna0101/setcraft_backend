import standards from "../../../data/strength_standards.json";
import prisma from "../../../config/prisma";
import { isRealBodyEntry } from "../../../utils/real_data";

export const STRENGTH_LEVELS = [
  "Not ranked yet",
  "Beginner",
  "Novice",
  "Intermediate",
  "Advanced",
  "Elite",
] as const;
export type StrengthProfile = { age: number; gender: string; weight: number | null };
export type StrengthSet = {
  id: string;
  itemId: string;
  setNumber: number;
  date: string;
  weight: number | null;
  reps: number;
  weightUnit?: string;
  createdAt?: Date;
  exercise: { id: string; name: string; equipment?: string };
};

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/\((back|side) pov\)/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const round = (value: number) => Math.round(value * 10) / 10;
const daysBefore = (date: string, days: number) =>
  new Date(Date.parse(date) - days * 86400000).toISOString().slice(0, 10);

export function strengthReference(exercise: StrengthSet["exercise"]) {
  return standards.exercises.find(
    (entry) =>
      entry.equipment === normalize(exercise.equipment ?? "") &&
      entry.names.includes(normalize(exercise.name)),
  );
}

// One profile lookup shared by the exercise rank and Body training map.
export async function loadStrengthProfile(userId: string, date: string) {
  const [profile, readings] = await Promise.all([
    prisma.onboarding.findUnique({
      where: { userId },
      select: {
        age: true,
        gender: true,
        weight: true,
        language: true,
        focusMuscles: true,
        limitations: true,
      },
    }),
    prisma.bodyAssessment.findMany({
      where: {
        userId,
        status: "SAVED",
        recordedDate: { gte: daysBefore(date, 30), lte: date },
      },
      orderBy: [{ recordedDate: "desc" }, { createdAt: "desc" }],
      select: { method: true, quality: true, summary: true, metrics: true },
      take: 30,
    }),
  ]);
  if (!profile) return null;
  for (const reading of readings) {
    if (!isRealBodyEntry(reading)) continue;
    const metric = (
      reading.metrics as Record<
        string,
        { value?: number; source?: string }
      > | null
    )?.weightKg;
    if (
      metric &&
      ["scale", "smart_scale"].includes(metric.source ?? "") &&
      typeof metric.value === "number" &&
      Number.isFinite(metric.value) &&
      metric.value >= 20 &&
      metric.value <= 500
    ) {
      return { ...profile, weight: metric.value };
    }
  }
  return profile;
}

function referenceThresholds(rows: number[][], bodyWeight: number) {
  if (bodyWeight < rows[0]![0]! || bodyWeight > rows.at(-1)![0]!) return null;
  const upper = rows.findIndex((row) => row[0]! >= bodyWeight);
  const low = rows[Math.max(0, upper - 1)]!;
  const high = rows[upper]!;
  const fraction =
    high[0] === low[0] ? 0 : (bodyWeight - low[0]!) / (high[0]! - low[0]!);
  return low
    .slice(1)
    .map((value, index) =>
      round(value + fraction * (high[index + 1]! - value)),
    );
}

export function exerciseStrength(
  sets: StrengthSet[],
  exercise: StrengthSet["exercise"],
  profile: StrengthProfile | null,
  date: string,
) {
  const reference = strengthReference(exercise);
  const base = {
    version: standards.version,
    tier: 0,
    title: STRENGTH_LEVELS[0] as string,
    exerciseId: exercise.id,
    exerciseName: exercise.name,
    asOf: date,
    bodyWeightKg: profile?.weight ?? null,
    estimatedMaxKg: null as number | null,
    sourceName: standards.source,
    sourceUrl: reference?.sourceUrl ?? null,
    weightUnit: reference?.weightUnit ?? null,
    eligibleSessions: 0,
    provisional: false,
    referenceId: reference?.id ?? null,
    muscles: reference?.muscles ?? [],
    thresholds: [] as Array<{ tier: number; title: string; weightKg: number }>,
    progress: 0,
    nextLevel: null as { title: string; estimatedMaxKg: number } | null,
    evidence: [] as Array<{
      id: string;
      date: string;
      weight: number;
      reps: number;
    }>,
  };
  if (!reference)
    return {
      ...base,
      reason: "No matching strength reference for this exercise yet.",
    };
  if (
    !profile ||
    profile.age < 18 ||
    !["MALE", "FEMALE"].includes(profile.gender) ||
    profile.weight == null ||
    !Number.isFinite(profile.weight)
  ) {
    return {
      ...base,
      reason:
        "An adult profile with body weight and a supported reference category is needed.",
    };
  }
  const thresholds = referenceThresholds(
    profile.gender === "FEMALE" ? reference.female : reference.male,
    profile.weight,
  );
  if (!thresholds)
    return {
      ...base,
      reason: "Body weight is outside the available reference range.",
    };
  base.thresholds = thresholds.map((weightKg, index) => ({
    tier: index + 1,
    title: STRENGTH_LEVELS[index + 1]!,
    weightKg,
  }));

  // Exact movement and units only. More sets cannot inflate a strength rank.
  const unique = new Map<string, StrengthSet>();
  for (const set of sets) {
    if (
      set.exercise.id !== exercise.id ||
      set.date > date ||
      set.date < daysBefore(date, 90) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(set.date) ||
      !Number.isFinite(Date.parse(set.date)) ||
      new Date(set.date).toISOString().slice(0, 10) !== set.date ||
      !Number.isInteger(set.setNumber) ||
      set.setNumber < 1 ||
      set.weight == null ||
      !Number.isFinite(set.weight) ||
      set.weight <= 0 ||
      !Number.isInteger(set.reps) ||
      set.reps < 1 ||
      set.reps > 20 ||
      set.weightUnit !== reference.weightUnit
    )
      continue;
    const key = [set.itemId, set.date, set.setNumber].join(":");
    const old = unique.get(key);
    if (
      !old ||
      (set.createdAt?.getTime() ?? 0) >= (old.createdAt?.getTime() ?? 0)
    )
      unique.set(key, set);
  }
  const sessions = new Map<string, { estimate: number; set: StrengthSet }>();
  for (const set of unique.values()) {
    // Above 10 reps this is deliberately capped rather than extrapolating a large max.
    const estimate =
      set.reps === 1
        ? set.weight!
        : set.weight! * (1 + Math.min(set.reps, 10) / 30);
    if (estimate > thresholds[4]! * 2) continue;
    if (estimate > (sessions.get(set.date)?.estimate ?? 0))
      sessions.set(set.date, { estimate, set });
  }
  base.eligibleSessions = sessions.size;
  if (!sessions.size)
    return {
      ...base,
      reason:
        sets.some(set => set.exercise.id === exercise.id && set.date <= date &&
          set.date >= daysBefore(date, 90) && set.reps > 0 &&
          set.weight != null && set.weight > 0)
          ? "Confirm whether your logged weight is per dumbbell or the total load including the bar to estimate your level."
          : "Log the actual weight you lifted, along with reps, to estimate your strength level.",
    };
  // The second-best day confirms the level, so one accidental high log cannot award Elite.
  const strongest = [...sessions.values()]
    .sort(
      (a, b) => b.estimate - a.estimate || b.set.date.localeCompare(a.set.date),
    )
    .slice(0, 2);
  const provisional = sessions.size === 1;
  const estimate = (strongest[1] ?? strongest[0])!.estimate;
  let tier = 1;
  for (let index = 1; index < thresholds.length; index++)
    if (estimate >= thresholds[index]!) tier = index + 1;
  const next = thresholds[tier];
  return {
    ...base,
    provisional,
    tier,
    title: STRENGTH_LEVELS[tier]!,
    estimatedMaxKg: round(estimate),
    progress:
      next == null
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (estimate - (tier === 1 ? 0 : thresholds[tier - 1]!)) /
                (next - (tier === 1 ? 0 : thresholds[tier - 1]!)),
            ),
          ),
    nextLevel:
      next == null
        ? null
        : { title: STRENGTH_LEVELS[tier + 1]!, estimatedMaxKg: next },
    evidence: strongest.map(({ set }) => ({
      id: set.id,
      date: set.date,
      weight: set.weight!,
      reps: set.reps,
    })),
    reason:
      provisional
        ? "Provisional estimate from one training day. Log another qualifying session on a different day to confirm your level."
        : "A conservative exercise estimate from two recent sessions, compared with bodyweight references. Not age-adjusted.",
  };
}

export type ExerciseStrength = ReturnType<typeof exerciseStrength>;

export function muscleStrength(ranks: ExerciseStrength[]) {
  const qualified = ranks
    .filter((rank) => rank.tier > 0)
    .sort(
      (a, b) => a.tier - b.tier || a.exerciseId.localeCompare(b.exerciseId),
    );
  // Lower median avoids a single unusually strong movement dominating the whole area.
  const confirmed = qualified.filter(rank => !rank.provisional);
  const contributors = confirmed.length ? confirmed : qualified;
  const provisional = contributors.length > 0 && confirmed.length === 0;
  const tier = contributors.length
    ? contributors[Math.floor((contributors.length - 1) / 2)]!.tier
    : 0;
  return {
    tier,
    provisional,
    title: STRENGTH_LEVELS[tier]!,
    reason: contributors.length
      ? provisional
        ? "Provisional strength level. Another qualifying training day is needed to confirm it."
        : "Based on the lower median of supported exercise levels, not an isolated muscle test."
      : ranks[0]?.reason ?? "No supported exercise has enough recent data to rank this area.",
    exercises: ranks.map(({ evidence, thresholds, ...rank }) => rank),
    qualifiedExercises: qualified.length,
  };
}
