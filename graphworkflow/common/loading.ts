import { Candidate, LoggedSet, Profile, Snapshot } from "./types";

export type LoadAction =
  "progress" | "hold" | "deload" | "start" | "bodyweight";

export type LoadPlan = {
  suggestedKg: number | null;
  action: LoadAction;
  note: string;
  startingHintKg: number | null;
};

// Equipment increments are independent of gender. Small loads progress in reps first.
export function equipmentStepKg(candidate: Candidate, _profile: Profile) {
  const equipment = candidate.equipment.toLowerCase();

  if (/dumbbell/.test(equipment)) return 1;
  if (/kettlebell/.test(equipment)) return 2;
  return 2.5;
}

export const roundDown = (value: number, step: number) =>
  Math.max(0, Math.floor((value + 0.000001) / step) * step);

export const roundTo = (value: number, step: number) =>
  Math.max(step, Math.round(value / step) * step);

// Compatibility field for older consumers. Onboarding size and experience do
// not establish lifting capacity: calibrate the first working load in-session.
export function startingHint(
  _candidate: Candidate,
  _profile: Profile,
  _step: number,
): number | null {
  return null;
}

type Args = {
  logs: LoggedSet[];
  candidate: Candidate;
  profile: Profile;
  reducedRecovery: boolean;
};

export function nextLoad({
  logs,
  candidate,
  profile,
  reducedRecovery,
}: Args): LoadPlan {
  const step = equipmentStepKg(candidate, profile);

  if (candidate.bodyweight) {
    return {
      suggestedKg: 0,
      action: "bodyweight",
      note: "Bodyweight exercise: add reps before adding load.",
      startingHintKg: null,
    };
  }

  const dates = [...new Set(logs.map((entry) => entry.date))].sort();

  const lastDate = dates.at(-1);

  const hint = startingHint(candidate, profile, step);

  const sessionSets = (date: string | undefined) =>
    logs.filter((entry) => entry.date === date && (entry.weight ?? 0) > 0);

  const latest = sessionSets(lastDate);

  if (!latest.length) {
    return {
      suggestedKg: null,
      action: "start",
      note: "First session: choose a manageable load, practise the movement and record reps and effort. Your body size does not establish a starting weight.",
      startingHintKg: null,
    };
  }

  const previous = sessionSets(dates.at(-2));
  const units = new Set(
    [...latest, ...previous].map((set) => set.weightUnit ?? "as_logged"),
  );
  if (units.size > 1) {
    return {
      suggestedKg: null,
      action: "start",
      note: "Logged load units differ. Confirm the load convention and establish a comparable working load before progressing.",
      startingHintKg: null,
    };
  }

  const missed = (sets: LoggedSet[]) => {
    const top = Math.max(...sets.map((entry) => entry.weight ?? 0));

    return sets
      .filter((entry) => entry.weight === top)
      .some((entry) => entry.reps < (entry.plannedRepsMin ?? 8));
  };

  const top = Math.max(...latest.map((entry) => entry.weight ?? 0));

  const hardest = Math.max(...latest.map((entry) => entry.rpe ?? 0));
  const effortUnknown = latest.some((entry) => entry.rpe == null);

  const missedTwice =
    previous.length > 0 &&
    missed(latest) &&
    missed(previous) &&
    Math.max(...previous.map((entry) => entry.weight ?? 0)) === top;

  if (missedTwice) {
    return {
      suggestedKg: roundDown(top * 0.9, step) || top,
      action: "deload",
      note: `Missed target reps at ${top} kg two sessions in a row: reduce about 10% and rebuild.`,
      startingHintKg: hint,
    };
  }

  if (reducedRecovery || hardest >= 9 || missed(latest) || effortUnknown) {
    return {
      suggestedKg: top,
      action: "hold",
      note: reducedRecovery
        ? `Recovery is low: keep ${top} kg this week.`
        : effortUnknown
          ? `Effort was not logged: repeat ${top} kg and record effort before increasing.`
          : `Last session was hard or reps were missed: repeat ${top} kg and beat the reps.`,
      startingHintKg: hint,
    };
  }

  const completedComfortably = (sets: LoggedSet[]) =>
    sets.length >=
      Math.max(1, ...sets.map((entry) => entry.plannedSets ?? 3)) &&
    new Set(sets.map((entry) => entry.set)).size === sets.length &&
    new Set(sets.map((entry) => entry.weightUnit ?? "as_logged")).size === 1 &&
    sets.every(
      (entry) =>
        entry.plannedRepsMax != null &&
        entry.reps >= entry.plannedRepsMax &&
        entry.reps >=
          (candidate.compound
            ? coachingProfile(profile).repRange[1]!
            : candidate.region === "core"
              ? 20
              : 15) &&
        entry.rpe != null &&
        entry.rpe <= coachingProfile(profile).maxTargetRpe,
    );

  // One increment, capped at 10%, after two demonstrated manageable completions.
  const maxIncrease = top * 0.1;
  const ready =
    completedComfortably(latest) &&
    completedComfortably(previous) &&
    Math.max(...previous.map((entry) => entry.weight ?? 0)) === top;

  if (!ready || step > maxIncrease) {
    return {
      suggestedKg: top,
      action: "hold",
      note:
        step > maxIncrease
          ? "Keep the logged load: the default equipment increment is too large. Confirm a smaller available increment before increasing weight."
          : "Keep the logged load. Build towards the top of the prescribed rep bracket and record effort before increasing weight.",
      startingHintKg: hint,
    };
  }

  return {
    suggestedKg: Math.round((top + step) * 100) / 100,
    action: "progress",
    note: `Two complete, manageable sessions at ${top} kg: try one ${step} kg equipment increment.`,
    startingHintKg: hint,
  };
}

// Experience/goal rules; gender alone does not establish ability.
export function coachingProfile(profile: Profile) {
  const beginner = profile.experience === "BEGINNER";

  return {
    gender: profile.gender,
    approach:
      "Use demonstrated performance, experience, equipment and recovery. Gender alone does not determine loads, muscle priorities or progression.",
    repRange: /strength|stronger/i.test(profile.goal)
      ? beginner
        ? [8, 12]
        : [5, 8]
      : [8, 12],
    maxTargetRpe: beginner ? 7 : 8,
  };
}

// One set of limits shared by the prompts and final validation.
export function exerciseRules(
  snapshot: Snapshot,
  candidate: Candidate,
  reducedRecovery: boolean,
) {
  const beginner = snapshot.profile.experience === "BEGINNER";
  const logs = snapshot.sets.filter(
    (set) => set.exerciseId === candidate.id && set.reps > 0,
  );
  const dates = [...new Set(logs.map((set) => set.date))].sort().slice(-2);
  const accustomedToFour =
    dates.length === 2 &&
    dates.every((date) => {
      const sets = logs.filter((set) => set.date === date);
      return (
        sets.length >= 4 &&
        sets.every(
          (set) =>
            set.rpe != null &&
            set.rpe <= 7 &&
            set.reps >= (set.plannedRepsMin ?? 8),
        )
      );
    });
  let maxSets = reducedRecovery
    ? beginner
      ? 2
      : 3
    : beginner && !accustomedToFour
      ? 3
      : 4;
  const action = nextLoad({
    logs,
    candidate,
    profile: snapshot.profile,
    reducedRecovery,
  }).action;
  if (action === "progress") {
    const lastSets = logs.filter((set) => set.date === dates.at(-1));
    maxSets = Math.min(maxSets, Math.max(1, lastSets.length));
  }
  const reps =
    candidate.bodyweight && candidate.compound
      ? [6, 20]
      : candidate.compound
        ? coachingProfile(snapshot.profile).repRange
        : candidate.region === "core"
          ? [12, 20]
          : [10, 15];
  const strength =
    candidate.compound && /strength|stronger/i.test(snapshot.profile.goal) && !beginner;

  const lastSets = logs.filter((s) => s.date === dates.at(-1));
  const manageable = (date: string) => {
    const completed = logs.filter((s) => s.date === date);
    return (
      completed.length >=
        Math.max(2, ...completed.map((s) => s.plannedSets ?? 2)) &&
      new Set(completed.map((s) => s.set)).size === completed.length &&
      completed.every(
        (s) =>
          s.rpe != null &&
          s.rpe <= 7 &&
          s.plannedRepsMin != null &&
          s.reps >= s.plannedRepsMin,
      )
    );
  };
  const adapted = dates.length === 2 && dates.every(manageable);
  const previousTarget = Math.max(
    reps[0]!,
    ...lastSets.map((s) => s.plannedRepsMax ?? reps[0]!),
  );
  const canAddRep =
    !reducedRecovery &&
    lastSets.length > 0 &&
    lastSets.length >=
      Math.max(1, ...lastSets.map((s) => s.plannedSets ?? 3)) &&
    lastSets.every(
      (s) =>
        s.rpe != null &&
        s.rpe <= coachingProfile(snapshot.profile).maxTargetRpe &&
        s.plannedRepsMax != null &&
        s.reps >= s.plannedRepsMax,
    );
  const recommendedReps =
    action === "progress"
      ? reps[0]!
      : Math.min(
          reps[1]!,
          Math.max(reps[0]!, previousTarget + (canAddRep ? 1 : 0)),
        );

  return {
    recommendedSets: Math.min(
      maxSets,
      reducedRecovery
        ? 2
        : adapted
          ? 3
          : lastSets.length
            ? Math.max(2, lastSets.length)
            : beginner || reducedRecovery ? 2 : 3,
    ),
    recommendedReps,
    maxSets,
    minReps: reps[0]!,
    maxReps: reps[1]!,
    maxTargetRpe:
      coachingProfile(snapshot.profile).maxTargetRpe -
      (reducedRecovery ? 1 : 0),
    minRestSeconds: candidate.compound ? (strength ? 120 : 90) : 60,
    maxRestSeconds: candidate.compound ? 180 : 120,
    rationale: reducedRecovery
      ? "Reduce work while recent recovery is low."
      : accustomedToFour
        ? "Two recent manageable four-set sessions support up to four working sets."
        : logs.length
          ? "Build from the recorded working sets; do not increase load and volume together."
          : beginner ? "New beginner movement: start with two working sets and build towards three from recorded performance."
            : "New movement for an experienced lifter: use three manageable working sets and calibrate the load.",
  };
}
