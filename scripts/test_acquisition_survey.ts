import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { inject } from "light-my-request";
import jwt from "jsonwebtoken";
import prisma from "../config/prisma";
import routes from "../modules/onboarding/onboarding_routes";
import { rateLimitStore } from "../middleware/rate_limit";

async function main() {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const original = rateLimitStore.consume;
  // Exercise the actual JWT ownership middleware without depending on Redis.
  rateLimitStore.consume = async () =>
    ({ allowed: true, retryAfter: 0 }) as any;
  try {
    for (const id of ids)
      await prisma.user.create({
        data: {
          id,
          email: `discovery-${id}@setcraft.invalid`,
          password: "fixture-only",
          isVerified: true,
        },
      });
    const app = express();
    app.use(express.json());
    app.use("/api/onboarding", routes);
    const headers = (id: string) => ({
      authorization: `Bearer ${jwt.sign({ userId: id }, process.env.JWT_ACCESS_SECRET!, { expiresIn: "5m" })}`,
    });
    const url = "/api/onboarding/discovery";
    const call = (id: string, payload: object) =>
      inject(app, { method: "POST", url, headers: headers(id), payload });
    assert.equal((await inject(app, { method: "GET", url })).statusCode, 401);
    assert.equal(
      (await call(ids[0]!, { source: "BAD_CHANNEL" })).statusCode,
      400,
    );
    assert.equal(
      (await call(ids[0]!, { source: "INSTAGRAM", userId: ids[1] })).statusCode,
      400,
    );
    assert.equal(
      (await call(ids[0]!, { source: null, detail: "not allowed on skip" }))
        .statusCode,
      400,
    );
    assert.equal(
      (await call(ids[0]!, { source: "OTHER", detail: "x".repeat(101) }))
        .statusCode,
      400,
    );
    const initial = await inject(app, {
      method: "GET",
      url,
      headers: headers(ids[0]!),
    });
    assert.equal(initial.json().data.completed, false);
    const result = await Promise.all([
      call(ids[0]!, { source: "INSTAGRAM" }),
      call(ids[0]!, { source: "INSTAGRAM" }),
    ]);
    assert.ok(result.every((r) => r.statusCode === 200));
    assert.equal(
      await prisma.acquisitionResponse.count({ where: { userId: ids[0] } }),
      1,
    );
    await call(ids[0]!, { source: "YOUTUBE" });
    assert.equal(
      (
        await prisma.acquisitionResponse.findUniqueOrThrow({
          where: { userId: ids[0] },
        })
      ).source,
      "INSTAGRAM",
    );
    assert.equal(
      (
        await inject(app, { method: "GET", url, headers: headers(ids[1]!) })
      ).json().data.completed,
      false,
    );
    assert.equal((await call(ids[1]!, { source: null })).statusCode, 200);
    assert.equal(
      (
        await prisma.acquisitionResponse.findUniqueOrThrow({
          where: { userId: ids[1] },
        })
      ).source,
      null,
    );
    await call(ids[2]!, { source: "OTHER", detail: "  My gym  " });
    assert.equal(
      (
        await prisma.acquisitionResponse.findUniqueOrThrow({
          where: { userId: ids[2] },
        })
      ).detail,
      "My gym",
    );
    await prisma.user.delete({ where: { id: ids[2] } });
    assert.equal(
      await prisma.acquisitionResponse.count({ where: { userId: ids[2] } }),
      0,
    );
    console.log(
      "Discovery survey: JWT ownership, validation, concurrency, dismissal, isolation and deletion passed.",
    );
  } finally {
    rateLimitStore.consume = original;
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
