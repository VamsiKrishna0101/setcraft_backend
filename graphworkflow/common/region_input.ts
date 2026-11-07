import { contentLocale } from "../../utils/app_locale";
import {
  Candidate,
  LoggedSet,
  Region,
  Snapshot,
  TrainingDay,
  addDays,
} from "./types";
import { subTargetOf } from "./catalog";
import {
  rankedCandidates,
  programmeFor,
  REGION_MUSCLES,
  movementOf,
  isFocusedRegion,
} from "./coaching";
import { prescriptionSeconds } from "./prescription_time";
export { REGION_MUSCLES, isFocusedRegion } from "./coaching";
import { measurementContext } from "./measurements";
import {
  coachingProfile,
  roundDown,
  equipmentStepKg,
  exerciseRules,
  nextLoad,
} from "./loading";

// Exported so tests can verify region history behaviour.
export function regionHistory(
  snapshot: Snapshot,
  schedule: TrainingDay[],
  region: Region,
): ReturnType<typeof exerciseHistory> {
  return exerciseHistory(snapshot, region);
}

// Body scan measurements that matter for each region (weight/body fat go to every region).
const REGION_MEASUREMENTS: Record<Region, string[]> = {
  chest: ["chestCm"],
  back: ["chestCm", "waistCm"],
  legs: ["hipsCm", "leftThighCm", "rightThighCm", "leftCalfCm", "rightCalfCm"],
  shoulders: ["chestCm", "neckCm"],
  biceps: ["leftArmCm", "rightArmCm"],
  triceps: ["leftArmCm", "rightArmCm"],
  core: ["waistCm", "hipsCm"],
};

const round1 = (value: number) => Math.round(value * 10) / 10;

// Epley estimate, only used to tell the trend of an exercise.
const estimatedMax = (set: LoggedSet) =>
  (set.weight ?? 0) * (1 + set.reps / 30);

export function regionRecovery(snapshot: Snapshot, region: Region) {
  const muscles = REGION_MUSCLES[region];
  const cutoff = snapshot.recoveryCutoff ?? snapshot.cutoff;
  const recent = addDays(cutoff, -2);

  const poorWellness = snapshot.wellness.some(
    (entry) =>
      entry.date >= recent &&
      entry.date <= cutoff &&
      ((entry.energy != null && entry.energy <= 2) ||
        (entry.sleepMinutes != null && entry.sleepMinutes < 360) ||
        (entry.soreness ?? 0) >= 4),
  );

  const poorSleep = snapshot.health.some(
    (entry) =>
      entry.date >= recent &&
      entry.date <= cutoff &&
      entry.sleepMinutes != null &&
      entry.sleepMinutes < 360,
  );

  const soreMuscles = (snapshot.muscleCheckIns ?? []).filter(
    (entry) =>
      entry.date >= recent &&
      entry.date <= cutoff &&
      entry.soreness >= 2 &&
      muscles.includes(entry.muscleId),
  );

  // One reading per recent day; synced sleep takes precedence over a manual check-in.
  const sleepByDate = new Map<string, number>();
  for (const entry of [...snapshot.wellness, ...snapshot.health]) {
    if (
      entry.date >= recent &&
      entry.date <= cutoff &&
      entry.sleepMinutes != null
    ) {
      sleepByDate.set(entry.date, entry.sleepMinutes);
    }
  }
  const sleep = [...sleepByDate.values()];

  return {
    reducedRecovery: poorWellness || poorSleep || soreMuscles.length > 0,
    avgSleepMinutes: sleep.length
      ? Math.round(sleep.reduce((sum, value) => sum + value, 0) / sleep.length)
      : null,
    latestEnergy:
      snapshot.wellness
        .filter(
          (entry) => entry.date >= recent && entry.date <= cutoff,
        )
        .at(-1)?.energy ?? null,
    soreMuscles: soreMuscles.map(({ muscleId, date, soreness }) => ({
      muscleId,
      date,
      soreness,
    })),
  };
}

// Backend weight guide for one exercise. The model chooses; validation clamps to maxSafeKg.
export function loadGuide(
  snapshot: Snapshot,
  candidate: Candidate,
  reducedRecovery: boolean,
) {
  const logs = snapshot.sets.filter(
    (entry) => entry.exerciseId === candidate.id && entry.reps > 0,
  );

  const load = nextLoad({
    logs,
    candidate,
    profile: snapshot.profile,
    reducedRecovery,
  });

  const step = equipmentStepKg(candidate, snapshot.profile);

  const topKg = Math.max(0, ...logs.map((entry) => entry.weight ?? 0));

  // Never allow the model to override a hold/deload with an older personal best.
  const maxSafeKg = load.suggestedKg;

  const lastDate = logs
    .map((entry) => entry.date)
    .sort()
    .at(-1);
  const lastSets = logs
    .filter((entry) => entry.date === lastDate)
    .sort((first, second) => first.set - second.set);
  const weightUnit = candidate.bodyweight
    ? ("bodyweight" as const)
    : ((load.action !== "start"
        ? logs.find((entry) => entry.date === lastDate)?.weightUnit
        : undefined) ??
      (topKg > 0 && load.action !== "start"
        ? ("as_logged" as const)
        : /dumbbell|kettlebell/i.test(candidate.equipment) &&
            !/goblet/i.test(candidate.name)
          ? ("per_hand" as const)
          : ("total_load" as const)));

  return {
    suggestedKg: load.suggestedKg,
    action: load.action,
    note: load.note,
    step,
    hasHistory: topKg > 0 && load.action !== "start",
    lastSets: lastSets.map(({ set, reps, weight, rpe }) => ({
      setNumber: set,
      reps,
      weightKg: weight,
      rpe,
    })),
    setCeilingsKg:
      load.action === "start"
        ? []
        : lastSets.map((set) => {
            if (candidate.bodyweight) return 0;
            if (set.weight == null || set.weight <= 0) return maxSafeKg;
            const target =
              load.action === "progress"
                ? set.weight + step
                : load.action === "deload"
                  ? roundDown(set.weight * 0.9, step) || set.weight
                  : set.weight;
            return maxSafeKg == null ? target : Math.min(target, maxSafeKg);
          }),
    maxSafeKg,
    weightUnit,
    lastSetIds: logs
      .filter((entry) => entry.date === lastDate)
      .map((entry) => entry.id),
  };
}

export type LoadGuide = ReturnType<typeof loadGuide>;

// Every exercise logged for this region in the last 3 weeks, grouped per exercise.
function exerciseHistory(snapshot: Snapshot, region: Region) {
  const muscles = REGION_MUSCLES[region];
  const byId = new Map(snapshot.candidates.map((entry) => [entry.id, entry]));

  const groups = new Map<string, LoggedSet[]>();

  for (const set of snapshot.sets) {
    const primary =
      set.primaryMuscles ?? byId.get(set.exerciseId)?.primary ?? [];

    if (set.reps > 0 && primary.some((muscle) => muscles.includes(muscle))) {
      groups.set(set.exerciseId, [...(groups.get(set.exerciseId) ?? []), set]);
    }
  }

  return [...groups.entries()].map(([exerciseId, sets]) => {
    const candidate = byId.get(exerciseId);
    const name = candidate?.name ?? sets[0]!.exerciseName ?? "Unknown exercise";
    const dates = [...new Set(sets.map((set) => set.date))].sort();

    const sessions = dates.map((date) => {
      const daySets = sets
        .filter((set) => set.date === date)
        .sort((first, second) => first.set - second.set);

      return {
        date,
        sets: daySets.map(
          (set) =>
            `${set.reps}x${set.weight == null ? "unknown load" : set.weight === 0 ? "bw" : `${set.weight}kg`}${set.rpe != null ? `@${set.rpe}` : ""}`,
        ),
        best: Math.max(...daySets.map(estimatedMax)),
      };
    });

    const best = [...sets].sort(
      (first, second) =>
        (second.weight ?? 0) - (first.weight ?? 0) || second.reps - first.reps,
    )[0]!;

    const first = sessions[0]!.best;
    const last = sessions.at(-1)!.best;

    return {
      exerciseId,
      name,
      subTarget:
        candidate?.subTarget ?? subTargetOf(region, name, set0Primary(sets)),
      availableNow: Boolean(candidate),
      sessions: sessions.map(({ date, sets }) => ({ date, sets })),
      maxWeightKg: best.weight ?? 0,
      bestSet: `${best.reps}x${best.weight == null ? "unknown load" : best.weight === 0 ? "bw" : `${best.weight}kg`}`,
      totalSets: sets.length,
      trend:
        sessions.length < 2 || first === 0
          ? "new"
          : last > first * 1.02
            ? "up"
            : last < first * 0.98
              ? "down"
              : "flat",
    };
  });
}

const set0Primary = (sets: LoggedSet[]) => sets[0]?.primaryMuscles ?? [];

function weeklyVolume(snapshot: Snapshot, region: Region) {
  const muscles = REGION_MUSCLES[region];
  const byId = new Map(snapshot.candidates.map((entry) => [entry.id, entry]));

  return [0, 1, 2].map((week) => {
    const start = addDays(snapshot.historyStart, week * 7);
    const end = addDays(start, 6);
    const sets = snapshot.sets.filter(
      (set) => set.date >= start && set.date <= end,
    );

    const hits = (list: string[] | undefined) =>
      (list ?? []).some((muscle) => muscles.includes(muscle));

    const direct = sets.filter((set) =>
      hits(set.primaryMuscles ?? byId.get(set.exerciseId)?.primary),
    ).length;

    const indirect = sets.filter(
      (set) =>
        !hits(set.primaryMuscles ?? byId.get(set.exerciseId)?.primary) &&
        hits(set.secondaryMuscles ?? byId.get(set.exerciseId)?.secondary),
    ).length;

    return { start, end, directSets: direct, indirectSets: indirect };
  });
}

// Preserve measurement sources. Estimated size changes are not measured progress.
function bodyScan(snapshot: Snapshot, region: Region) {
  return measurementContext(snapshot, [
    "weightKg",
    "bodyFatPct",
    ...REGION_MEASUREMENTS[region],
  ]);
}

// A conservative direct-set ceiling. Missing weeks do not count as zero-volume weeks.
export function regionSetBudget(
  snapshot: Snapshot,
  region: Region,
  scheduledDays: number,
) {
  const volumes = weeklyVolume(snapshot, region).filter(
    (week) => week.directSets > 0,
  );
  const recent = volumes.at(-1)?.directSets;
  const initial =
    region === "legs"
      ? snapshot.profile.experience === "BEGINNER"
        ? 12
        : 16
      : snapshot.profile.experience === "BEGINNER"
        ? 9
        : 12;
  const budget = recent == null ? initial : Math.ceil(recent * 1.2);
  return Math.max(
    scheduledDays * (regionRecovery(snapshot, region).reducedRecovery ? 1 : 2),
    Math.min(
      20,
      regionRecovery(snapshot, region).reducedRecovery
        ? Math.max(scheduledDays, Math.floor((recent ?? initial) * 0.75))
        : budget,
    ),
  );
}

// Region-specific history, optional entered measurements and eligible exercises.
export function buildRegionInput(
  snapshot: Snapshot,
  schedule: TrainingDay[],
  region: Region,
) {
  const profile = snapshot.profile;
  const recovery = regionRecovery(snapshot, region);
  const currentWeight = profile.weight;

  const exercises = rankedCandidates(snapshot, region).map((candidate) => {
    const guide = loadGuide(snapshot, candidate, recovery.reducedRecovery);
    const rules = exerciseRules(snapshot, candidate, recovery.reducedRecovery);

    return {
      id: candidate.id,
      name: candidate.name,
      equipment: candidate.equipment,
      subTarget: candidate.subTarget,
      compound: candidate.compound,
      primaryMuscles: candidate.primary,
      secondaryMuscles: candidate.secondary,
      bodyweight: candidate.bodyweight,
      difficulty: candidate.difficulty ?? null,
      movementType: candidate.movementType,
      technicalReason: candidate.technicalReason,
      movementDemands: candidate.movementDemands,
      movement: movementOf(candidate),
      prescriptionRules: rules,
      estimatedSecondsAtRecommendedDose: prescriptionSeconds(
        rules.recommendedSets,
        rules.recommendedReps,
        rules.minRestSeconds,
      ),
      suggestedKg: guide.suggestedKg,
      maxSafeKg: guide.maxSafeKg,
      weightStepKg: guide.step,
      weightUnit: guide.weightUnit,
      loadNote: guide.note,
      lastWorkingSets: guide.lastSets,
      setCeilingsKg: guide.setCeilingsKg,
    };
  });

  return {
    region,
    language: contentLocale(profile.language),
    client: {
      gender: profile.gender,
      age: profile.age,
      heightCm: profile.height,
      currentWeightKg: currentWeight,
      targetWeightKg: profile.targetWeight,
      weightToChangeKg:
        profile.targetWeight != null && currentWeight != null
          ? round1(profile.targetWeight - currentWeight)
          : null,
      goal: profile.goal,
      experience: profile.experience,
      activityLevel: profile.activityLevel,
      limitations: profile.limitations,
      customLimitations: profile.customLimitations,
      trainingSplit: profile.trainingSplit ?? "AUTO",
      trainingDays: profile.trainingDays,
      sessionMinutes: profile.minutes,
      focusMuscles: profile.focusMuscles,
      isFocusRegion: isFocusedRegion(profile.focusMuscles, region),
      declaredSleepHabit: profile.sleepDuration ?? null,
      preferredTime: profile.preferredTime ?? null,
      coaching: coachingProfile(profile),
    },
    weeklySetBudget: regionSetBudget(
      snapshot,
      region,
      schedule.filter((day) => day.regions.includes(region)).length,
    ),
    body: bodyScan(snapshot, region),
    programme: programmeFor(snapshot),
    previousProgramme: snapshot.programmeMemory ?? null,
    history: {
      window: { start: snapshot.historyStart, end: snapshot.cutoff },
      weeklyVolume: weeklyVolume(snapshot, region),
      sessions: snapshot.sessions,
      coverage: snapshot.coverage,
      exercises: exerciseHistory(snapshot, region),
    },
    equipment: {
      location: profile.location,
      items: profile.equipmentIds.length
        ? profile.equipmentIds
        : profile.equipment,
    },
    exercises,
    days: schedule
      .filter((day) => day.regions.includes(region))
      .map((day) => ({
        date: day.date,
        minutes:
          Math.floor(
            (day.minutesByRegion?.[region] ?? day.minutesPerRegion) * 10,
          ) / 10,
        maxExercises: day.exerciseSlots[region] ?? 1,
        sharedWith: day.regions.filter((other) => other !== region),
      })),
    weekSchedule: schedule.map((day) => ({
      date: day.date,
      regions: day.regions,
    })),
    recovery,
  };
}
