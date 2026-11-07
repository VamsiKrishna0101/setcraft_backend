import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import express, { Request } from "express";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import redis, { rateLimitRedis } from "../config/redis";
import authRoutes from "../modules/auth/auth_routes";
import {
  consumeRateLimit,
  rateLimit,
  rateLimitBuckets,
  rateLimitIp,
  rateLimitStore,
  trustedProxies,
} from "../middleware/rate_limit";

async function testRedis() {
  const prefix = `fitai:{rate-limit}:test:${randomUUID()}`;
  const first = { key: prefix + ":first", limit: 3, seconds: 10 };
  const second = { key: prefix + ":second", limit: 20, seconds: 10 };
  const short = { key: prefix + ":short", limit: 1, seconds: 1 };

  try {
    const results = await Promise.all(
      Array.from({ length: 20 }, () => consumeRateLimit([first, second])),
    );

    assert.equal(results.filter((result) => result.allowed).length, 3);
    assert.equal(Number(await rateLimitRedis.get(first.key)), 3);
    assert.equal(Number(await rateLimitRedis.get(second.key)), 3);

    // A full bucket must not consume another allowance or move its expiry.
    const before = await rateLimitRedis.pttl(first.key);
    assert.equal((await consumeRateLimit([first, second])).allowed, false);
    assert.ok((await rateLimitRedis.pttl(first.key)) <= before);
    assert.equal(Number(await rateLimitRedis.get(second.key)), 3);

    assert.equal((await consumeRateLimit([short])).allowed, true);
    const blocked = await consumeRateLimit([short]);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await consumeRateLimit([short])).allowed, true);

    console.log(
      "Redis: atomic concurrent limits, multi-bucket denial and expiry passed.",
    );
  } finally {
    // Only this test's random keys, never users' counters or application data.
    await rateLimitRedis.del(first.key, second.key, short.key);
  }
}

async function testHttp() {
  const originalStore = rateLimitStore.consume;
  const originalFind = prisma.user.findUnique;
  const originalGet = redis.get;
  const seen: string[] = [];
  let calls = 0;
  let fail = false;
  let block = false;

  const app = express();
  app.set("trust proxy", trustedProxies(""));
  app.use(express.json());
  app.post("/login", rateLimit("login"), (_req, res) => {
    calls++;
    res.json({ ok: true });
  });
  app.post("/second-server", rateLimit("login"), (_req, res) => {
    calls++;
    res.json({ ok: true });
  });
  app.post("/browse", rateLimit("edge"), (_req, res) => res.sendStatus(200));
  app.post("/scan", rateLimit("photoScan"), (_req, res) => res.sendStatus(200));
  app.options("/login", rateLimit("login"), (_req, res) => res.sendStatus(204));
  app.use("/auth", authRoutes);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));

  const counts = new Map<string, number>();
  rateLimitStore.consume = async (buckets) => {
    if (fail) throw new Error("Simulated outage");
    seen.push(...buckets.map((bucket) => bucket.key));
    if (
      block ||
      buckets.some((bucket) => (counts.get(bucket.key) ?? 0) >= bucket.limit)
    ) {
      return { allowed: false, retryAfterSeconds: 42 };
    }
    for (const bucket of buckets)
      counts.set(bucket.key, (counts.get(bucket.key) ?? 0) + 1);
    return { allowed: true, retryAfterSeconds: 0 };
  };

  // Authentication and ownership checks use isolated fixtures; no account edits.
  prisma.user.findUnique = (async () => ({
    id: "rate-limit-test-owner",
    email: "fixture@example.invalid",
    role: "USER",
  })) as unknown as typeof prisma.user.findUnique;
  redis.get = (async (key) =>
    key === "user:rate-limit-test-owner"
      ? { id: "rate-limit-test-owner", email: "fixture@example.invalid" }
      : null) as typeof redis.get;

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  async function post(
    path: string,
    email = "Fixture@Example.invalid",
    headers = {},
  ) {
    return fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ email }),
    });
  }

  try {
    for (let index = 0; index < 5; index++) {
      assert.equal((await post("/login")).status, 200);
    }

    // A second middleware instance sees the same budget. Spoofed forwarding
    // headers and a differently cased email cannot manufacture a new identity.
    const limited = await post("/second-server", " fixture@example.invalid ", {
      "X-Forwarded-For": "203.0.113.50",
      "Accept-Language": "de-CH",
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "42");
    assert.equal(limited.headers.get("cache-control"), "no-store");
    const result = (await limited.json()) as Record<string, unknown>;
    assert.equal(result.code, "RATE_LIMITED");
    assert.equal(result.retryAfterSeconds, 42);
    assert.equal(result.error, "Bitte versuche es in 42 Sekunden erneut.");
    assert.equal(calls, 5);
    assert.equal(
      new Set(seen.filter((key) => key.includes(":email:"))).size,
      1,
    );
    assert.equal(new Set(seen.filter((key) => key.includes(":ip:"))).size, 1);
    assert.ok(seen.every((key) => !key.includes("example.invalid")));

    fail = true;
    const unavailable = await post("/login");
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "30");
    assert.equal(
      ((await unavailable.json()) as Record<string, unknown>).code,
      "RATE_LIMIT_UNAVAILABLE",
    );
    assert.equal((await post("/browse")).status, 200);
    assert.equal((await post("/scan")).status, 401);
    assert.equal(
      (await fetch(base + "/login", { method: "OPTIONS" })).status,
      204,
    );

    fail = false;
    block = false;
    counts.clear();
    assert.equal(
      (await fetch(base + "/auth/user/rate-limit-test-owner")).status,
      401,
    );
    const token = jwt.sign(
      { userId: "rate-limit-test-owner" },
      process.env.JWT_ACCESS_SECRET!,
      { expiresIn: "5m" },
    );
    const headers = { Authorization: `Bearer ${token}` };
    assert.equal(
      (await fetch(base + "/auth/user/someone-else", { headers })).status,
      403,
    );
    const ownProfile = await fetch(base + "/auth/user/rate-limit-test-owner", {
      headers,
    });
    assert.equal(ownProfile.status, 200);
    assert.equal(
      ((await ownProfile.json()) as Record<string, unknown>).id,
      "rate-limit-test-owner",
    );

    const proxyHeaders = { "X-Forwarded-For": "203.0.113.99, 198.51.100.7" };
    const direct = await fetch(base + "/ip", { headers: proxyHeaders });
    assert.equal(
      ((await direct.json()) as Record<string, unknown>).ip,
      "127.0.0.1",
    );
    app.set("trust proxy", trustedProxies("127.0.0.1/32"));
    const forwarded = await fetch(base + "/ip", { headers: proxyHeaders });
    assert.equal(
      ((await forwarded.json()) as Record<string, unknown>).ip,
      "198.51.100.7",
    );
    app.set("trust proxy", trustedProxies(""));

    block = true;
    for (const route of [
      "send-otp",
      "verify-otp",
      "register",
      "login",
      "refresh",
    ]) {
      // Limits run before validation, email delivery, bcrypt or token renewal.
      assert.equal((await post("/auth/" + route)).status, 429);
    }
    assert.equal(
      (await fetch(base + "/auth/user/rate-limit-test-owner", { headers }))
        .status,
      429,
    );
    console.log(
      "HTTP: shared identities, localization, outages and private-profile access passed.",
    );
  } finally {
    rateLimitStore.consume = originalStore;
    prisma.user.findUnique = originalFind;
    redis.get = originalGet;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function testIdentities() {
  assert.equal(rateLimitIp("::ffff:192.0.2.1"), rateLimitIp("192.0.2.1"));
  assert.equal(
    rateLimitIp("2001:db8:1234:5678::1"),
    rateLimitIp("2001:db8:1234:5678::99"),
  );
  assert.notEqual(
    rateLimitIp("2001:db8:1234:5678::1"),
    rateLimitIp("2001:db8:1234:5679::1"),
  );
  assert.deepEqual(trustedProxies("127.0.0.1, ::1/128"), [
    "127.0.0.1",
    "::1/128",
  ]);
  for (const value of ["true", "1", "0.0.0.0/0", "::/0", "not-an-address"]) {
    assert.throws(() => trustedProxies(value));
  }
  const req = {
    body: { refreshToken: "private-refresh-token" },
    ip: "192.0.2.1",
  } as Request;
  const keys = rateLimitBuckets("refresh", req);
  assert.ok(
    keys.every(
      (bucket) =>
        !bucket.key.includes("private-refresh-token") &&
        !bucket.key.includes(req.ip!),
    ),
  );
  console.log(
    "Identities: private keys, IPv6 grouping and proxy configuration passed.",
  );
}

async function main() {
  assert.ok(
    process.env.JWT_ACCESS_SECRET,
    "JWT_ACCESS_SECRET is required for these tests",
  );
  testIdentities();
  await testHttp();
  await testRedis();
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
