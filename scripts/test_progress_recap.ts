import assert from 'node:assert/strict';
import { trainingSummary } from '../modules/progress/training/training_summary';
import type { TrainingData } from '../modules/progress/training/training_data';
import { progressRange } from '../modules/progress/progress_range';

const range = progressRange({ period: '4w', date: '2026-10-30', utcOffsetMinutes: 0 });
function set(id: string, exerciseId: string, date: string, weight: number | null, reps: number) {
  return { id, date, weight, reps, workoutItem: { workout: { id: exerciseId } } };
}
const data = {
  sets: [
    set('old', 'bench', '2026-09-20', 40, 8),
    set('outside', 'bench', '2026-10-01', 50, 8),
    set('baseline', 'pull-up', '2026-10-02', null, 10),
    set('bench-1', 'bench', '2026-10-05', 55, 8),
    set('pull-1', 'pull-up', '2026-10-06', null, 12),
    set('pull-2', 'pull-up', '2026-10-12', null, 13),
    set('bench-2', 'bench', '2026-10-15', 60, 8),
  ],
  sessions: [
    { date: '2026-09-20', status: 'COMPLETED' },
    { date: '2026-10-05', status: 'COMPLETED' },
    { date: '2026-10-12', status: 'COMPLETED' },
    { date: '2026-10-15', status: 'IN_PROGRESS' },
  ],
  mappings: new Map(),
} as unknown as TrainingData;

const recap = trainingSummary(data, range);
assert.equal(recap.summary.workouts, 2);
assert.equal(recap.summary.previousWorkouts, 1);
assert.equal(recap.summary.workoutChange, 1);
assert.equal(recap.summary.hasPreviousTraining, true);
assert.equal(recap.summary.records, 4);
assert.equal(recap.summary.volume, 920);
assert.equal(recap.weeks.reduce((sum, week) => sum + week.workouts, 0), 2);
assert.deepEqual(recap.personalBests.map(record => [record.exerciseId, record.date]), [
  ['bench', '2026-10-15'], ['pull-up', '2026-10-12'],
]);
assert.deepEqual(recap.personalBests[0], {
  exerciseId: 'bench', date: '2026-10-15', weight: 60, reps: 8,
  kinds: ['load', 'set_volume'],
});
assert.equal(recap.personalBests[1]!.weight, null);

const firstPeriod = trainingSummary({
  sets: [set('first', 'bench', '2026-10-15', 60, 8)],
  sessions: [], mappings: new Map(),
} as unknown as TrainingData, range);
assert.equal(firstPeriod.summary.hasPreviousTraining, false);
assert.equal(firstPeriod.summary.workouts, 0);
assert.equal(firstPeriod.summary.sets, 1);
assert.equal(firstPeriod.summary.records, 0);
assert.deepEqual(firstPeriod.personalBests, []);

const allTime = trainingSummary(data, progressRange({
  period: 'all', date: '2026-10-30', utcOffsetMinutes: 0,
}, '2026-09-20'));
assert.equal(allTime.summary.previousWorkouts, null);
assert.equal(allTime.summary.workoutChange, null);
console.log('Progress recap: workout baselines, record highlights, bodyweight and ranges passed.');
