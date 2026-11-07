import {
  Candidate,
  ExercisePlan,
  Snapshot,
  TrainingDay,
  WeeklyPlan,
} from "./types";
import {
  exerciseEligible,
  isFocusedRegion,
  movementOf,
  rankedCandidates,
} from "./coaching";
import { resolvedSplit } from "./training_style";
import { regionSetBudget } from "./region_input";
export { prescriptionSeconds } from "./prescription_time";

export function orderSession(snapshot: Snapshot, exercises: ExercisePlan[]) {
  const byId = new Map(snapshot.candidates.map((c) => [c.id, c]));
  const priority = (candidate: Candidate) =>
    (candidate.compound ? 100 : 0) +
    (isFocusedRegion(snapshot.profile.focusMuscles, candidate.region)
      ? 40
      : 0) +
    (["knee_dominant", "hip_dominant"].includes(movementOf(candidate))
      ? 20
      : 0);
  return [...exercises].sort(
    (a, b) =>
      priority(byId.get(b.exerciseId)!) - priority(byId.get(a.exerciseId)!),
  );
}

// Product quality constraints. Indirect-set credits are a workload heuristic,
// not a measurement of tissue fatigue or a universally optimal training dose.
export function sessionQualityIssues(
  snapshot: Snapshot,
  plan: WeeklyPlan,
  schedule: TrainingDay[],
) {
  const issues: string[] = [];
  const byId = new Map(snapshot.candidates.map((c) => [c.id, c]));
  for (const day of schedule) {
    const workout = plan.workouts.find((w) => w.date === day.date);
    if (!workout || !workout.exercises.length) {
      issues.push(`${day.date}: provide a complete session.`);
      continue;
    }
    for (const region of day.regions) {
      if (
        !workout.exercises.some(
          (e) => byId.get(e.exerciseId)?.region === region,
        )
      )
        issues.push(`${day.date}: missing assigned ${region} work.`);
    }
    const main = day.regions[0];
    if (
      main &&
      resolvedSplit(snapshot.profile, schedule.length) === "MUSCLE_FOCUSED" &&
      (day.minutesByRegion?.[main] ?? day.minutesPerRegion) >= 12 &&
      (day.exerciseSlots[main] ?? 1) >= 2 &&
      regionSetBudget(
        snapshot,
        main,
        schedule.filter((d) => d.regions.includes(main)).length,
      ) >= 2 &&
      new Set(
        rankedCandidates(snapshot, main).map(
          (c) => `${movementOf(c)}:${c.subTarget ?? ""}`,
        ),
      ).size >= 2 &&
      workout.exercises.filter((e) => byId.get(e.exerciseId)?.region === main)
        .length < 2
    ) {
      issues.push(
        `${day.date}: provide at least two suitable exercises for the main ${main} focus within its working-set and time budgets.`,
      );
    }
    for (const exercise of workout.exercises) {
      const candidate = byId.get(exercise.exerciseId);
      if (!candidate || !exerciseEligible(snapshot, candidate))
        issues.push(
          `${day.date}: ${exercise.exerciseId} does not meet experience eligibility.`,
        );
    }
  }

  for (const region of ["legs", "back"] as const) {
    const days = schedule.filter((d) => d.regions.includes(region));
    const slots = days.reduce(
      (sum, d) => sum + (d.exerciseSlots[region] ?? 1),
      0,
    );
    if (slots < 2 || regionSetBudget(snapshot, region, days.length) < 2)
      continue;
    const available = rankedCandidates(snapshot, region);
    const selected = plan.workouts
      .flatMap((d) => d.exercises)
      .map((e) => byId.get(e.exerciseId))
      .filter((c): c is Candidate => !!c && c.region === region);
    const needed =
      region === "legs"
        ? ["knee_dominant", "hip_dominant"]
        : ["horizontal_pull", "vertical_pull"];
    for (const pattern of needed) {
      if (
        available.some((c) => movementOf(c) === pattern) &&
        !selected.some((c) => movementOf(c) === pattern)
      )
        issues.push(
          `Weekly ${region}: include ${pattern} from the eligible catalogue instead of repeating only one pattern.`,
        );
    }
  }

  for (const { muscle, work, ceiling } of workloadOverages(
    snapshot,
    plan.workouts,
  )) {
    issues.push(
      `Weekly ${muscle}: ${work} direct-plus-indirect set credits exceed the ${ceiling} workload ceiling; reduce redundant work.`,
    );
  }
  return issues;
}

export function workloadOverages(
  snapshot: Snapshot,
  workouts: WeeklyPlan["workouts"],
) {
  const byId = new Map(
    snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const planned = new Map<string, number>();
  for (const exercise of workouts.flatMap((d) => d.exercises)) {
    const candidate = byId.get(exercise.exerciseId);
    if (!candidate) continue;
    for (const muscle of new Set(candidate.primary))
      planned.set(muscle, (planned.get(muscle) ?? 0) + exercise.sets);
    for (const muscle of new Set(
      candidate.secondary.filter((m) => !candidate.primary.includes(m)),
    ))
      planned.set(muscle, (planned.get(muscle) ?? 0) + exercise.sets * 0.5);
  }
  const baseline = new Map<string, number>();
  for (const set of snapshot.sets.filter((s) => !s.synthetic && s.reps > 0)) {
    // Only the last completed seven days contribute to this comparison.
    if (
      Date.parse(snapshot.cutoff) - Date.parse(set.date) > 6 * 86400000 ||
      set.date > snapshot.cutoff
    )
      continue;
    const candidate = byId.get(set.exerciseId);
    const primary = set.primaryMuscles ?? candidate?.primary ?? [];
    const secondary = set.secondaryMuscles ?? candidate?.secondary ?? [];
    for (const muscle of new Set(primary))
      baseline.set(muscle, (baseline.get(muscle) ?? 0) + 1);
    for (const muscle of new Set(secondary.filter((m) => !primary.includes(m))))
      baseline.set(muscle, (baseline.get(muscle) ?? 0) + 0.5);
  }
  const overages: Array<{ muscle: string; work: number; ceiling: number }> = [];
  for (const [muscle, work] of planned) {
    const ceiling = Math.max(
      snapshot.profile.experience === "BEGINNER" ? 12 : 18,
      Math.ceil((baseline.get(muscle) ?? 0) * 1.2),
    );
    if (work > ceiling) overages.push({ muscle, work, ceiling });
  }
  return overages;
}

/** Balance overlapping regional work without dropping movements or inventing loads. */
export function balanceWeeklyWorkload(
  snapshot: Snapshot,
  workouts: WeeklyPlan["workouts"],
) {
  const balanced = structuredClone(workouts);
  const byId = new Map(
    snapshot.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const exercises = balanced.flatMap((day) => day.exercises);
  const removableSets = exercises.reduce(
    (sum, exercise) => sum + Math.max(0, exercise.sets - 2),
    0,
  );
  for (let remaining = removableSets; remaining > 0; remaining--) {
    const overages = workloadOverages(snapshot, balanced);
    if (!overages.length) break;
    let selected: ExercisePlan | undefined;
    let bestScore = 0;
    for (const exercise of exercises) {
      if (exercise.sets <= 2) continue;
      const candidate = byId.get(exercise.exerciseId);
      if (!candidate) continue;
      const relief = overages.reduce((sum, overage) => {
        const contribution = candidate.primary.includes(overage.muscle)
          ? 1
          : candidate.secondary.includes(overage.muscle)
            ? 0.5
            : 0;
        return sum + Math.min(contribution, overage.work - overage.ceiling);
      }, 0);
      // Preserve main compound work when a smaller accessory adjustment suffices.
      const score = relief > 0 ? relief + (candidate.compound ? 0 : 0.1) : 0;
      if (score > bestScore) {
        selected = exercise;
        bestScore = score;
      }
    }
    if (!selected) break;
    selected.setPrescriptions.pop();
    selected.sets = selected.setPrescriptions.length;
    selected.repsMin = selected.repsMax = Math.max(
      ...selected.setPrescriptions.map((set) => set.repsMax),
    );
    const weights = selected.setPrescriptions
      .map((set) => set.weightKg)
      .filter((weight): weight is number => weight != null);
    selected.weightKg = weights.length ? Math.max(...weights) : null;
  }
  // Unresolvable coverage or volume problems still fail the full validator.
  return balanced;
}
