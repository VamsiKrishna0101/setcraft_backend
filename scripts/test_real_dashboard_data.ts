import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import prisma from '../config/prisma';
import redis from '../config/redis';
import { getHomeData, calcTargets, calcReadinessScore } from '../modules/home/home_service';
import { getRecoveryHistory, getNutritionHistory, getBodyHistory } from '../modules/history/history_service';
import { getSnapshot, syncHealthKit, computeRecoveryScore } from '../modules/healthkit/healthkit_service';
import { getUserNutritionItems, getDailyWater } from '../modules/nutrition/nutrition_service';
import { HealthkitInputSchema } from '../modules/healthkit/healthkit_types';
import { getPlanForDate } from '../modules/workout/session/session_service';
import { realCoachingNote } from '../utils/real_data';
import express from 'express';
import jwt from 'jsonwebtoken';
import { authenticate } from '../middleware/auth';
import homeRoutes from '../modules/home/home_routes';

async function main() {
  const user = await prisma.user.create({ data: { email: `real-data-test-${randomUUID()}@example.invalid`, password: 'isolated-fixture' } });
  const now = new Date();
  const day = String(now.getDate()), month = String(now.getMonth() + 1), year = String(now.getFullYear());
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const dateWhere = { userId: user.id, day, month, year };
  const app = express();
  app.get('/owner', authenticate, (req, res) => res.json({ id: req.user!.userId }));
  app.use('/api/home', homeRoutes);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const url = `http://127.0.0.1:${address.port}/owner`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' });
    const ownerResponse = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal((await ownerResponse.json() as { id: string }).id, user.id);
    assert.equal(computeRecoveryScore({}), null);
    assert.equal(calcReadinessScore('', ''), null);
    assert.equal(calcReadinessScore('HOURS_7_TO_8', 'GOOD'), 8);
    const oldPreviewNote = 'Target Effort: 8.5/10 — Full recovery detected. Prime window for hypertrophy.';
    assert.equal(realCoachingNote(oldPreviewNote), null);
    await prisma.userWorkout.create({ data: { userId: user.id, weekLabel: 'Week 4 Hypertrophy', aiNote: oldPreviewNote } });
    assert.equal(await getPlanForDate(user.id, date), null, 'Old automatic templates are not genuine schedules.');
    assert.equal(HealthkitInputSchema.safeParse({ date, sourceProvider: 'FITAI_PREVIEW' }).success, false);
    const targets = calcTargets({ weight: 80, height: 178, age: 27, gender: 'MALE', activityLevel: 'MODERATE', workingToward: 'BUILD_MUSCLE' });
    assert.equal(targets.targetProtein, 160);
    assert.notEqual(targets.targetCalories, 2400);
    await prisma.healthKitSnapshot.create({ data: { userId: user.id, date, sourceProvider: 'FITAI_PREVIEW', recoveryScore: 84,
      hrv: 68, restingHR: 54, steps: 6840, sleepTotalMinutes: 462, weight: 80 } });
    const previewFood = await prisma.nutrition.create({ data: { userId: user.id, name: `Today preview · ${date} · Breakfast bowl`,
      category: 'PROTEIN_SOURCE', servingSize: 1, servingUnit: 'portion', caloriesPerServing: 540, proteinPerServing: 34, carbsPerServing: 75, fatPerServing: 12, mealTypes: ['BREAKFAST'] } });
    await prisma.userMealLog.create({ data: { ...dateWhere, nutritionId: previewFood.id, mealType: 'BREAKFAST', calories: 540, protein: 34, carbs: 75, fat: 12 } });
    await prisma.userWaterLog.create({ data: { ...dateWhere, amountMl: 1450, sourceProvider: 'FITAI_PREVIEW' } });
    await redis.set(`home:${user.id}`, { readiness: { source: 'sample', score: 8.4 } });
    const empty = await getHomeData(user.id);
    assert.equal(empty.readiness, null);
    assert.equal(empty.nutrition.calories.consumed, 0);
    assert.equal(empty.nutrition.water.consumed, 0);
    assert.equal(empty.user.streakDays, 0);
    assert.equal((await getRecoveryHistory(user.id, { days: 7 })).length, 0);
    assert.equal((await getBodyHistory(user.id, { days: 7 })).length, 0);
    assert.equal((await getNutritionHistory(user.id, { days: 7 })).length, 0);
    assert.equal(await getSnapshot(user.id, date), null);
    const nutrition = await getUserNutritionItems(user.id, day, month, year);
    assert.equal(nutrition.logs.length, 0);
    assert.equal(nutrition.targets.calories, 0);
    assert.equal(nutrition.waterConsumed, 0);
    assert.equal((await getDailyWater(user.id, day, month, year)).totalMl, 0);
    const stepsOnly = await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', steps: 128 });
    assert.equal(stepsOnly.recoveryScore, null);
    assert.equal(stepsOnly.snapshot.hrv, null, 'A genuine sync cannot inherit preview measurements.');
    assert.equal(stepsOnly.snapshot.restingHR, null);
    const movementHome = await getHomeData(user.id, true);
    assert.equal(movementHome.readiness, null);
    assert.equal(movementHome.healthMetrics?.steps, 128, 'Steps must be visible independently of readiness.');
    const heartOnly = await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', hrv: 80, hrvMethod: 'RMSSD' });
    assert.equal(heartOnly.recoveryScore, null, 'One biometric cannot establish readiness.');
    const genuine = await syncHealthKit(user.id, { date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', sleepTotalMinutes: 432 });
    assert.notEqual(genuine.recoveryScore, null);
    const home = await getHomeData(user.id, true);
    assert.equal(home.readiness?.hrvMs, 80);
    assert.equal(home.readiness?.steps, 128);
    assert.equal(home.readiness?.source, 'health_connect');
    const yesterday = new Date(`${date}T12:00:00Z`);
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const past = yesterday.toISOString().slice(0, 10);
    const pastHome = await getHomeData(user.id, true, past);
    assert.equal(pastHome.calendarDate, past);
    assert.equal(pastHome.readiness, null, 'Today’s health snapshot must never fill a different day.');
    assert.equal(pastHome.nutrition.calories.consumed, 0);
    assert.equal(pastHome.nutrition.water.consumed, 0);
    assert.equal((await getHomeData(user.id, false, date)).readiness?.hrvMs, 80, 'Date changes cannot reuse another day’s cache.');
    const [pastYear, pastMonth, pastDay] = past.split('-');
    await prisma.readiness.create({ data: { userId: user.id, year: pastYear!, month: pastMonth!, day: pastDay!,
      sleep: 'HOURS_6_TO_7', recovery: 'GOOD', aiTarget: '' } });
    await prisma.dailyWellnessEntry.create({ data: { userId: user.id, date: past, sleepMinutes: 360 } });
    await prisma.userWaterLog.create({ data: { userId: user.id, year: pastYear!, month: pastMonth!, day: pastDay!, amountMl: 600, sourceProvider: 'USER' } });
    const exercise = await prisma.workout.findFirstOrThrow({ select: { id: true } });
    const pastWeekday = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][yesterday.getUTCDay()] as any;
    await prisma.userWorkout.create({ data: { userId: user.id, weekLabel: 'Custom Plan', items: {
      create: { workoutId: exercise.id, dayOfWeek: pastWeekday, sourceProvider: 'USER' } } } });
    const filtered = await fetch(`http://127.0.0.1:${address.port}/api/home?date=${past}&refresh=true`, {
      headers: { Authorization: `Bearer ${token}` } });
    assert.equal(filtered.status, 200);
    const dated = await filtered.json() as any;
    assert.equal(dated.calendarDate, past);
    assert.equal(dated.readiness.date, past);
    assert.equal(dated.readiness.score, 6.5);
    assert.equal(dated.sleepLog.sleepMinutes, 360);
    assert.equal(dated.nutrition.water.consumed, 600);
    assert.equal(dated.todayWorkout, null, 'A schedule created today cannot fill yesterday’s workout.');
    assert.equal((await getRecoveryHistory(user.id, { days: 7 })).length, 2, 'Recovery history includes both recorded dates.');
    assert.equal(await prisma.userMealLog.count({ where: { userId: user.id } }), 1, 'Filters preserve the original records.');
    console.log('Real dashboard checks passed: preview exclusion, cache upgrade, empty readiness, personalized targets, genuine sync without inherited samples.');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    const cacheKeys = await redis.keys(`*${user.id}*`).catch(() => []);
    if (cacheKeys.length) await redis.del(...cacheKeys);
    await prisma.userMealLog.deleteMany({ where: { userId: user.id } });
    await prisma.nutrition.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
