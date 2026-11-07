import assert from "node:assert/strict";
import { buildBodyMap } from "../modules/heatmap/body_map_service";
import { buildPlannedPhysiqueMap } from "../modules/heatmap/planned_physique_service";
import {
  buildTrainingMap,
  TrainingSet,
} from "../modules/heatmap/training_map_engine";

const bench = {
  id: "bench",
  name: "Bench press",
  target: "pectorals",
  muscleGroup: "chest",
  bodyPart: "chest",
  secondaryMuscles: ["triceps"],
};
const squat = {
  id: "squat",
  name: "Squat",
  target: "quads",
  muscleGroup: "legs",
  bodyPart: "upper legs",
  secondaryMuscles: ["glutes"],
};
const item = (id: string, exercise = bench, sets = 4) => ({
  id,
  targetSets: sets,
  targetReps: "10",
  targetWeight: 20,
  targetRpe: 7,
  restSeconds: 90,
  setTargets: {},
  status: "NOT_STARTED",
  workout: exercise,
});
const input = {
  date: "2026-10-29",
  selectedWeek: "2026-10-26",
  gender: "MALE",
  plan: {
    id: "weekly-plan-id",
    weekStart: "2026-10-26",
    payload: {
      workouts: [
        { date: "2026-10-28", name: "Upper", restDay: false },
        { date: "2026-10-30", name: "Lower", restDay: false },
      ],
    },
  },
  days: [],
  scheduled: [
    {
      scheduledDate: "2026-10-28",
      status: "NOT_STARTED",
      items: [item("bench-item")],
    },
    {
      scheduledDate: "2026-10-30",
      status: "NOT_STARTED",
      items: [item("squat-item", squat, 3)],
    },
  ],
};
const plan = buildPlannedPhysiqueMap(input);
const sets: TrainingSet[] = [
  ...[1, 2].map((setNumber) => ({
    id: String(setNumber),
    itemId: "bench-item",
    setNumber,
    date: "2026-10-28",
    reps: 10,
    weight: 20,
    exercise: bench,
  })),
];
const training = (logs = sets) =>
  buildTrainingMap({
    date: input.date,
    utcOffsetMinutes: 0,
    sets: logs,
    // A stale reusable schedule must NEVER supply Body's target quantities.
    planned: [
      {
        itemId: "old-template",
        dayOfWeek: "MONDAY",
        targetSets: 99,
        exercise: bench,
      },
    ],
    checkIns: [],
    focusMuscles: [],
    limitations: [],
  });
const actual = buildBodyMap(plan, training());
const chest = actual.regions.find((r) => r.id === "chest")!;
assert.equal(actual.planId, "weekly-plan-id");
assert.equal(chest.plannedSets, 4);
assert.equal(chest.completedSets, 2);
assert.equal(chest.status, "in_progress");
assert.equal(actual.summary.plannedSets, 7);
assert.equal(actual.regions.find((r) => r.id === "quads")!.status, "planned");
assert.equal(actual.regions.find((r) => r.id === "triceps")!.plannedSets, 0);
assert.equal(actual.regions.find((r) => r.id === "triceps")!.assistingSets, 2);
assert.equal(actual.regions.find((r) => r.id === "triceps")!.status, "logged");
assert.equal(
  buildBodyMap(plan, training([...sets, { ...sets[0]!, id: "retry" }])).summary
    .loggedSets,
  2,
);
const complete = buildBodyMap(
  plan,
  training([
    ...sets,
    ...[3, 4].map((setNumber) => ({
      ...sets[0]!,
      id: String(setNumber),
      setNumber,
    })),
  ]),
);
assert.equal(
  complete.regions.find((r) => r.id === "chest")!.status,
  "completed",
);
const skippedPlan = buildPlannedPhysiqueMap({
  ...input,
  scheduled: [
    { ...input.scheduled[0]!, status: "SKIPPED" },
    input.scheduled[1]!,
  ],
});
assert.equal(
  buildBodyMap(skippedPlan, training()).regions.find((r) => r.id === "chest")!
    .plannedSets,
  0,
);
const resting = buildPlannedPhysiqueMap({
  ...input,
  days: [{ date: "2026-10-28", name: "Rest", restDay: true }],
});
assert.equal(
  buildBodyMap(resting, training()).regions.find((r) => r.id === "chest")!
    .plannedSets,
  0,
);
const edited = buildPlannedPhysiqueMap({
  ...input,
  scheduled: [{ ...input.scheduled[0]!, items: [item("edited", squat, 6)] }],
});
assert.equal(
  buildBodyMap(edited, training()).regions.find((r) => r.id === "chest")!
    .plannedSets,
  0,
);
assert.equal(
  buildBodyMap(edited, training()).regions.find((r) => r.id === "quads")!
    .plannedSets,
  6,
);
const noPlan = buildPlannedPhysiqueMap({ ...input, plan: null });
assert.equal(buildBodyMap(noPlan, training()).summary.plannedSets, 0);
assert.equal(
  buildBodyMap(noPlan, training()).regions.find((r) => r.id === "chest")!
    .status,
  "logged",
);
console.log(
  "Body map checks passed: canonical targets, edits, rest, skips, direct/assisting sets, completion and duplicate logs.",
);

const historical: TrainingSet[] = [
  "2024-12-31",
  "2026-10-26",
  "2026-10-27",
  "2026-10-28",
  "2026-11-01",
].map((date, index) => ({ ...sets[0]!, id: `history-${index}`, date }));
const selectedMap = (selection: {
  from?: string;
  dates?: string[];
  all?: boolean;
}) =>
  buildTrainingMap({
    date: input.date,
    utcOffsetMinutes: 330,
    sets: [...historical, { ...historical[1]!, id: "retry" }],
    planned: [],
    checkIns: [],
    focusMuscles: [],
    limitations: [],
    selection,
  });
const selected = selectedMap({ dates: ["2026-10-26", "2026-10-28"] });
assert.equal(selected.summary.loggedSets, 2);
assert.equal(selected.summary.sessions, 2);
const selectedChest = selected.regions.find((r) => r.id === "chest")!;
assert.deepEqual(
  selectedChest.sessions.map((s) => s.date),
  ["2026-10-28", "2026-10-26"],
);
assert.equal(selectedChest.loggedExercises[0]!.exerciseId, "bench");
assert.equal(selectedChest.loggedExercises[0]!.directSets, 2);
assert.equal(selectedChest.loggedExercises[0]!.sets[0]!.reps, 10);
assert.equal(selectedMap({ dates: ["2026-10-27"] }).summary.loggedSets, 1);
assert.equal(selectedMap({ from: "2026-10-27" }).summary.loggedSets, 2);
assert.equal(selectedMap({ all: true }).summary.loggedSets, 4);
assert.equal(selectedMap({ all: true }).periodStart, "2024-12-31");
assert.equal(selectedMap({ from: "2026-10-29" }).summary.loggedSets, 0);
assert.equal(
  selected.regions.find((r) => r.id === "triceps")!.loggedExercises[0]!
    .assistingSets,
  2,
);
assert.ok(
  buildBodyMap(plan, selected).regions.find((r) => r.id === "chest")!.strength,
);
assert.equal(buildBodyMap(plan, selected).summary.sessions, 2);
console.log(
  "Training selections passed: exact days, ranges, all-time history, future exclusion, retries and exercise details.",
);
