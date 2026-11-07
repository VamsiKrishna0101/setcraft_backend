import assert from "node:assert/strict";
import { assertMeasurementBaseline, missingMeasurementBaseline, plannerSnapshot } from "../graphworkflow/common/measurements";
import { PlannerError, Snapshot } from "../graphworkflow/common/types";

const entry = (metrics: Record<string, {value: number; source: string}>, date = "2025-01-01") =>
  ({id: Math.random().toString(), date, source: "entered", metrics});
const snapshot = (measurements: Snapshot["measurements"], height = 175) =>
  ({profile: {height}, measurements, timezone: "UTC"} as Snapshot);
const weight = {weightKg: {value: 75, source: "scale"}};
const waist = {waistCm: {value: 86, source: "tape"}};

assert.deepEqual(missingMeasurementBaseline(snapshot([])), ["weightKg", "waistCm"]);
assert.deepEqual(missingMeasurementBaseline(snapshot([entry(weight)])), ["waistCm"]);
assert.deepEqual(missingMeasurementBaseline(snapshot([entry(waist)])), ["weightKg"]);
assert.doesNotThrow(() => assertMeasurementBaseline(snapshot([entry(weight), entry(waist)])));
assert.doesNotThrow(() => assertMeasurementBaseline(snapshot([
  entry({...weight, ...waist}), entry({weightKg: {value: 74, source: "scale"}}, "2025-02-01")
])));
assert.deepEqual(missingMeasurementBaseline(snapshot([entry({...weight, ...waist})], 0)), ["height"]);
assert.deepEqual(missingMeasurementBaseline(snapshot([entry({
  weightKg: {value: 75, source: "profile"}, waistCm: {value: 86, source: "photo_estimate"}
})])), ["weightKg", "waistCm"]);
assert.deepEqual(missingMeasurementBaseline(snapshot([entry({...weight, ...waist}, "2099-01-01")])),
  ["weightKg", "waistCm"]);
assert.deepEqual(missingMeasurementBaseline(snapshot([entry({
  weightKg: {value: NaN, source: "scale"}, waistCm: {value: 500, source: "tape"}
})])), ["weightKg", "waistCm"]);
assert.throws(() => assertMeasurementBaseline(snapshot([entry(weight)])), error =>
  error instanceof PlannerError && error.code === "MEASUREMENTS_REQUIRED" && error.status === 422);
assert.doesNotThrow(() => assertMeasurementBaseline(plannerSnapshot(snapshot([entry({...weight, ...waist})]))));
console.log("Measurement baseline checks passed: complete, partial, historical, future, sources and invalid values.");
