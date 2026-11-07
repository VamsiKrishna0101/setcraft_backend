import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import prisma from "../config/prisma";
import { PlannerError } from "../graphworkflow/common/types";
import {
  canRetryPlan,
  planFailure,
} from "../graphworkflow/common/retry_policy";
import { claimPlanRun, recordPlanFailure } from "../graphworkflow/run_queue";
import { getRun, retryPlan } from "../graphworkflow/service";

async function main() {
  const now = new Date();
  const unavailable = new PlannerError(
    "MODEL_UNAVAILABLE",
    "Temporary outage",
    503,
  );
  assert.equal(
    planFailure(unavailable, 1, now).leaseUntil?.getTime(),
    now.getTime() + 5000,
  );
  assert.equal(
    planFailure(unavailable, 2, now).leaseUntil?.getTime(),
    now.getTime() + 10000,
  );
  assert.equal(planFailure(unavailable, 3, now).status, "FAILED");
  assert.equal(
    planFailure(Object.assign(new Error(), { code: "P1001" }), 1).status,
    "QUEUED",
  );
  assert.equal(
    planFailure(Object.assign(new Error(), { status: 403 }), 1).status,
    "FAILED",
  );
  assert.equal(canRetryPlan("PLAN_UNAVAILABLE", 1), false);
  const membership = planFailure(
    Object.assign(new Error(), { status: 402 }),
    1,
  );
  assert.equal(membership.status, "FAILED");
  assert.equal(membership.errorCode, "PREMIUM_REQUIRED");
  assert.equal(canRetryPlan(membership.errorCode, 1), false);
  for (const code of [
    "INVALID_SPLIT",
    "STALE_PLAN",
    "CATALOG_CHANGED",
    "WORKFLOW_UPDATED",
    "STARTER_REVIEW_REQUIRED",
  ]) {
    assert.equal(
      planFailure(new PlannerError(code, "Update input", 409), 1).status,
      "FAILED",
    );
    assert.equal(canRetryPlan(code, 1), false);
  }
  const user = await prisma.user.create({
    data: {
      email: `retry-queue-${randomUUID()}@example.invalid`,
      password: "isolated-fixture",
    },
  });
  try {
    const progress = { completedSteps: ["history", "legs"] };
    const run = await prisma.weeklyPlanRun.create({
      data: {
        userId: user.id,
        weekStart: "2099-01-05",
        contextHash: randomUUID(),
        input: {},
        progress,
      },
    });
    const claim = (token: string, time: Date) =>
      prisma.$transaction((db) => claimPlanRun(db, token, time, run.id));
    const first = await claim("worker-1", now);
    assert.equal(first?.attempts, 1);
    assert.equal(
      await claim("other-worker", now),
      null,
      "A live lease cannot be claimed twice",
    );
    assert.equal(
      (
        await recordPlanFailure(
          prisma,
          run.id,
          "wrong-lease",
          1,
          unavailable,
          now,
        )
      ).count,
      0,
    );
    await recordPlanFailure(prisma, run.id, "worker-1", 1, unavailable, now);
    const retrying = await getRun(user.id, run.id);
    assert.equal(retrying.stage, "retrying");
    assert.equal(
      retrying.retryAt,
      new Date(now.getTime() + 5000).toISOString(),
    );
    assert.equal(
      retrying.canRetry,
      false,
      "Automatic retries do not expose a duplicate manual action",
    );
    assert.deepEqual(
      (await prisma.weeklyPlanRun.findUniqueOrThrow({ where: { id: run.id } }))
        .progress,
      progress,
    );
    assert.equal(
      await claim("too-early", new Date(now.getTime() + 4999)),
      null,
      "Backoff is respected",
    );
    const second = await claim("worker-2", new Date(now.getTime() + 5000));
    assert.equal(second?.attempts, 2);
    assert.equal(second?.errorCode, null);
    assert.equal(
      (await recordPlanFailure(prisma, run.id, "worker-1", 1, unavailable, now))
        .count,
      0,
      "Old workers cannot undo a newer lease",
    );
    await recordPlanFailure(prisma, run.id, "worker-2", 2, unavailable, now);
    assert.equal(
      await claim("too-early", new Date(now.getTime() + 9999)),
      null,
    );
    assert.equal(
      (await claim("worker-3", new Date(now.getTime() + 10000)))?.attempts,
      3,
    );
    await recordPlanFailure(prisma, run.id, "worker-3", 3, unavailable, now);
    const failed = await getRun(user.id, run.id);
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.canRetry, false);
    assert.equal(
      await claim("worker-4", new Date(now.getTime() + 999999)),
      null,
      "Attempts are bounded",
    );
    await assert.rejects(
      retryPlan(user.id, run.id),
      (e: any) => e.code === "RETRY_UNAVAILABLE",
    );

    // Simulate a response-validation failure that a member elects to retry.
    await prisma.weeklyPlanRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        attempts: 1,
        errorCode: "MODEL_RESPONSE_INVALID",
        leaseUntil: new Date(now.getTime() + 60000),
        leaseToken: "old",
      },
    });
    const manual = await retryPlan(user.id, run.id);
    assert.equal(manual.status, "QUEUED");
    assert.equal(manual.retryAt, null);
    const reclaimed = await claim("recovery", now);
    assert.equal(reclaimed?.attempts, 2);
    assert.equal(reclaimed?.leaseToken, "recovery");
    // A crashed process can be resumed after its lease, with a single owner.
    const expired = new Date(now.getTime() + 180001);
    const concurrent = await Promise.all([
      claim("crash-recovery-a", expired),
      claim("crash-recovery-b", expired),
    ]);
    assert.equal(concurrent.filter(Boolean).length, 1);
    const owner = concurrent.find(Boolean)!;
    assert.equal(owner.attempts, 3);
    await prisma.weeklyPlanRun.update({
      where: { id: run.id },
      data: { status: "COMPLETED", leaseToken: null, leaseUntil: null },
    });
    assert.equal(
      (
        await recordPlanFailure(
          prisma,
          run.id,
          owner.leaseToken!,
          3,
          unavailable,
        )
      ).count,
      0,
      "Completed results cannot be replaced by a late failure",
    );
    console.log(
      "Planner retry policy, timed backoff, bounded attempts, frozen progress, manual retry, crashed-worker recovery and lease ownership passed. No model calls; only an isolated temporary account was used.",
    );
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
