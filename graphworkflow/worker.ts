import { randomUUID } from "node:crypto";
import {aiPlanningOwner, assertAiPlanningConsent} from '../modules/privacy/ai_consent';
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import prisma, { pool } from "../config/prisma";
import { buildWeeklyGraph } from "./graph";
import {
  Snapshot,
  PlannerError,
  PROMPT_VERSION,
  requireCompletedPlan,
} from "./common/types";
import { saveCompletedPlan } from "./service";
import { reportPlanProgress } from "./progress";
import { assertPremium } from "../modules/subscription/subscription_service";
import { createStructuredModel } from "./common/model";
import {
  generateStarterWithFallback,
  generateWeeklyWithFallback,
} from "./starter_fallback";
import { plannerSnapshot } from "./common/measurements";
import { MAX_PLAN_ATTEMPTS } from './common/retry_policy';
import { claimPlanRun, recordPlanFailure } from './run_queue';

const checkpointer = new PostgresSaver(pool, undefined, {
  schema: "fitai_planner_checkpoints",
});

let initialization: Promise<void> | undefined;

let isProcessing = false;
export async function initializePlanner() {
  initialization ??= (async () => {
    await checkpointer.setup();

    // This schema belongs exclusively to planner runs. Foreign keys ensure
    // account deletion also removes checkpoints, including in-flight writes.

    for (const table of [
      "checkpoints",
      "checkpoint_blobs",
      "checkpoint_writes",
    ]) {
      await prisma.$executeRawUnsafe(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fitai_${table}_run_fk') THEN
          ALTER TABLE fitai_planner_checkpoints.${table}
          ADD CONSTRAINT fitai_${table}_run_fk FOREIGN KEY (thread_id)
          REFERENCES public."WeeklyPlanRun"("id") ON DELETE CASCADE;
        END IF;
      END $$`);
    }
  })().catch((error) => {
    initialization = undefined;

    throw error;
  });
  await initialization;
}
export async function processNextPlan() {
  if (isProcessing) {
    return false;
  }
  isProcessing = true;

  let runId: string | undefined;
  let attempts = 0;

  const leaseToken = randomUUID();

  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const now = new Date();
    await prisma.weeklyPlanRun.updateMany({
      where: {
        status: { in: ['RUNNING', 'QUEUED'] },
        attempts: { gte: MAX_PLAN_ATTEMPTS },
        OR: [{leaseUntil: {lte: now}}, {leaseUntil: null}],
      },
      data: {
        status: "FAILED",
        stage: "failed",
        errorCode: "RETRY_EXHAUSTED",
        leaseUntil: null,
        leaseToken: null,
      },
    });

    // Most polls find nothing. Check without opening a transaction so idle
    // polling does not hold pooled connections or queue behind API requests.
    const claimable = await prisma.weeklyPlanRun.findFirst({
      where: {
        status: { in: ['QUEUED', 'RUNNING'] },
        attempts: { lt: MAX_PLAN_ATTEMPTS },
        OR: [{ leaseUntil: { lte: now } }, { leaseUntil: null }],
      },
      select: { id: true },
    });
    if (!claimable) return false;

    // The Supabase transaction pooler can take a few seconds to hand out a
    // connection under load; Prisma's 2 s default made polls fail repeatedly.
    const run = await prisma.$transaction(
      transaction => claimPlanRun(transaction, leaseToken, now),
      { maxWait: 10000, timeout: 15000 },
    );

    if (!run) {
      return false;
    }
    runId = run.id;
    attempts = run.attempts;
    const snapshot = plannerSnapshot(run.input as unknown as Snapshot);
    await assertAiPlanningConsent(run.userId);

    if (!snapshot.onboardingStarter) await assertPremium(run.userId);
    if (!snapshot.onboardingStarter) await initializePlanner();
    heartbeat = setInterval(() => {
      void prisma.weeklyPlanRun
        .updateMany({
          where: { id: run.id, status: "RUNNING", leaseToken },
          data: { leaseUntil: new Date(Date.now() + 180000) },
        })
        .catch(() => {});
    }, 30000);
    heartbeat.unref();

    const graph = buildWeeklyGraph({
      ...(snapshot.onboardingStarter
        ? {
            // Two attempts: the second gets repair feedback for a malformed
            // response. Failures are logged so starter issues are diagnosable.
            model: createStructuredModel(120000, 2, (failure) =>
              console.warn(
                JSON.stringify({ event: "starter_model_failure", runId: run.id, ...failure }),
              ),
            ),
          }
        : {}),
      checkpointer: snapshot.onboardingStarter ? undefined : checkpointer,
      stage: (stage, completedStep) =>
        reportPlanProgress(run.id, leaseToken, stage, completedStep),
    });

    const config = {
      configurable: { thread_id: run.id },
      maxConcurrency: 3,
      recursionLimit: 20,
    };

    const checkpoint = snapshot.onboardingStarter
      ? { values: undefined }
      : await graph.getState(config);

    if (
      checkpoint.values?.snapshot &&
      checkpoint.values.promptVersion !== PROMPT_VERSION
    ) {
      throw new PlannerError(
        "WORKFLOW_UPDATED",
        "The planner was updated. Generate a new plan to use the current agents.",
        409,
      );
    }

    // Restart the explicit edges with frozen input and completed agent results.
    // Agents reuse their saved output; failed or unstarted agents run again.
    const input = {
      snapshot,
      regions: checkpoint.values?.regions ?? {},
    };

    const generate = async () =>
      aiPlanningOwner.run(run.userId, async()=>requireCompletedPlan(await graph.invoke(input, config)));
    const plan = snapshot.onboardingStarter
      ? await generateStarterWithFallback(generate, snapshot, (stage, step) =>
          reportPlanProgress(run.id, leaseToken, stage, step),
        )
      : await generateWeeklyWithFallback(generate, snapshot, (stage, step) =>
          reportPlanProgress(run.id, leaseToken, stage, step),
        );
    await saveCompletedPlan(run.id, plan, leaseToken);
    console.info("Weekly planner completed", {
      runId: run.id,
      worker: leaseToken,
    });

    return true;
  } catch (error) {
    if (runId) {
      await recordPlanFailure(prisma, runId, leaseToken, attempts, error)
        .catch(() => {});
      console.warn("Weekly planner run failed", {
        runId,
        code: error instanceof PlannerError ? error.code : "GENERATION_FAILED",
        error: error instanceof Error ? error.message : error,
      });
    } else {
      console.warn("Weekly planner worker poll failed", {
        code: error instanceof PlannerError ? error.code : "POLL_FAILED",
        error: error instanceof Error ? error.message : error,
      });
    }

    return false;
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    isProcessing = false;
  }
}
export function startPlannerWorker() {
  const timer = setInterval(() => {
    void processNextPlan();
  }, 3000);
  timer.unref();
  void processNextPlan();

  return () => clearInterval(timer);
}
export async function closePlanner() {
  await checkpointer.end().catch(() => {});
}
