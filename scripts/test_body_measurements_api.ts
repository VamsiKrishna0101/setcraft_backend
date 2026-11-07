import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

async function main() {
  // These deliberately unusable service addresses ensure this test cannot touch
  // a developer database or Redis account. All persistence is replaced in memory.
  process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/body-test";
  process.env.UPSTASH_REDIS_REST_URL = "https://body-test.invalid";
  process.env.UPSTASH_REDIS_REST_TOKEN = "test-only";
  process.env.JWT_ACCESS_SECRET = "body-test-only-signing-secret";
  const { default: prisma } = await import("../config/prisma");
  const { default: redis } = await import("../config/redis");
  const { default: routes } = await import("../modules/body/body_routes");
  const { default: mapRoutes } =
    await import("../modules/heatmap/heatmap_routes");
  const { rateLimitStore } = await import("../middleware/rate_limit");

  const db = prisma as any;
  db.user.findUnique = async () => ({
    id: "member",
    email: "member@example.invalid",
    role: "USER",
    onboarding: { gender: "MALE" },
    trialStartedAt: null,
    trialEndsAt: null,
  });
  db.onboarding.findUnique = async () => ({
    height: 175,
    weight: 75,
    age: 30,
    gender: "MALE",
  });
  let saves = 0;
  db.$transaction = async (action: any) =>
    action({
      bodyAssessment: {
        create: async ({ data }: any) => {
          saves++;
          return {
            ...data,
            status: "SAVED",
            createdAt: new Date(),
            updatedAt: new Date(),
            photos: [],
          };
        },
      },
    });
  (redis as any).set = async () => "OK";
  rateLimitStore.consume = async () => ({
    allowed: true,
    retryAfterSeconds: 1,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/body", routes);
  app.use("/api/heatmap", mapRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/body`;
  const token = jwt.sign({ userId: "member" }, process.env.JWT_ACCESS_SECRET);
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  try {
    const mapBase = base.replace("/api/body", "/api/heatmap/body");
    assert.equal((await fetch(mapBase)).status, 401);
    assert.equal((await fetch(mapBase, { headers })).status, 400);
    assert.equal(
      (
        await fetch(mapBase + "?date=2026-02-31&utcOffsetMinutes=0", {
          headers,
        })
      ).status,
      400,
    );
    for (const filter of [
      "from=2026-10-30",
      "dates=2026-02-31",
      "dates=2026-10-30",
      "all=true&from=2026-10-01",
      "dates=2026-10-28&from=2026-10-01",
      "all=maybe",
    ]) {
      assert.equal(
        (
          await fetch(
            mapBase + "?date=2026-10-29&utcOffsetMinutes=0&" + filter,
            { headers },
          )
        ).status,
        400,
      );
    }
    assert.equal(
      (await fetch(base + "/reviews", { method: "POST" })).status,
      401,
    );
    for (const [path, method] of [
      ["/reviews", "POST"],
      ["/entries/id/focus", "POST"],
      ["/entries/id/readings", "PATCH"],
      ["/review-jobs/id", "GET"],
    ]) {
      const response = await fetch(base + path, { method, headers });
      assert.equal(response.status, 410);
      assert.equal(
        ((await response.json()) as any).code,
        "PHOTO_SCANS_REMOVED",
      );
    }
    const payload = {
      recordedDate: new Date().toISOString().slice(0, 10),
      utcOffsetMinutes: 0,
      metrics: {
        weightKg: { value: 75, source: "scale" },
        waistCm: { value: 86, source: "tape" },
      },
      requestCoaching: false,
    };
    const saved = await fetch(base + "/entries", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    assert.equal(saved.status, 201, await saved.clone().text());
    assert.equal(
      saves,
      1,
      "A member without a trial can save their required baseline",
    );
    const blocked = await fetch(base + "/entries", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, requestCoaching: true }),
    });
    assert.equal(blocked.status, 410);
    assert.equal(saves, 1);
    console.log(
      "Body API checks passed: authentication, retired scans and baseline saving before membership.",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
