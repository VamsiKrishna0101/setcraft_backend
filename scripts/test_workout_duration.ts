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
          (targetSets * 12 * 4 + targetSets * restSeconds + 120)) /
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
  28,
  "Four exercises do not imply a fixed 20-minute label",
);
assert.equal(
  prescribedWorkoutMinutes(
    short.map((item) => ({ ...item, targetSets: 3, restSeconds: 90 })),
    5,
  ),
  41,
  "Extra sets and longer rests change the estimate",
);
assert.equal(
  prescribedWorkoutMinutes(
    [{ targetSets: 1, targetReps: "10", restSeconds: 180 }],
    0,
  ),
  6,
  "Rest after the final set and the changeover are charged",
);
// Two presses (3x8, 120 s) and three accessories (3x10, 90 s) take about
// 50 minutes in a real gym, not the 38 the old estimate showed.
assert.equal(
  prescribedWorkoutMinutes(
    [
      { targetSets: 3, targetReps: "8", restSeconds: 120 },
      { targetSets: 3, targetReps: "8", restSeconds: 120 },
      { targetSets: 3, targetReps: "10", restSeconds: 90 },
      { targetSets: 3, targetReps: "10", restSeconds: 90 },
      { targetSets: 3, targetReps: "10", restSeconds: 90 },
    ],
    5,
  ),
  50,
  "Five full exercises are about a 50-minute session",
);
console.log(
  "Workout duration checks passed: planner/live parity, rep ranges, actual sets/rest, warm-up, transitions and empty sessions.",
);
