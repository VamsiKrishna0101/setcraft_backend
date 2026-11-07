import assert from 'node:assert/strict';
import { sessionRows } from '../modules/progress/training/session_service';
import { TrainingData } from '../modules/progress/training/training_data';
import { exerciseList } from '../modules/progress/training/exercise_service';
import { listQuery } from '../modules/progress/progress_types';
import prisma from '../config/prisma';

const exercise = { id: 'bench', name: 'Barbell Bench Press', namesByLang: null,
  equipment: 'barbell', category: 'strength', bodyPart: 'chest', target: 'pectorals',
  muscleGroup: 'chest', secondaryMuscles: [], thumbnailUrl: null };
function set(id: string, date: string, weight: number | null, reps: number) {
  return { id, date, weight, reps, rpe: null, userWorkoutItemId: date, setNumber: 1,
    day: date.slice(8), month: date.slice(5, 7), year: date.slice(0, 4), createdAt: new Date(date),
    workoutItem: { setTargets: { weightUnit: 'total_load' }, workout: exercise } };
}
const dates = ['2026-10-01', '2026-10-03', '2026-10-05'];
const sets = [set('baseline', dates[0]!, 40, 8), set('record', dates[1]!, 45, 8), set('missing', dates[2]!, null, 10)];
const data = { sets, sessions: dates.map(date => ({ id: date, date, name: 'Workout', status: 'COMPLETED',
  durationSeconds: 600, userWorkoutId: date, userWorkout: { items: [{ id: date }] } })),
  mappings: new Map([['bench', { primary: ['chest'], secondary: [] }]]) } as unknown as TrainingData;
try {
  const period = listQuery.parse({period:'custom', date:'2026-10-05', start:'2026-10-01', end:'2026-10-03'});
  const filtered = exerciseList(data, period, 'en')[0]!;
  assert.equal(filtered.latestDate, '2026-10-03');
  assert.equal(filtered.latest?.weight, 45);
  const all = exerciseList(data, listQuery.parse({date:'2026-10-05',period:'all'}), 'en')[0]!;
  assert.equal(all.latestDate,'2026-10-05','The latest workout date is independent of the last known loaded set.');
  assert.equal(all.latest?.weight,null);
  assert.equal(all.sparkline.at(-1)?.date,'2026-10-03');
  const rows = sessionRows(data, 'en');
  assert.deepEqual(rows.map(row => row.records), [0, 1, 0]);
  assert.equal(rows[2]!.exercises[0]!.entries[0]!.weight, null);
  assert.equal(rows[2]!.volume, null);
  assert.deepEqual(sessionRows(data, 'en', [data.sessions[0]!]).map(row => row.records), [0]);
  assert.deepEqual(sessionRows({ ...data, sets: [] }, 'en').map(row => row.records), [0, 0, 0]);
  console.log('Session record badges: baseline, real improvement, missing load, filtered sessions and empty logs passed.');
} finally { void prisma.$disconnect(); }
