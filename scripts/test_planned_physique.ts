import assert from 'node:assert/strict';
import {buildPlannedPhysiqueMap} from '../modules/heatmap/planned_physique_service';

const bench = {id: 'bench', name: 'Bench press', target: 'pectorals', muscleGroup: 'chest', bodyPart: 'chest',
  secondaryMuscles: ['triceps', 'shoulders'], namesByLang: {'de': 'Bankdrücken'}};
const squat = {id: 'squat', name: 'Squat', target: 'quads', muscleGroup: 'legs', bodyPart: 'upper legs', secondaryMuscles: ['glutes']};
const item = (exercise = bench, sets = 3) => ({id: exercise.id, targetSets: sets, targetReps: '8-10', targetWeight: 20,
  targetRpe: 7, restSeconds: 90, setTargets: {weightUnit: 'total_load', sets: []}, status: 'NOT_STARTED', workout: exercise});
const plan = {id: 'active-plan', weekStart: '2026-10-19', payload: {summary: 'Saved programme', workouts: [
  {date: '2026-10-20', name: 'Upper body', restDay: false, exercises: [{exerciseId: 'bench', reason: 'Matches your available bench.', progression: 'Add reps within the range.'}]},
  {date: '2026-10-22', name: 'Lower body', restDay: false, exercises: []},
]}};
const input = {date: '2026-10-20', gender: 'FEMALE', plan, days: [], scheduled: [
  {scheduledDate: '2026-10-20', status: 'NOT_STARTED', items: [item()]},
  {scheduledDate: '2026-10-22', status: 'NOT_STARTED', items: [item(squat as typeof bench, 4)]},
]};
const actual = buildPlannedPhysiqueMap(input);
assert.equal(actual.status, 'active');
assert.deepEqual(actual.workouts[0]!.exercises[0]!.primary, ['chest']);
assert.deepEqual(actual.workouts[0]!.exercises[0]!.secondary, ['triceps', 'shoulders']);
assert.equal(actual.workouts[0]!.exercises[0]!.sets, 3);
assert.equal(actual.workouts[0]!.exercises[0]!.reason, 'Matches your available bench.');
assert.equal(actual.workouts[1]!.exercises[0]!.reason, null, 'A user-added exercise cannot inherit an unrelated AI reason');
const edited = buildPlannedPhysiqueMap({...input, scheduled: [{...input.scheduled[0]!, items: [item(squat as typeof bench, 2)]}]});
assert.deepEqual(edited.workouts[0]!.exercises[0]!.primary, ['quads']);
assert.equal(edited.workouts[0]!.exercises[0]!.sets, 2, 'Map uses the edited scheduled dose');
assert.equal(edited.workouts[0]!.exercises[0]!.reason, null);
const resting = buildPlannedPhysiqueMap({...input, days: [{date: '2026-10-20', name: 'Recovery', restDay: true}]});
assert.deepEqual(resting.workouts[0]!.exercises, []);
const skipped = buildPlannedPhysiqueMap({...input, scheduled: [{...input.scheduled[0]!, status: 'SKIPPED'}]});
assert.deepEqual(skipped.workouts[0]!.exercises, []);
assert.deepEqual(buildPlannedPhysiqueMap({...input, scheduled: []}).workouts[0]!.exercises, [], 'Missing schedules do not resurrect old recommendations');
assert.equal(buildPlannedPhysiqueMap({...input, date: '2026-10-18'}).status, 'upcoming');
assert.equal(buildPlannedPhysiqueMap({...input, date: '2026-11-01'}).status, 'expired');
assert.deepEqual(buildPlannedPhysiqueMap({...input, date: '2026-11-01'}).workouts, []);
assert.equal(buildPlannedPhysiqueMap({...input, plan: null}).status, 'none');
assert.equal(buildPlannedPhysiqueMap({...input, language: 'de'}).workouts[0]!.exercises[0]!.name, 'Bankdrücken');
const historical = buildPlannedPhysiqueMap({...input, date: '2026-11-01', selectedWeek: '2026-10-19'});
assert.equal(historical.status, 'active', 'Selecting a saved historical week must keep its exercises');
assert.equal(historical.workouts.length, 2);
assert.equal(historical.weekStart, '2026-10-19');
assert.equal(historical.weekEnd, '2026-10-25');
const differentWeek = buildPlannedPhysiqueMap({...input, selectedWeek: '2026-10-12'});
assert.equal(differentWeek.status, 'none');
assert.deepEqual(differentWeek.workouts, [], 'An empty prior week must not display the current plan');
const crossing = buildPlannedPhysiqueMap({...input, selectedWeek: '2026-10-19', plan: {...plan,
  payload: {...plan.payload, workouts: [...plan.payload.workouts,
    {date: '2026-10-26', name: 'Next week', restDay: true, exercises: []}]}}});
assert.equal(crossing.workouts.length, 2, 'Calendar-week filtering excludes the next Monday');
console.log('Planned Physique checks passed: active plan, actual doses, edited exercises, catalog muscle mapping, rest/skip, empty/upcoming/expired and localisation. No database writes.');
