// Offline checks for the legacy "add to today" request (no database access).
import assert from "node:assert/strict";
import { AddWorkoutItemSchema } from "../modules/workout/workout_types";
import { localDateForWeekday } from "../modules/workout/workout_service";

const body = {
  dayOfWeek: "WEDNESDAY",
  workoutId: "3f1c2a9e-8a51-4f3c-9d5b-2c1e7a4b6d10",
  targetSets: 3,
  targetReps: "10",
  targetWeight: 0,
  restSeconds: 90,
};
assert(AddWorkoutItemSchema.safeParse({ ...body, userWorkoutId: null }).success, "No plan today: the app sends null");
assert(AddWorkoutItemSchema.safeParse(body).success);
assert(AddWorkoutItemSchema.safeParse({ ...body, userWorkoutId: "3f1c2a9e-8a51-4f3c-9d5b-2c1e7a4b6d10" }).success);
assert(!AddWorkoutItemSchema.safeParse({ ...body, userWorkoutId: "not-a-uuid" }).success);

// 2026-11-18 is a Wednesday. Clients ahead of or behind UTC still resolve to
// their own local date from the weekday they send.
const at = (iso: string) => Date.parse(iso);
assert.equal(localDateForWeekday("WEDNESDAY", at("2026-11-18T12:00:00Z")), "2026-11-18");
assert.equal(localDateForWeekday("THURSDAY", at("2026-11-18T20:00:00Z")), "2026-11-19", "India after 01:30 local");
assert.equal(localDateForWeekday("TUESDAY", at("2026-11-18T03:00:00Z")), "2026-11-17", "Americas late evening");
assert.equal(localDateForWeekday("FRIDAY", at("2026-12-31T23:30:00Z")), "2027-01-01", "Year boundary");
assert.throws(() => localDateForWeekday("SUNDAY", at("2026-11-18T12:00:00Z")), /Invalid day/);

console.log("Add-to-today checks passed: null plan id accepted, local date from weekday across time zones.");
