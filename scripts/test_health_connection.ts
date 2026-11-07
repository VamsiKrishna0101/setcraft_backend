import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import redis from '../config/redis';
import healthRoutes from '../modules/healthkit/healthkit_routes';
import { syncHealthKit, computeRecoveryScore, getImportedWorkouts } from '../modules/healthkit/healthkit_service';
import { HealthkitInputSchema } from '../modules/healthkit/healthkit_types';
import { getHomeData } from '../modules/home/home_service';
import { getWellnessProgress } from '../modules/progress/wellness/wellness_service';
import { getBodyOverview } from '../modules/body/body_service';

async function main() {
  const user = await prisma.user.create({ data: { email: `health-test-${randomUUID()}@example.invalid`, password: 'isolated-test' } });
  const other = await prisma.user.create({ data: { email: `health-other-${randomUUID()}@example.invalid`, password: 'isolated-test' } });
  const date = new Date().toISOString().slice(0, 10);
  const app = express();
  app.use(express.json());
  app.use('/api/healthkit', healthRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    assert.equal(computeRecoveryScore({ steps: 100 } as any), null);
    assert.equal(computeRecoveryScore({ hrv: 64 }), null);
    assert.equal(computeRecoveryScore({ sleepTotalMinutes: 420 }), null);
    assert.equal(computeRecoveryScore({ sleepTotalMinutes: 420, restingHR: 0, hrv: 0 }), null);
    assert.notEqual(computeRecoveryScore({ sleepTotalMinutes: 420, restingHR: 58 }), null);
    assert.equal(HealthkitInputSchema.safeParse({ date: '2026-02-30' }).success, false);
    const movement = await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT',
      steps: 0, activeCalories: 0, utcOffsetMinutes: 330,
      metricMetadata: { steps: { source: 'Health Connect', measuredAt: new Date().toISOString(), method: 'platform_aggregate' } } });
    assert.equal(movement.recoveryScore, null);
    const home = await getHomeData(user.id, true, date);
    assert.equal(home.readiness, null);
    assert.equal(home.healthMetrics?.steps, 0, 'A recorded zero is distinct from missing steps.');
    assert.equal(home.healthMetrics?.restingHR, null);
    const workout = { externalId: 'GOOGLE_HEALTH_CONNECT:watch:stable-record', workoutType: 'RUNNING',
      durationMinutes: 30, source: 'GOOGLE_HEALTH_CONNECT',
      startedAt: new Date(`${date}T05:00:00Z`), endedAt: new Date(`${date}T05:30:00Z`) };
    const old = await prisma.healthKitWorkout.create({ data: { userId: user.id, ...workout,
      externalId: `old-${randomUUID()}`, activeCalories: 120 } });
    const sync = await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT',
      sleepTotalMinutes: 450, restingHR: 57, hrv: 51, hrvMethod: 'RMSSD', weight: 81.4, bodyFatPct: 19.2,
      externalWorkouts: [{ ...workout, activeCalories: 210 }],
      metricMetadata: { weight: { source: 'Scale', measuredAt: new Date().toISOString() } } });
    assert.notEqual(sync.recoveryScore, null);
    assert.match(sync.aiNote!, /estimate/);
    const readyHome = await getHomeData(user.id, true, date);
    assert.equal(readyHome.readiness?.score, sync.recoveryScore! / 10, 'Home uses the documented 0–10 score scale');
    assert.equal(readyHome.readiness?.label, 'Good to Go', 'A score below 80 is not labelled optimal');
    assert.equal(readyHome.readiness?.source, 'health_connect');
    // An older missing derived score must not hide available measured inputs.
    await prisma.healthKitSnapshot.update({ where: { userId_date: { userId: user.id, date } }, data: { recoveryScore: null } });
    assert.equal((await getHomeData(user.id, true, date)).readiness?.score, sync.recoveryScore! / 10);
    assert.equal((await getHomeData(user.id, true, '2026-01-01')).readiness, null, 'Other dates do not borrow today’s readings');
    await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', externalWorkouts: [{ ...workout, activeCalories: 225 }] });
    assert.equal(await prisma.healthKitWorkout.count({ where: { userId: user.id } }), 1);
    assert.equal((await prisma.healthKitWorkout.findUniqueOrThrow({ where: { id: old.id } })).activeCalories, 225);
    assert.equal((await getImportedWorkouts(user.id, date)).length, 1);
    assert.equal((await getImportedWorkouts(other.id, date)).length, 0);
    assert.equal(await prisma.workoutSetLog.count({ where: { userId: user.id } }), 0, 'Imported sessions do not invent FitAI sets.');
    const body = await getBodyOverview(user.id);
    assert.equal(body.records.length, 0);
    assert.equal(body.syncedMeasurements[0]?.weight, 81.4);
    const progress = await getWellnessProgress(user.id, { date, period: '4w', dataset: 'real', utcOffsetMinutes: 330 });
    const recovery = progress.recovery.at(-1);
    assert.ok(recovery && 'steps' in recovery && 'hrvMethod' in recovery);
    assert.equal(recovery.steps, 0);
    assert.equal(recovery.hrvMethod, 'RMSSD');
    await syncHealthKit(other.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', externalWorkouts: [workout] });
    assert.equal(await prisma.healthKitWorkout.count({ where: { userId: other.id } }), 1, 'Record IDs are scoped to the account.');
    const switched = await syncHealthKit(user.id, { date, sourceProvider: 'APPLE_HEALTHKIT', steps: 72, hrv: 38, hrvMethod: 'SDNN' });
    assert.equal(switched.snapshot.sleepTotalMinutes, null);
    assert.equal(switched.snapshot.restingHR, null);
    assert.equal(switched.snapshot.weight, null);
    assert.equal(switched.recoveryScore, null);
    assert.deepEqual(switched.snapshot.metricMetadata, {}, 'Changing provider cannot inherit another source’s measurement metadata.');
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/healthkit`;
    assert.equal((await fetch(`${base}/workouts?date=${date}`)).status, 401);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' });
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal((await fetch(`${base}/workouts?date=2026-02-30`, { headers })).status, 400);
    const saved = await fetch(`${base}/workouts?date=${date}`, { headers });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json() as any).data.length, 1);
    console.log('Health checks passed: optional categories, real zero vs missing, readiness minimum, provenance, source changes, workout updates, account isolation, Body and Progress.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const fixture of [user, other]) {
      const keys = await redis.keys(`*${fixture.id}*`).catch(() => []);
      if (keys.length) await redis.del(...keys).catch(() => undefined);
      await prisma.user.delete({ where: { id: fixture.id } });
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
