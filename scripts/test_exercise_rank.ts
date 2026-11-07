import {
  exerciseStrength,
  muscleStrength,
  StrengthSet,
} from "../modules/progress/training/strength_rank";
import { buildTrainingMap } from "../modules/heatmap/training_map_engine";
import standards from "../data/strength_standards.json";
import assert from "node:assert/strict";
import type { LoggedSet } from "../modules/progress/training/training_data";
import { exerciseRank } from "../modules/progress/training/exercise_rank";

const exerciseId = "exercise-a";
const today = "2026-10-15";

function log(
  day: number,
  weight: number | null = 20,
  reps = 10,
  number = 1,
): LoggedSet {
  const date = "2026-10-" + String(day).padStart(2, "0");
  return {
    id: date + "-set-" + number,
    userWorkoutItemId: "item-" + day,
    setNumber: number,
    weight,
    reps,
    rpe: null,
    day: String(day),
    month: "10",
    year: "2026",
    date,
    createdAt: new Date(date + "T10:00:00Z"),
    workoutItem: {
      setTargets: { weightUnit: "per_hand" },
      workout: {
        id: exerciseId,
        name: "Dumbbell press",
        namesByLang: null,
        bodyPart: "Chest",
        target: "Pectorals",
        muscleGroup: "Chest",
        secondaryMuscles: ["Triceps"],
        equipment: "Dumbbell",
        category: "strength",
        thumbnailUrl: null,
      },
    },
  };
}

const empty = exerciseRank([], exerciseId, today);
assert.equal(empty.tier, 0);
assert.equal(empty.trainingDays, 0);
assert(empty.badges.every((badge) => !badge.earned && badge.earnedAt === null));
assert.equal(empty.strengthRank.tier, 0);

const firstDay = exerciseRank(
  [log(1, 10), log(1, 20, 10, 2)],
  exerciseId,
  today,
);
assert.equal(firstDay.tier, 1);
assert.equal(firstDay.trainingDays, 1);
assert.equal(firstDay.loggedSets, 2);
assert.equal(firstDay.badges[0]!.earned, true);
assert.equal(
  firstDay.badges[2]!.earned,
  false,
  "The first day establishes the baseline.",
);

const history = [log(1), log(2), log(3), log(4), log(5, 20, 11)];
const rank = exerciseRank(history, exerciseId, today);
assert.equal(rank.level, "MOMENTUM");
assert.equal(rank.trainingDays, 5);
assert.equal(rank.badges[1]!.earnedAt, "2026-10-05");
assert.equal(rank.badges[2]!.earned, true);
assert.equal(rank.badges[2]!.earnedAt, "2026-10-05");
assert.equal(rank.nextMilestone.trainingDays, 12);
assert.equal(rank.nextMilestone.progress, 5 / 12);
assert.deepEqual(
  exerciseRank([...history].reverse(), exerciseId, today),
  rank,
  "Input order cannot change ranks.",
);

const duplicate = {
  ...log(5, 999),
  createdAt: new Date("2026-10-05T09:00:00Z"),
};
const otherExercise = log(6, 999);
otherExercise.workoutItem = {
  setTargets: null,
  workout: { ...otherExercise.workoutItem.workout, id: "another-variant" },
};
const polluted = [
  ...history,
  duplicate,
  history[0]!,
  otherExercise,
  log(20, 999),
  log(6, -1),
  log(6, 20, 0),
];
assert.deepEqual(
  exerciseRank(polluted, exerciseId, today),
  rank,
  "Retries, future logs, invalid sets and other variants do not count.",
);

const constant = Array.from({ length: 12 }, (_, index) => log(index + 1));
assert.equal(exerciseRank(constant, exerciseId, today).level, "CONSISTENT");
assert.equal(
  exerciseRank(constant, exerciseId, today).badges[2]!.earned,
  false,
  "Consistency does not invent a strength record.",
);
assert.equal(
  exerciseRank(
    constant.map((set) => ({ ...set, weight: 200 })),
    exerciseId,
    today,
  ).tier,
  3,
  "A rank never requires heavier weights.",
);
const bodyweight = exerciseRank(
  [log(1, null, 8), log(2, null, 10)],
  exerciseId,
  today,
);
assert.equal(
  bodyweight.badges[2]!.earned,
  true,
  "Bodyweight rep improvements count without a fake load.",
);
assert.equal(bodyweight.strengthRank.tier, 0);
assert.equal(
  exerciseRank(history, "another-user-exercise", today).trainingDays,
  0,
);

console.log(
  "Exercise rank checks passed: baseline, milestones, records, bodyweight, duplicate retries, ordering, exercise isolation and future/invalid logs.",
);

const profile = { age: 30, gender: "MALE", weight: 80 };
const bench = {
  id: "bench",
  name: "Barbell Bench Press",
  equipment: "barbell",
  bodyPart: "chest",
  target: "pectorals",
  muscleGroup: "chest",
  secondaryMuscles: ["triceps"],
};
function strengthLog(date: string, weight = 60, reps = 8): StrengthSet {
  return {
    id: date + "-bench",
    itemId: date + "-item",
    setNumber: 1,
    date,
    weight,
    reps,
    weightUnit: "total_load",
    exercise: bench,
    createdAt: new Date(date + "T10:00:00Z"),
  };
}
const strengthSets = [strengthLog("2026-10-01"), strengthLog("2026-10-05")];
const novice = exerciseStrength(strengthSets, bench, profile, today);
assert.equal(novice.tier, 2);
assert.equal(novice.title, "Novice");
assert.equal(novice.estimatedMaxKg, 76);
assert.equal(novice.evidence.length, 2);
assert.equal(
  exerciseStrength(strengthSets, bench, { ...profile, gender: "FEMALE" }, today)
    .tier,
  3,
);
assert.equal(
  exerciseStrength(strengthSets, bench, { ...profile, weight: 60 }, today).tier,
  3,
);
assert.equal(
  exerciseStrength(strengthSets, bench, { ...profile, gender: "OTHER" }, today)
    .tier,
  0,
);
assert.equal(
  exerciseStrength(strengthSets, bench, { ...profile, age: 17 }, today).tier,
  0,
);
assert.equal(
  exerciseStrength(strengthSets, bench, { ...profile, weight: 150 }, today)
    .tier,
  0,
);
assert.equal(
  exerciseStrength(strengthSets.slice(0, 1), bench, profile, today).tier,
  2,
);
const provisional = exerciseStrength(strengthSets.slice(0, 1), bench, profile, today);
assert.equal(provisional.provisional, true);
assert.equal(provisional.eligibleSessions, 1);
assert.equal(novice.provisional, false);
assert.equal(muscleStrength([provisional]).provisional, true);
assert.equal(muscleStrength([provisional, novice]).provisional, false,
  'Provisional lifts must not replace confirmed muscle evidence.');
assert.equal(
  exerciseStrength(
    strengthSets.map((set) => ({ ...set, weightUnit: "as_logged" })),
    bench,
    profile,
    today,
  ).tier,
  0,
);
assert.equal(
  exerciseStrength(
    strengthSets.map((set) => ({ ...set, weight: null })),
    bench,
    profile,
    today,
  ).tier,
  0,
);
assert.equal(
  exerciseStrength(
    strengthSets,
    { ...bench, name: "Barbell Incline Bench Press" },
    profile,
    today,
  ).tier,
  0,
);
assert.equal(
  exerciseStrength(
    strengthSets,
    { ...bench, equipment: "smith machine" },
    profile,
    today,
  ).tier,
  0,
);
assert.equal(
  exerciseStrength(
    [strengthSets[0]!, strengthLog("2026-10-20", 200)],
    bench,
    profile,
    today,
  ).tier,
  provisional.tier,
  'A future session cannot confirm or change the first valid estimate.',
);
assert.equal(
  exerciseStrength(strengthSets, bench, profile, "2027-02-01").tier,
  0,
);
const capped = [
  strengthLog("2026-10-01", 60, 20),
  strengthLog("2026-10-05", 60, 20),
];
assert.equal(
  exerciseStrength(capped, bench, profile, today).estimatedMaxKg,
  80,
);
assert.equal(
  exerciseStrength(
    capped.map((set) => ({ ...set, reps: 10 })),
    bench,
    profile,
    today,
  ).estimatedMaxKg,
  80,
);
const accidental = [...strengthSets, strengthLog("2026-10-06", 200)];
assert.equal(
  exerciseStrength(accidental, bench, profile, today).tier,
  2,
  "One accidental heavy day cannot award Elite.",
);
assert.equal(
  exerciseStrength(
    [strengthLog("2026-10-01", 200, 1), strengthLog("2026-10-05", 200, 1)],
    bench,
    profile,
    today,
  ).tier,
  5,
);
const repeatedSets = strengthSets.flatMap((set) =>
  Array.from({ length: 20 }, (_, index) => ({
    ...set,
    id: set.id + index,
    setNumber: index + 1,
  })),
);
assert.equal(
  exerciseStrength(repeatedSets, bench, profile, today).tier,
  novice.tier,
  "Set volume cannot inflate a strength rank.",
);
const retried = {
  ...strengthSets[0]!,
  id: "old-retry",
  weight: 200,
  createdAt: new Date("2026-10-01T09:00:00Z"),
};
assert.deepEqual(
  exerciseStrength([retried, ...strengthSets], bench, profile, today),
  novice,
);
const map = buildTrainingMap({
  date: today,
  utcOffsetMinutes: 0,
  sets: strengthSets.map((set) => ({ ...set, exercise: bench })),
  planned: [],
  checkIns: [],
  focusMuscles: [],
  limitations: [],
  strengthProfile: profile,
});
const chest = map.regions.find((region) => region.id === "chest")!;
assert.equal(
  chest.completedSets,
  0,
  "Weekly sets remain a separate activity measure.",
);
assert.equal(
  chest.strength.tier,
  0,
  "A period without direct sets must not inherit historical map colours.",
);
const activeMap = buildTrainingMap({
  date: strengthSets.at(-1)!.date, utcOffsetMinutes: 0,
  sets: strengthSets.map(set => ({ ...set, exercise: bench })),
  planned: [], checkIns: [], focusMuscles: [], limitations: [], strengthProfile: profile,
});
assert.equal(activeMap.regions.find(region => region.id === "chest")!.strength.tier,
  exerciseStrength(strengthSets, bench, profile, strengthSets.at(-1)!.date).tier,
  "An active area's colour retains the shared conservative strength estimate.");
assert.equal(
  map.regions.find((region) => region.id === "triceps")!.strength.tier,
  0,
  "Secondary exposure cannot invent an isolated triceps rank.",
);
assert.equal(muscleStrength([novice, { ...novice, tier: 5 }]).tier, 2);
for (const reference of standards.exercises) {
  for (const rows of [reference.male, reference.female]) {
    assert(
      rows.every(
        (row, index) =>
          row.length === 6 &&
          row.every(Number.isFinite) &&
          row
            .slice(1)
            .every((value, tier) => tier === 0 || value > row[tier]!) &&
          (index === 0 || row[0]! > rows[index - 1]![0]!),
      ),
    );
  }
  assert(
    reference.sourceUrl.startsWith(
      "https://strengthlevel.com/strength-standards/",
    ),
  );
}
console.log(
  "Strength checks passed: matched references, bodyweight/category interpolation, repeated performance, units, capped reps, stale/future data, duplicate retries, unsupported variants and shared map colours.",
);
