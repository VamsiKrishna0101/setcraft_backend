import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildTrainingMap,
  calendarWindow,
  mapExercise,
  Exercise,
  TrainingSet,
} from "../modules/heatmap/training_map_engine";
import {
  createOnboardingSchema,
  updateOnboardingSchema,
} from "../modules/onboarding/onboarding_types";
import { trainingMapSchedule } from "../modules/heatmap/training_map_schedule";

const bench: Exercise = {
  id: "bench",
  name: "Barbell Bench Press",
  equipment: "barbell",
  target: "pectorals",
  muscleGroup: "chest",
  bodyPart: "chest",
  secondaryMuscles: ["triceps", "deltoids"],
};
const squat: Exercise = {
  id: "squat",
  name: "Squat",
  target: "quads",
  muscleGroup: "legs",
  bodyPart: "upper legs",
  secondaryMuscles: ["glutes"],
};
const row: Exercise = {
  id: "row",
  name: "Seated row",
  target: "upper back",
  muscleGroup: "back",
  bodyPart: "back",
  secondaryMuscles: ["biceps", "lats"],
};
const set = (
  id: string,
  itemId: string,
  date: string,
  setNumber: number,
  exercise: Exercise,
  weight = 50,
): TrainingSet => ({
  id,
  itemId,
  date,
  setNumber,
  exercise,
  weight,
  reps: 8,
  weightUnit: "total_load",
});
const sets = [
  set("previous", "bench-old", "2026-09-30", 1, bench, 45),
  set("old", "bench-old", "2026-10-04", 1, bench, 47.5),
  ...Array.from({ length: 4 }, (_, i) =>
    set(`b${i}`, "bench-now", "2026-10-05", i + 1, bench),
  ),
  set("retry", "bench-now", "2026-10-05", 1, bench),
  ...Array.from({ length: 2 }, (_, i) =>
    set(`bt${i}`, "bench-now", "2026-10-06", i + 1, bench, 55),
  ),
  ...Array.from({ length: 3 }, (_, i) =>
    set(`r${i}`, "row", "2026-10-05", i + 1, row, 35),
  ),
  set("future", "bench-now", "2026-10-07", 1, bench),
];
const input = {
  strengthProfile: { age: 30, gender: "MALE", weight: 60 },
  date: "2026-10-06",
  utcOffsetMinutes: 330,
  sets,
  planned: [
    {
      itemId: "bench-now",
      targetSets: 4,
      dayOfWeek: "MONDAY",
      exercise: bench,
    },
    {
      itemId: "bench-next",
      targetSets: 6,
      dayOfWeek: "THURSDAY",
      exercise: bench,
    },
    { itemId: "squat", targetSets: 4, dayOfWeek: "TUESDAY", exercise: squat },
    { itemId: "row", targetSets: 3, dayOfWeek: "MONDAY", exercise: row },
  ],
  checkIns: [],
  focusMuscles: ["chest", "quads"],
  limitations: ["NONE"],
};
const map = buildTrainingMap(input);
const muscle = (id: string) => map.regions.find((r) => r.id === id)!;
assert.equal(map.weekStart, "2026-10-05");
assert.equal(
  calendarWindow("2026-10-06", 330).startUtc.toISOString(),
  "2026-10-04T18:30:00.000Z",
);
assert.throws(() => calendarWindow("2026-02-30", 0));
assert.throws(() => calendarWindow("2026-10-06", 900));
assert.equal(
  map.summary.loggedSets,
  9,
  "Retry/future sets must not inflate logged volume",
);
const daily = buildTrainingMap({
  ...input,
  period: "day",
  planned: input.planned.filter((item) => item.dayOfWeek === "TUESDAY"),
});
assert.equal(
  daily.summary.loggedSets,
  2,
  "Daily previews exclude sets from other days in the same week.",
);
assert.equal(
  daily.regions.find((region) => region.id === "chest")!.completedSets,
  2,
);
assert.equal(
  daily.regions.find((region) => region.id === "upper_back")!.completedSets,
  0,
);
assert.equal(
  buildTrainingMap({ ...input, date: "2026-10-05", period: "day" }).summary
    .loggedSets,
  7,
);
assert.equal(muscle("chest").completedSets, 6);
assert.equal(muscle("chest").strength.tier, 2);
assert.equal(daily.regions.find((region) => region.id === "chest")!.strength.tier, 2,
  "A muscle trained in both periods retains its confirmed strength estimate");
assert.deepEqual(daily.regions.find(region => region.id === "chest")!.sessions.map(s => s.date), [input.date]);
assert.deepEqual(daily.regions.find(region => region.id === "chest")!.trend.map(s => s.date), [input.date]);
assert.equal(daily.regions.find(region => region.id === "upper_back")!.sessions.length, 0);
assert.equal(daily.regions.find(region => region.id === "upper_back")!.trend.length, 0);
const emptyDay = buildTrainingMap({...input, date: "2026-10-08", period: "day"});
assert.equal(emptyDay.summary.loggedSets, 0);
assert(emptyDay.regions.every(region => region.strength.tier === 0 && !region.strength.provisional));
assert(emptyDay.regions.every(region => region.sessions.length === 0 && region.trend.length === 0));
assert.equal(emptyDay.periodStart, "2026-10-08");
assert.equal(map.periodStart, "2026-10-05");
assert.equal(map.periodEnd, "2026-10-06");
assert(map.regions.every(region => region.sessions.every(session => session.date >= map.periodStart && session.date <= map.periodEnd)));
const sevenDays = buildTrainingMap({...input, date: "2026-10-11", sets: Array.from({length: 7}, (_, i) =>
  set(`daily-${i}`, "b", `2026-10-${String(5 + i).padStart(2, "0")}`, 1, bench))});
assert.equal(sevenDays.regions[0]!.completedSets, 7);
assert.equal(sevenDays.regions[0]!.sessions.length, 7, "The full week must not silently truncate the seventh training day");
const nextWeek = buildTrainingMap({...input, date: "2026-10-12"});
assert.equal(nextWeek.summary.loggedSets, 0);
assert(nextWeek.regions.every(region => region.strength.tier === 0));
const invalid = buildTrainingMap({...input, sets: [
  ...sets, {...sets[0]!, date: "2026-02-30"}, {...sets[0]!, reps: NaN},
  {...sets[0]!, setNumber: 0}, {...sets[0]!, reps: 1.5},
]});
assert.deepEqual(invalid.summary, map.summary, "Invalid legacy logs cannot inflate totals");
const unknown = {...bench, id: "unknown", name: "Mystery", target: null, muscleGroup: null, bodyPart: "unknown"};
assert.deepEqual(buildTrainingMap({...input, period: "day", sets: [...sets,
  set("unknown", "unknown", "2026-10-05", 1, unknown)], planned: []}).unmappedExercises, [],
  "Unmapped warnings exclude exercises outside the selected period");
for (const date of ["2026-03-29", "2026-10-25", "2027-01-01"]) {
  for (const offset of [-300, 0, 60, 120, 330]) {
    const value = buildTrainingMap({...input, date, utcOffsetMinutes: offset, sets: [set("boundary", "b", date, 1, bench)]});
    assert.equal(value.summary.loggedSets, 1);
    assert.equal(new Date(`${value.weekStart}T00:00:00Z`).getUTCDay(), 1);
  }
}
const monday = "2026-10-05";
const reusable = {id: "reusable", scheduledDate: null, status: "NOT_STARTED", createdAt: new Date("2026-10-01"), items: input.planned};
const skipped = {id: "skipped", scheduledDate: monday, status: "SKIPPED", createdAt: new Date(monday), items: input.planned};
assert.deepEqual(trainingMapSchedule([reusable, skipped], [monday], [], 330), [], "Skipped dated workout never falls back to reusable targets");
assert.deepEqual(trainingMapSchedule([reusable], [monday], [monday], 330), []);
assert.deepEqual(trainingMapSchedule([{...reusable, createdAt: new Date("2026-10-06")}], [monday], [], 330), [], "Later schedules cannot fill earlier dates");
assert.equal(trainingMapSchedule([reusable], [monday], [], 330).length, 2);
assert.deepEqual(trainingMapSchedule([{...skipped, status: "NOT_STARTED", items: input.planned.map(item => ({...item, status: "SKIPPED"}))}, reusable], [monday], [], 330), []);
const earlier = buildTrainingMap({ ...input, date: "2026-09-30", period: "day" });
assert.equal(earlier.summary.loggedSets, 1);
assert.equal(earlier.regions.find((region) => region.id === "chest")!.strength.provisional, true,
  "Historical strength remains provisional until another qualifying day is recorded");
assert.equal(earlier.regions.find((region) => region.id === "chest")!.trend.length, 1);
assert.equal(muscle("quads").strength.tier, 0);
assert.equal(muscle("chest").targetSets, 10);
assert.equal(muscle("chest").previousWeekSets, 2);
assert.equal(
  muscle("triceps").completedSets,
  0,
  "Assisting sets are not direct sets",
);
assert.equal(muscle("triceps").assistingSets, 6);
assert.equal(
  muscle("triceps").daysSinceExposure,
  0,
  "Exposure history includes assisting muscles",
);
assert.equal(muscle("upper_back").status, "complete");
assert.equal(muscle("quads").status, "due");
assert.equal(muscle("calves").checkInStatus, "not_reported");
assert.equal(muscle("chest").trend.at(-1)?.weightKg, 55);
assert.equal(
  buildTrainingMap({
    ...input,
    checkIns: [{ muscleId: "chest", date: input.date, soreness: 3 }],
  }).regions[0].checkInStatus,
  "very_sore",
);
assert.deepEqual(
  mapExercise({ ...bench, target: "triceps", bodyPart: "upper arms" }).primary,
  ["triceps"],
  "Specific metadata wins over exercise name",
);
assert.deepEqual(
  mapExercise({
    ...bench,
    name: "Custom activity",
    target: null,
    muscleGroup: null,
    bodyPart: "unknown",
    secondaryMuscles: [],
  }).primary,
  [],
);
assert.equal(
  buildTrainingMap({ ...input, sets: [], planned: [] }).summary.loggedSets,
  0,
);
assert.equal(
  buildTrainingMap({ ...input, sets: [], planned: [] }).regions.every(
    (r) => r.status === "no_target",
  ),
  true,
);
assert.equal(
  updateOnboardingSchema.safeParse({
    focusMuscles: ["chest", "quads"],
    preferredTime: "EVENING",
  }).success,
  true,
);
assert.equal(
  updateOnboardingSchema.safeParse({ focusMuscles: ["chest", "chest"] })
    .success,
  false,
);
assert.equal(
  updateOnboardingSchema.safeParse({ foodBudgetAmount: -5 }).success,
  false,
);
assert.equal(
  createOnboardingSchema.shape.foodAllergies.safeParse(["peanuts"]).success,
  true,
);
assert.equal(
  updateOnboardingSchema.parse({ focusMuscles: ["chest"] }).limitations,
  undefined,
  "Updating priorities must preserve existing limitations",
);
assert.equal(
  updateOnboardingSchema.parse({ focusMuscles: ["chest"] }).language,
  undefined,
  "Updating priorities must preserve the selected language",
);
fs.mkdirSync("../mobile/test/fixtures", { recursive: true });
fs.writeFileSync(
  "../mobile/test/fixtures/training_map.json",
  JSON.stringify({ ...map, gender: "MALE" }),
);
console.log(
  "25 training-map and onboarding contract checks passed; generated a synthetic visual fixture.",
);
