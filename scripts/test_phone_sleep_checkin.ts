import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import redis from "../config/redis";
import wellnessRoutes from "../modules/wellness/wellness_routes";
import { getHomeData } from "../modules/home/home_service";
import { computeCheckInEstimate } from "../modules/wellness/checkin_estimate";
import { getRecoveryHistory } from '../modules/history/history_service';

async function main() {
  assert.equal(computeCheckInEstimate({sleepMinutes: 120, energy: 5, rested: 5, soreness: 1}), 33);
  assert.equal(computeCheckInEstimate({sleepMinutes: 300, energy: 5, rested: 5, soreness: 1}), 66);
  assert.equal(
    computeCheckInEstimate({
      sleepMinutes: 480,
      energy: 5,
      rested: 5,
      soreness: 1,
    }),
    100,
  );
  assert.equal(
    computeCheckInEstimate({
      sleepMinutes: 480,
      energy: 5,
      rested: null,
      soreness: 1,
    }),
    null,
  );
  assert.equal(
    computeCheckInEstimate({
      sleepMinutes: 0,
      energy: 1,
      rested: 1,
      soreness: 5,
    }),
    0,
  );
  const owner = await prisma.user.create({
    data: {
      email: `phone-sleep-${randomUUID()}@example.invalid`,
      password: "isolated-test",
      trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000),
    },
  });
  const other = await prisma.user.create({
    data: {
      email: `phone-sleep-${randomUUID()}@example.invalid`,
      password: "isolated-test",
      trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000),
    },
  });
  const app = express();
  app.use(express.json());
  app.use("/wellness", wellnessRoutes);
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(500).json({ error: error.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const end = new Date(Date.now() - 60000);
  const date = new Date(end.getTime() + 330 * 60000).toISOString().slice(0, 10);
  const start = new Date(end.getTime() - 60 * 60000);
  const body = {
    sleepMinutes: 480,
    energy: 3,
    rested: 3,
    soreness: 1,
    utcOffsetMinutes: 330,
  };
  const request = async (
    path: string,
    method = "GET",
    data?: unknown,
    userId = owner.id,
  ) => {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/wellness${path}`,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt.sign({ userId }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}`,
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      },
    );
    return { status: response.status, json: (await response.json()) as any };
  };
  try {
    assert.equal((await request("/wearable")).json.data.usage, "UNKNOWN");
    assert.equal((await request(`/check-in/${date}`, "PUT", body)).status, 200);
    const weekStart = new Date(`${date}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const pastDate = new Date(weekStart.getTime() - 86400000).toISOString().slice(0, 10);
    const historical = await prisma.dailyWellnessEntry.create({data: {
      userId: owner.id, date: pastDate, sleepMinutes: 360, energy: 2,
      rested: 2, soreness: 2, source: 'self_report',
    }});
    const denied = await request(`/check-in/${pastDate}`, 'PUT', {...body, sleepMinutes: 480});
    assert.equal(denied.status, 400);
    assert.equal(denied.json.error, 'Sleep entries from previous weeks are read-only.');
    const preserved = await prisma.dailyWellnessEntry.findUniqueOrThrow({
      where: {userId_date: {userId: owner.id, date: pastDate}},
    });
    assert.equal(preserved.sleepMinutes, 360);
    assert.equal(preserved.updatedAt.toISOString(), historical.updatedAt.toISOString());
    assert.equal((await request(`/check-in/${pastDate}`)).json.data.sleepMinutes, 360);
    assert.equal((await request(`/check-in/${pastDate}`, 'GET', undefined, other.id)).json.data, null);
    const pastHistory: Array<{date: string; sleepHours: number | null}> =
      await getRecoveryHistory(owner.id, {days: 14, date: pastDate});
    assert(pastHistory.every(row => row.date <= pastDate));
    assert.equal(pastHistory.find(row => row.date === pastDate)?.sleepHours, 6);
    assert(!pastHistory.some(row => row.date === date));
    assert.equal(
      (await request("/wearable", "PUT", { usage: "NONE" })).status,
      200,
    );
    assert.equal(
      (await request("/wearable", "PUT", { usage: "NO_DATA" })).status,
      400,
    );
    assert.equal((await request(`/check-in/${date}`, "PUT", body)).status, 200);
    const home = await getHomeData(owner.id, true, date);
    assert.equal(home.readiness?.source, "check_in_estimate");
    assert.equal(home.readiness?.score, 8);
    assert.equal(home.readiness?.hrvMs, undefined);
    assert.equal(home.readiness?.restingHrBpm, undefined);
    assert.equal(home.healthMetrics, null);
    assert.equal(
      (
        await getHomeData(
          owner.id,
          true,
          new Date(start.getTime() - 86400000).toISOString().slice(0, 10),
        )
      ).readiness,
      null,
    );
    assert.equal(
      (await request(`/check-in/${date}`, "GET", undefined, other.id)).json
        .data,
      null,
    );
    assert.equal(
      (await request("/wearable", "GET", undefined, other.id)).json.data.usage,
      "UNKNOWN",
    );
    const estimate = {
      ...body,
      sleepMinutes: 60,
      source: "phone_estimate_confirmed",
      sleepStartedAt: start.toISOString(),
      sleepEndedAt: end.toISOString(),
    };
    assert.equal(
      (
        await request(`/check-in/${date}`, "PUT", {
          ...estimate,
          sleepMinutes: 80,
        })
      ).status,
      400,
    );
    assert.equal(
      (await request(`/check-in/${date}`, "PUT", estimate)).status,
      200,
    );
    assert.equal(
      (await request(`/check-in/${date}`)).json.data.source,
      "phone_estimate_confirmed",
    );
    await request("/wearable", "PUT", { usage: "WEARABLE" });
    assert.equal((await getHomeData(owner.id, false, date)).readiness?.source, 'check_in_estimate');
    assert.equal(
      (await request(`/check-in/${date}`, "PUT", estimate)).status,
      400,
    );
    // Old manual sleep logging continues to work for wearable users, without
    // silently creating the no-wearable fallback.
    assert.equal(
      (await request(`/check-in/${date}`, "PUT", { sleepMinutes: 300 })).status,
      200,
    );
    assert.equal((await getHomeData(owner.id, true, date)).readiness, null);
    // Entered sleep + real same-day heart readings produce a labelled estimate,
    // while the stored device sleep remains missing.
    await prisma.healthKitSnapshot.create({ data: {
      userId: owner.id, date, sourceProvider: 'GOOGLE_HEALTH_CONNECT', restingHR: 60,
    } });
    const mixedSave = await request(`/check-in/${date}`, 'PUT', { sleepMinutes: 420 });
    assert.equal(mixedSave.json.data.sleepMinutes, 420);
    assert.equal(mixedSave.json.data.readiness, null);
    const mixedHome = await getHomeData(owner.id, true, date);
    assert.deepEqual(mixedHome.readiness, mixedSave.json.data.readiness);
    assert.equal(mixedHome.healthMetrics?.sleepMinutes, null);
    assert.equal(mixedHome.sleepLog?.sleepMinutes, 420);
    assert.equal(mixedHome.readiness, null);
    assert(mixedHome.sleepLog?.updatedAt);
    await prisma.healthKitSnapshot.deleteMany({ where: { userId: owner.id, date } });
    await request("/wearable", "PUT", { usage: "NONE" });
    await request(`/check-in/${date}`, "PUT", body);
    await prisma.healthKitSnapshot.create({
      data: {
        userId: owner.id,
        date,
        sourceProvider: "GOOGLE_HEALTH_CONNECT",
        sleepTotalMinutes: 480,
        hrv: 50,
        hrvMethod: "RMSSD",
        restingHR: 60,
      },
    });
    assert.equal(
      (await getHomeData(owner.id, true, date)).readiness?.source,
      "check_in_estimate",
    );
    assert.equal(
      await prisma.healthKitSnapshot.count({ where: { userId: other.id } }),
      0,
    );
    // A cache outage must not hold an already committed save open.
    const cache = redis as unknown as {
      set: (...args: unknown[]) => Promise<unknown>;
      keys: (...args: unknown[]) => Promise<unknown>;
    };
    const originalSet = cache.set;
    const originalKeys = cache.keys;
    cache.set = () => new Promise(() => {});
    cache.keys = () => new Promise(() => {});
    try {
      const started = Date.now();
      assert.equal(
        (await request("/wearable", "PUT", { usage: "NONE" })).status,
        200,
      );
      assert.equal(
        (await request(`/check-in/${date}`, "PUT", body)).status,
        200,
      );
      assert(
        Date.now() - started < 6000,
        "Cache cleanup blocked committed wellness saves",
      );
      assert.equal(
        (
          await prisma.dailyWellnessEntry.findUniqueOrThrow({
            where: { userId_date: { userId: owner.id, date } },
          })
        ).sleepMinutes,
        body.sleepMinutes,
      );
    } finally {
      cache.set = originalSet;
      cache.keys = originalKeys;
    }
    console.log(
      "Check-in integration passed: current-week editing, read-only historical sleep, source/date/account isolation, sleep-only saves and preserved device history.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await prisma.user.deleteMany({
      where: { id: { in: [owner.id, other.id] } },
    });
    await redis
      .del(
        `home:${owner.id}`,
        `home:${other.id}`,
        `progress-revision:${owner.id}`,
        `progress-revision:${other.id}`,
      )
      .catch(() => undefined);
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
