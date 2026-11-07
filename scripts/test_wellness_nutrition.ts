import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import redis from '../config/redis';
import wellnessRoutes from '../modules/wellness/wellness_routes';
import nutritionRoutes from '../modules/nutrition/nutrition_routes';
import previewRoutes from '../modules/preview/preview_routes';
import { getHomeData } from '../modules/home/home_service';
import { getWellnessProgress } from '../modules/progress/wellness/wellness_service';
import { shiftDate } from '../modules/progress/progress_range';

async function read(response: Awaited<ReturnType<typeof fetch>>): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

async function main() {
  const owner = await prisma.user.create({ data: { email: `wellness-${randomUUID()}@example.invalid`, password: 'isolated-test' } });
  const other = await prisma.user.create({ data: { email: `wellness-${randomUUID()}@example.invalid`, password: 'isolated-test' } });
  const app = express();
  app.use(express.json());
  app.use('/wellness', wellnessRoutes);
  app.use('/nutrition', nutritionRoutes);
  app.use('/preview', previewRoutes);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const date = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
  const headers = (id: string) => ({ 'Content-Type': 'application/json', authorization: `Bearer ${jwt.sign({ userId: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: '5m' })}` });
  const request = (url: string, method = 'GET', body?: unknown, user = owner.id) =>
    fetch(`${base}${url}`, { method, headers: headers(user), ...(body ? { body: JSON.stringify(body) } : {}) });
  const query = { period: '4w' as const, date, utcOffsetMinutes: 330 };
  try {
    assert.equal((await fetch(`${base}/wellness/check-in/${date}`)).status, 401);
    await getHomeData(owner.id, true, date);
    const saved = await request(`/wellness/check-in/${date}`, 'PUT', { sleepMinutes: 455, energy: 3, utcOffsetMinutes: 330 });
    assert.equal(saved.status, 200);
    assert.equal((await read(saved)).data.source, 'self_report');
    assert.equal((await getHomeData(owner.id, false, date)).sleepLog?.sleepMinutes, 455);
    const progress = await getWellnessProgress(owner.id, query);
    assert.equal(progress.recovery[0]?.sleep, 7.6);
    assert.equal(progress.recovery[0]?.recovery, null);
    assert.equal(progress.recovery[0]?.hrv, null);
    assert.equal((await read(await request(`/wellness/check-in/${date}`, 'GET', undefined, other.id))).data, null);
    for (const invalid of [1441, -1, 30.5]) {
      assert.equal((await request(`/wellness/check-in/${date}`, 'PUT', { sleepMinutes: invalid })).status, 400);
    }
    assert.equal((await request('/wellness/check-in/2026-02-30', 'PUT', { sleepMinutes: 400 })).status, 400);
    assert.equal((await request(`/wellness/check-in/${shiftDate(date, 1)}`, 'PUT', { sleepMinutes: 400, utcOffsetMinutes: 330 })).status, 400);
    await request(`/wellness/check-in/${date}`, 'PUT', { sleepMinutes: 0 });
    assert.equal((await getWellnessProgress(owner.id, query)).recovery[0]?.sleep, 0);
    assert.equal((await getHomeData(owner.id, false, date)).readiness, null);

    const parts = { day: date.slice(8), month: date.slice(5, 7), year: date.slice(0, 4) };
    const meal = (calories: number, servings = 1) => ({ ...parts, mealType: 'LUNCH', servings,
      customFood: { name: 'Same named food', servingSize: 100, servingUnit: 'g', calories, protein: 10, carbs: 20, fat: 3 } });
    const first = await request('/nutrition/me/log', 'POST', meal(120, 1.5));
    const firstJson = await read(first);
    assert.equal(first.status, 201, JSON.stringify(firstJson));
    const a = firstJson.data;
    assert.equal(a.calories, 180);
    const second = await request('/nutrition/me/log', 'POST', meal(240));
    assert.equal(second.status, 201);
    const b = (await read(second)).data;
    assert.equal(b.calories, 240);
    assert.notEqual(a.nutritionId, b.nutritionId);
    const totals = async () => (await read(await request(`/nutrition/me/${Number(parts.day)}/${Number(parts.month)}/${parts.year}`))).data;
    assert.equal((await totals()).dailySummary.totalCalories, 420);
    await request(`/nutrition/me/log/${b.id}/status`, 'PATCH', { status: 'SKIPPED' });
    assert.equal((await totals()).dailySummary.totalCalories, 180);
    assert.equal((await getHomeData(owner.id, false, date)).nutrition.calories.consumed, 180);
    assert.equal((await request('/nutrition/me/log', 'POST', { ...parts, mealType: 'LUNCH', nutritionId: a.nutritionId }, other.id)).status, 400);
    assert.equal((await request('/nutrition/me/log', 'POST', { ...meal(120), day: '31', month: '02' })).status, 400);
    await request('/nutrition/water', 'POST', { ...parts, amountMl: 250 });
    assert.equal((await totals()).waterConsumed, 250);
    assert.equal((await getHomeData(owner.id, false, date)).nutrition.water.consumed, 250);
    await request(`/nutrition/me/log/${a.id}`, 'DELETE');
    assert.equal((await totals()).dailySummary.totalCalories, 0);

    const seeded = await prisma.user.findUniqueOrThrow({ where: { email: 'vklvl0101@gmail.com' } });
    // Demo fixtures have recorded dates and rest days. Do not assume today's
    // date has a demo workout after the fixture window has moved into the past.
    const previewDays = await prisma.progressPreviewDay.findMany({ where: { userId: seeded.id }, orderBy: { date: 'desc' } });
    const trainingDay = previewDays.find(row => Array.isArray((row.data as any).sets) && (row.data as any).sets.length > 0);
    assert(trainingDay, 'A recorded preview training day is required');
    const previewDate = trainingDay.date;
    assert.equal((await read(await request('/preview/status', 'GET', undefined, other.id))).data.available, false);
    assert.equal((await request(`/preview/body?date=${date}`, 'GET', undefined, other.id)).status, 404);
    for (const path of ['home', 'body', 'heatmap/training', 'workout/training', 'nutrition/me', 'history/recovery']) {
      const response = await request(`/preview/${path}?date=${previewDate}&utcOffsetMinutes=330`, 'GET', undefined, seeded.id);
      assert.equal(response.status, 200, path);
      const json = await read(response);
      if (path === 'body') {
        assert(json.records.length >= 10);
        assert.equal(json.records[0].quality.bodyRegions.length, 13);
        assert.equal(json.records[0].photos.length, 0);
      }
      if (path === 'workout/training') assert(json.data.items.length > 0);
      if (path === 'nutrition/me') assert.equal(json.data.logs.length, 3);
      if (path === 'heatmap/training') assert(json.summary.loggedSets > 0);
    }
    const restDay = previewDays.find(row => !(row.data as any).session);
    if (restDay) {
      const response = await request(`/preview/workout/training?date=${restDay.date}`, 'GET', undefined, seeded.id);
      const data = (await read(response)).data;
      assert.equal(data.restDay, true);
      assert.equal(data.items.length, 0);
    }
    assert.equal((await request('/preview/body/entries', 'POST', {}, seeded.id)).status, 409);
    console.log('Passed manual sleep, ownership, truthful missing metrics, meal portions, nutrition/water cache refresh and all-tab preview checks.');
  } finally {
    server.close();
    for (const user of [owner, other]) {
      const keys = await redis.keys(`*${user.id}*`).catch(() => []);
      if (keys.length) await redis.del(...keys).catch(() => undefined);
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
