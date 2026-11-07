import assert from "node:assert/strict";
import { prescribedWorkoutMinutes } from "../utils/workout_duration";
import { estimateMinutes } from "../graphworkflow/nodes/validation_node";

assert.equal(prescribedWorkoutMinutes([], 5), 0);
for (const targetSets of [1, 2, 3, 4])
  for (const restSeconds of [0, 60, 90, 180]) {
    const items = Array.from({ length: 5 }, () => ({
      targetSets,
      targetReps: "8–12",
      restSeconds,
    }));
    const expected = Math.ceil(
      (300 +
        5 *
          (targetSets * 12 * 4 +
            Math.max(0, targetSets - 1) * restSeconds +
            75)) /
        60,
    );
    assert.equal(prescribedWorkoutMinutes(items, 5), expected);
    assert.equal(
      estimateMinutes(
        items.map((item) => ({
          sets: item.targetSets,
          repsMax: 12,
          restSeconds: item.restSeconds,
        })),
      ),
      expected,
      "Published sessions and planner previews agree",
    );
  }
const short = Array.from({ length: 4 }, () => ({
  targetSets: 2,
  targetReps: "10-12",
  restSeconds: 60,
}));
assert.equal(
  prescribedWorkoutMinutes(short, 5),
  21,
  "Four exercises do not imply a fixed 20-minute label",
);
assert.equal(
  prescribedWorkoutMinutes(
    short.map((item) => ({ ...item, targetSets: 3, restSeconds: 90 })),
    5,
  ),
  32,
  "Extra sets and longer rests change the estimate",
);
assert.equal(
  prescribedWorkoutMinutes(
    [{ targetSets: 1, targetReps: "10", restSeconds: 180 }],
    0,
  ),
  2,
  "No rest is charged after the final set",
);
console.log(
  "Workout duration checks passed: planner/live parity, rep ranges, actual sets/rest, warm-up, transitions and empty sessions.",
);
