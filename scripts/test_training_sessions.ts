import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import workoutRoutes from '../modules/workout/workout_routes';
import prisma from '../config/prisma';
import { getUserWorkouts } from '../modules/workout/workout_service';
import { getTrainingMap } from '../modules/heatmap/training_map_service';
import { dayQuery, setSchema, weekday } from '../modules/workout/session/session_types';
import * as training from '../modules/workout/session/session_service';

async function main() {
  const user = await prisma.user.create({ data: { email: `training-test-${randomUUID()}@example.invalid`, password: 'isolated-test-user', trialStartedAt:new Date(), trialEndsAt:new Date(Date.now()+86400000) } });
  const other = await prisma.user.create({ data: { email: `training-test-${randomUUID()}@example.invalid`, password: 'isolated-test-user', trialStartedAt:new Date(), trialEndsAt:new Date(Date.now()+86400000) } });
  const date = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const day = weekday(date) as any;
  const app = express();
  app.use(express.json());
  app.use('/api/workout', workoutRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/workout/training`;
  const token = jwt.sign({ userId: user.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' });
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}?date=${date}`)).status, 401);
    assert.equal((await fetch(`${base}?date=2026-02-30`, { headers })).status, 400);
    assert.equal((await fetch(`${base}/items/${randomUUID()}/sets?date=${date}`, {
      method: 'PUT', headers, body: JSON.stringify({ setNumber: 1, reps: -5 }),
    })).status, 400);
    assert.equal(dayQuery.safeParse({ date: '2026-02-30' }).success, false);
    assert.equal(setSchema.safeParse({ setNumber: 1, reps: -1 }).success, false);
    assert.equal(setSchema.safeParse({ setNumber: 0, reps: 10 }).success, false);
    assert.equal(await getUserWorkouts(user.id, day), null);
    assert.equal(await prisma.userWorkout.count({ where: { userId: user.id } }), 0);
    const exercises = await prisma.workout.findMany({ take: 2, where: { target: { contains: 'pectoral', mode: 'insensitive' }, coachingMetadata:{path:['exerciseType'],equals:'weight_reps'}, catalogStatus:{notIn:['STAGED','ARCHIVED']} } });
    assert.equal(exercises.length, 2);
    const first = { workoutId: exercises[0]!.id, targetSets: 3, targetReps: '8-12', targetWeight: 0, restSeconds: 60 };
    const second = { ...first, workoutId: exercises[1]!.id };
    const routine = await training.saveRoutine(user.id, { name: 'Isolated test routine', items: [first, second] });
    await assert.rejects(training.applyRoutine(other.id, date, routine.id));
    await training.applyRoutine(user.id, date, routine.id);
    let response: any = await training.getTrainingWeek(user.id, date, 'de');
    assert.equal(response.items.length, 2);
    const scheduleIds = response.items.map((row: any) => row.id);
    const setTargets = {
      weightBasis: 'estimated_start', weightUnit: 'per_hand',
      sets: [
        { setNumber: 1, repsMin: 10, repsMax: 10, weightKg: 2, targetRpe: 6 },
        { setNumber: 2, repsMin: 10, repsMax: 10, weightKg: 3, targetRpe: 6 },
        { setNumber: 3, repsMin: 10, repsMax: 10, weightKg: 3, targetRpe: 6 },
      ],
    };
    await prisma.userWorkoutItem.update({ where: { id: scheduleIds[1] }, data: { setTargets } });
    // Bookmarks retain every prescribed set, not only the first load.
    const saved = await training.saveRoutine(user.id, { name: 'Prescription test', items: [
      { ...first, setTargets: { ...setTargets, weightBasis: 'estimated_start', weightUnit: 'per_hand' } as any },
    ] });
    const savedResponse = await fetch(base + '/routines/' + saved.id + '?date=' + date, { headers });
    assert.equal(savedResponse.status, 200);
    const preview: any = (await savedResponse.json() as any).data;
    assert.equal(preview.items[0].setTargets.sets[1].weightKg, 3);
    assert(preview.items[0].workout.name);
    await assert.rejects(training.getRoutine(other.id, saved.id, 'en'));
    await assert.rejects(training.updateRoutine(other.id, saved.id, { name: 'Not mine', items: [first] }));
    const editResponse = await fetch(base + '/routines/' + saved.id + '?date=' + date, {
      method: 'PUT', headers, body: JSON.stringify({ name: 'Updated prescription', items: [
        { ...first, setTargets },
      ] }),
    });
    assert.equal(editResponse.status, 200);
    const edited = await training.getRoutine(user.id, saved.id, 'en');
    assert.equal(edited.name, 'Updated prescription');
    assert.equal(edited.items[0]!.setTargets!.sets[2]!.weightKg, 3);
    const malformed = await fetch(base + '/routines/' + saved.id + '?date=' + date, {
      method: 'PUT', headers, body: JSON.stringify({ name: 'Invalid', items: [
        { ...first, setTargets: { ...setTargets, sets: [setTargets.sets[0], setTargets.sets[0]] } },
      ] }),
    });
    assert.equal(malformed.status, 400);
    await training.deleteRoutine(user.id, saved.id);
    await training.reorderItems(user.id, date, [...scheduleIds].reverse());
    await assert.rejects(training.reorderItems(user.id, date, [scheduleIds[0], scheduleIds[0]]));
    const starts = await Promise.all([training.startSession(user.id, date, 330), training.startSession(user.id, date, 330)]);
    assert.equal(starts[0]!.id, starts[1]!.id);
    assert.equal(await prisma.workoutSession.count({ where: { userId: user.id } }), 1);
    response = await training.getTrainingWeek(user.id, date, 'en');
    const item = response.items[0];
    assert.deepEqual(item.setTargets, setTargets, 'Starting a workout preserves per-set targets.');
    assert.equal(item.setLogs.length, 0, 'Targets must never become completed sets.');
    assert(!scheduleIds.includes(item.id));
    const set = { setNumber: 1, reps: 10, weight: 25, rpe: null };
    for (const weight of [null,0]) {
      const invalidLoad = await fetch(`${base}/items/${item.id}/sets?date=${date}`, {
        method:'PUT',headers,body:JSON.stringify({...set,weight}),
      });
      assert.equal(invalidLoad.status,400,'Weighted sets require actual positive load');
      await assert.rejects(training.completeItem(user.id,date,item.id,[{...set,weight}]),/weight you lifted/);
    }
    assert.equal(await prisma.workoutSetLog.count({where:{userId:user.id}}),0);

    await Promise.all([training.saveSessionSet(user.id, date, item.id, set), training.saveSessionSet(user.id, date, item.id, set)]);
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: user.id } }), 1);
    await training.saveSessionSet(user.id, date, item.id, { ...set, reps: 12 });
    assert.equal((await prisma.workoutSetLog.findFirst({ where: { userId: user.id } }))!.reps, 12);
    await assert.rejects(training.mutateItem(user.id, date, item.id, 'remove', {}));
    await assert.rejects(training.saveSessionSet(other.id, date, item.id, set));
    await training.deleteSessionSet(user.id, date, item.id, 1);
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: user.id } }), 0);
    await assert.rejects(training.mutateItem(user.id, date, item.id, 'status', { status: 'COMPLETED' }), /Log at least one set/);
    await training.saveSessionSet(user.id, date, item.id, set);

    const batch = [set, { ...set, setNumber: 2 }, { ...set, setNumber: 3 }];
    const completeUrl = `${base}/items/${item.id}/complete?date=${date}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const completed = await fetch(completeUrl, { method: 'POST', headers, body: JSON.stringify({ sets: batch }) });
      assert.equal(completed.status, 200);
      const body: any = await completed.json();
      assert.equal(body.data.summary.sets, 3);
      assert.equal(body.data.items[0].status, 'COMPLETED');
      assert.equal(body.data.week, undefined, 'Completion returns the day, not a full week.');
    }
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: user.id } }), 3, 'Retries cannot duplicate sets.');
    const invalid = await fetch(completeUrl, { method: 'POST', headers, body: JSON.stringify({ sets: [set, set] }) });
    assert.equal(invalid.status, 400);
    await assert.rejects(training.completeItem(other.id, date, item.id, batch));
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: other.id } }), 0);
    await training.deleteSessionSet(user.id, date, item.id, 2);
    await training.deleteSessionSet(user.id, date, item.id, 3);
    await assert.rejects(training.finishSession(user.id, date));
    await training.mutateItem(user.id, date, item.id, 'status', { status: 'COMPLETED' });
    await training.mutateItem(user.id, date, response.items[1].id, 'status', { status: 'SKIPPED' });
    await training.finishSession(user.id, date);
    await training.finishSession(user.id, date);
    response = await training.getTrainingWeek(user.id, date, 'en');
    assert.equal(response.session.status, 'COMPLETED');
    assert.equal(response.summary.sets, 1);
    assert.equal(response.summary.volume, 250);
    assert.equal(response.summary.skipped, 1);
    await training.completeItem(user.id, date, item.id, [{ ...set, weight: 25 }]);
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: user.id } }), 1);
    await assert.rejects(training.completeItem(user.id, date, item.id, [{ ...set, weight: 50 }]));
    await training.updateDay(other.id, date, { restDay: true });
    assert.equal(response.week.find((row: any) => row.date === date).status, 'COMPLETED');
    assert(response.session.durationSeconds >= 0);
    await training.saveSessionSet(user.id, date, item.id, { ...set, reps: 12 });
    response = await training.getTrainingWeek(user.id, date, 'en');
    assert.equal(response.session.status, 'COMPLETED');
    assert.equal(response.summary.sets, 1);
    assert.equal(response.summary.volume, 300);
    await training.deleteSessionSet(user.id, date, item.id, 1);
    response = await training.getTrainingWeek(user.id, date, 'en');
    assert.equal(response.summary.sets, 0);
    await training.saveSessionSet(user.id, date, item.id, set);
    const tomorrow = new Date(`${date}T12:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const later = tomorrow.toISOString().slice(0, 10);
    const history = await training.previousPerformance(user.id, item.workoutId, later);
    assert.equal(history.sets.length, 1);
    assert.equal(history.date, date);
    await assert.rejects(training.startSession(user.id, later, 330));
    const map = await getTrainingMap(user.id, date, 330, 'en');
    assert.equal(map.summary.loggedSets, 1);
    assert.equal(await prisma.userWorkoutItem.count({ where: { id: { in: scheduleIds } } }), 2);
    const bodyweight = await prisma.workout.findFirstOrThrow({where:{catalogStatus:{notIn:['STAGED','ARCHIVED']},coachingMetadata:{path:['exerciseType'],equals:'bodyweight_reps'}}});
    const bwRoutine = await training.saveRoutine(other.id,{name:'Bodyweight fixture',items:[{...first,workoutId:bodyweight.id}]});
    await training.applyRoutine(other.id,date,bwRoutine.id);
    await training.startSession(other.id,date,330);
    const bwDay=await training.getTrainingDay(other.id,date,'en');
    const bwItem=bwDay.items[0]!;
    await training.saveSessionSet(other.id,date,bwItem.id,{...set,weight:null});
    await training.completeItem(other.id,date,bwItem.id,[]);
    await training.finishSession(other.id,date);
    const bwFinished=await training.getTrainingDay(other.id,date,'en');
    assert.equal(bwFinished.summary.sets,1);
    assert.equal(bwFinished.summary.volume,0,'Bodyweight reps do not invent external load');
    await training.deleteRoutine(user.id, routine.id);
    console.log('Dated sessions, resume, idempotent/edit/delete sets, ownership, routines, finish guards, history and Body totals passed. Only isolated test accounts were used.');
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
    await training.invalidateTraining(user.id);
    await training.invalidateTraining(other.id);
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
