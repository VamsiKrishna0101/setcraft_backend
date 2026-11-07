import "dotenv/config";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import heatmapRoutes from "../modules/heatmap/heatmap_routes";
import { calendarWindow } from "../modules/heatmap/training_map_engine";

// Read-only account audit: compare authenticated filtered responses with the
// saved set rows, without adding, editing or removing any member data.
async function main() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: "vklvl0101@gmail.com" }, select: { id: true },
  });
  const offset = 330;
  const today = new Date(Date.now() + offset * 60_000).toISOString().slice(0, 10);
  const rows = await prisma.workoutSetLog.findMany({
    where: { userId: user.id, workoutItem: { sourceProvider: "USER", userWorkout: { userId: user.id } } },
    select: { id: true, userWorkoutItemId: true, day: true, month: true, year: true,
      setNumber: true, reps: true, createdAt: true },
  });
  const unique = new Map<string, {date: string; createdAt: Date}>();
  for (const row of rows) {
    const recorded = `${row.year.padStart(4, "0")}-${row.month.padStart(2, "0")}-${row.day.padStart(2, "0")}`;
    const valid = Number.isFinite(Date.parse(recorded)) && new Date(recorded).toISOString().slice(0, 10) === recorded;
    const date = valid ? recorded : new Date(row.createdAt.getTime() + offset * 60_000).toISOString().slice(0, 10);
    if (!Number.isInteger(row.reps) || row.reps <= 0 || row.setNumber < 1) continue;
    const key = `${row.userWorkoutItemId}:${date}:${row.setNumber}`;
    if (!unique.has(key) || unique.get(key)!.createdAt <= row.createdAt) unique.set(key, {date, createdAt: row.createdAt});
  }
  const dates = [...new Set([...unique.values()].map(row => row.date))].filter(date => date <= today).sort();
  const sample = [...new Set([today, calendarWindow(today, offset).weekStart,
    ...dates.slice(0, 1), ...dates.slice(-2), "2000-01-01"])];
  const app = express();
  app.use("/api/heatmap", heatmapRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/heatmap/training`;
  const token = jwt.sign({userId: user.id}, process.env.JWT_ACCESS_SECRET!, {expiresIn: "5m"});
  try {
    assert.equal((await fetch(`${base}?date=${today}&utcOffsetMinutes=${offset}&period=month`, {
      headers: {authorization: `Bearer ${token}`},
    })).status, 400);
    for (const date of sample) {
      for (const period of ["day", "week"] as const) {
        const response = await fetch(`${base}?date=${date}&utcOffsetMinutes=${offset}&period=${period}`, {
          headers: {authorization: `Bearer ${token}`},
        });
        assert.equal(response.status, 200);
        const map = await response.json() as any;
        const start = period === "day" ? date : calendarWindow(date, offset).weekStart;
        const expected = [...unique.values()].filter(row => row.date >= start && row.date <= date);
        assert.equal(map.period, period);
        assert.equal(map.periodStart, start);
        assert.equal(map.summary.loggedSets, expected.length, `${date} ${period} saved set count`);
        assert.equal(map.summary.sessions, new Set(expected.map(row => row.date)).size);
        assert.equal(map.summary.trainedMuscles, map.regions.filter((region: any) => region.completedSets > 0).length);
        for (const region of map.regions) {
          if (region.strength.tier > 0) assert(region.completedSets > 0, "No historical colour on an untrained area");
          assert.equal(region.sessions.reduce((sum: number, session: any) => sum + session.sets, 0), region.completedSets);
          assert([...region.sessions, ...region.trend].every(point => point.date >= start && point.date <= date));
        }
        console.log(`${date} ${period}: ${expected.length} saved sets, ${map.summary.sessions} training days; filtered regions/history consistent.`);
      }
    }
    console.log("Read-only Body filter audit passed; no member records changed.");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
