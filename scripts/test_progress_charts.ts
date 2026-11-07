import assert from 'node:assert/strict';
import { progressRange, inRange } from '../modules/progress/progress_range';
import { listQuery } from '../modules/progress/progress_types';
import { trainingSummary } from '../modules/progress/training/training_summary';
import type { TrainingData } from '../modules/progress/training/training_data';
import { progressPlanRows } from '../modules/progress/progress_service';
import { planHistoryWhere } from '../graphworkflow/plan_history_filter';

const query = listQuery.parse({ period: 'custom', date: '2026-10-30',
  start: '2026-10-26', end: '2026-10-30', dates: '2026-10-26,2026-10-30' });
const range = progressRange(query);
assert.equal(inRange('2026-10-28', range), false);
assert.equal(inRange('2026-10-26', range), true);
assert.equal(range.comparable, false);
assert.equal(listQuery.safeParse({...query, dates: '2026-11-01'}).success, false);
assert.equal(listQuery.safeParse({...query, dates: '2026-02-30'}).success, false);
const data = {
  sets: [26, 28, 30].map(day => ({ id: `s-${day}`, date: `2026-10-${day}`,
    reps: 8, weight: day * 2, workoutItem: { workout: { id: 'bench' } } })),
  sessions: [26, 28, 30].map(day => ({date: `2026-10-${day}`, status: 'COMPLETED'})),
  mappings: new Map([['bench', {primary: ['chest'], secondary: []}]]),
} as unknown as TrainingData;
const summary = trainingSummary(data, range);
assert.equal(summary.summary.workouts, 2);
assert.equal(summary.summary.trainingDays, 2);
assert.equal(summary.summary.sets, 2);
assert.equal(summary.muscles.find(m => m.id === 'chest')!.directSets, 2);
assert.equal(summary.summary.workoutChange, null);
assert.deepEqual(progressPlanRows([
  {id: 'latest', weekStart: '2026-10-26'}, {id: 'revision', weekStart: '2026-10-26'},
  {id: 'old', weekStart: '2026-10-19'},
], range).map(plan => plan.id), ['latest']);
const historyFilter = planHistoryWhere('owner', range);
assert.equal(historyFilter.userId, 'owner');
assert.equal(historyFilter.synthetic, false);
assert.deepEqual(historyFilter.weekStart, {gte: '2026-10-20', lte: '2026-10-30'});
assert.deepEqual(historyFilter.OR, [
  {weekStart: {gte: '2026-10-20', lte: '2026-10-26'}},
  {weekStart: {gte: '2026-10-24', lte: '2026-10-30'}},
]);
console.log('Progress chart filters: sparse dates, muscle counts, plan overlap and validation passed.');
