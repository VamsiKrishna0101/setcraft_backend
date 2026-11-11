import { Prisma } from "@prisma/client";
import prisma from "../config/prisma";
import {assertAiPlanningConsent} from '../modules/privacy/ai_consent';
import { getmysubscription } from "../modules/subscription/subscription_service";
import { dateInZone, PlannerError, Snapshot } from "./common/types";
import { hashContext, loadSnapshot } from "./nodes/prepare_node";
import { assertFreshPlan, getRun } from "./service";

const starterWhere = (userId: string) => ({
  userId,
  input: { path: ["onboardingStarter"], equals: true },
});

/** Check readiness before checkout; this never grants access. */
export async function assertStarterReady(userId: string, planId: string) {
  const run = await prisma.weeklyPlanRun.findFirst({
    where: {
      ...starterWhere(userId),
      status: "COMPLETED",
      plan: { id: planId },
    },
    select: { id: true },
  });
  if (!run) throw new PlannerError("NOT_FOUND", "Starter plan not found.", 404);
  await assertFreshPlan(userId, planId);
}

export async function getStarter(userId: string) {
  const run = await prisma.weeklyPlanRun.findFirst({
    where: starterWhere(userId),
    orderBy: { createdAt: "asc" },
  });
  const access = await getmysubscription(userId, false);
  const existingPlan = run
    ? null
    : await prisma.weeklyPersonalPlan.findFirst({ where: { userId } });
  return {
    eligible: access.state === "available" && !existingPlan,
    hasAccess: access.hasAccess,
    run: run
      ? {
          ...(await getRun(userId, run.id)),
          ...(run.status === "FAILED" &&
          hashContext(run.input as unknown as Snapshot) !== run.contextHash
            ? { canRetry: true }
            : {}),
        }
      : null,
  };
}

/** The user row lock makes the single starter allowance atomic across devices. */
export async function requestStarter(userId: string, timezone: string) {
  await assertAiPlanningConsent(userId);
  const id = await prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId} FOR UPDATE`;
      const previous = await db.weeklyPlanRun.findFirst({
        where: starterWhere(userId),
        orderBy: { createdAt: "asc" },
      });
      if (previous) {
        const draft = await db.weeklyPersonalPlan.findFirst({
          where: { runId: previous.id, status: "DRAFT" },
          select: { id: true },
        });
        // Checkout may already have granted access. Refresh only the unpublished
        // draft, reusing its allowance and leaving the entitlement untouched.
        const canRefreshDraft =
          previous.status === "COMPLETED" && Boolean(draft);
        if (previous.status === "FAILED" || canRefreshDraft) {
          const weekStart = dateInZone(timezone);
          const snapshot = {
            ...(await loadSnapshot(
              userId,
              weekStart,
              timezone,
              false,
              db,
              true,
            )),
            onboardingStarter: true,
          };
          const contextHash = hashContext(snapshot);
          const changed = contextHash !== previous.contextHash;
          if (
            (canRefreshDraft && !changed) ||
            (previous.attempts >= 3 && !changed)
          )
            return previous.id;
          if (canRefreshDraft && draft)
            await db.weeklyPersonalPlan.delete({ where: { id: draft.id } });
          await db.weeklyPlanRun.update({
            where: { id: previous.id },
            data: {
              weekStart,
              input: JSON.parse(JSON.stringify(snapshot)),
              contextHash,
              attempts: changed ? 0 : previous.attempts,
              status: "QUEUED",
              stage: "queued",
              progress: {},
              errorCode: null,
              leaseUntil: null,
              leaseToken: null,
            },
          });
        }
        return previous.id;
      }
      const user = await db.user.findUniqueOrThrow({
        where: { id: userId },
        select: { trialStartedAt: true },
      });
      const saved = await db.weeklyPersonalPlan.findFirst({
        where: { userId },
      });
      if (user.trialStartedAt || saved) {
        throw new PlannerError(
          "STARTER_UNAVAILABLE",
          "Your starter allowance has already been used.",
          403,
        );
      }
      const weekStart = dateInZone(timezone);
      const snapshot = {
        ...(await loadSnapshot(userId, weekStart, timezone, false, db, true)),
        onboardingStarter: true,
      };
      const run = await db.weeklyPlanRun.create({
        data: {
          userId,
          weekStart,
          contextHash: hashContext(snapshot),
          input: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        },
      });
      return run.id;
    },
    { maxWait: 10000, timeout: 20000 },
  );
  return getRun(userId, id);
}
