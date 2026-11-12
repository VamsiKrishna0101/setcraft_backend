import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { listQuery as progressDatesQuery } from '../modules/progress/progress_types';
import { progressRange } from '../modules/progress/progress_range';
import { authenticateStrict } from "../middleware/auth";
import { rateLimit } from "../middleware/rate_limit";
import { requirePremium } from "../modules/subscription/subscription_service";
import prisma from '../config/prisma';
import { processNextPlan } from "./worker";
import { generateInput, PlannerError } from "./common/types";
import {
  assertStarterReady,
  getStarter,
  requestStarter,
} from "./starter_service";
import {
  requestPlan,
  getRun,
  listPlans,
  activatePlan,
  assertFreshPlan,
  getPlanAvailability,
  retryPlan,
  listPlanHistory,
  getSavedPlan,
} from "./service";

const router = Router();
router.use(authenticateStrict);

const handleRequest =
  (handler: (request: Request, response: Response) => Promise<void>) =>
  async (request: Request, response: Response, next: NextFunction) => {
    try {
      await handler(request, response);
    } catch (error) {
      if (error instanceof PlannerError) {
        return void response
          .status(error.status)
          .json({ error: error.message, code: error.code, ...error.details });
      }

      if (error instanceof z.ZodError) {
        return void response
          .status(400)
          .json({ error: "Check the plan date and timezone." });
      }
      next(error);
    }
  };
router.get(
  "/starter",
  handleRequest(async (request, response) => {
    response.json({ data: await getStarter(request.user!.userId) });
  }),
);
router.post(
  "/starter/validate",
  rateLimit("generatePlan"),
  handleRequest(async (request, response) => {
    const input = z.object({ planId: z.uuid() }).strict().parse(request.body);
    await assertStarterReady(request.user!.userId, input.planId);
    response.json({ data: { ready: true } });
  }),
);
router.post(
  "/starter",
  rateLimit("generatePlan"),
  handleRequest(async (request, response) => {
    const input = z
      .object({ timezone: z.string().min(1).max(80) })
      .strict()
      .parse(request.body);
    response.status(202).json({
      data: await requestStarter(request.user!.userId, input.timezone),
    });
  }),
);
router.get(
  "/",
  handleRequest(async (request, response) => {
    response.json({ data: await listPlans(request.user!.userId) });
  }),
);
router.get(
  "/availability",
  handleRequest(async (request, response) => {
    const [availability, preferences] = await Promise.all([
      getPlanAvailability(request.user!.userId),
      prisma.onboarding.findUnique({where: {userId: request.user!.userId}, select: {trainingDays: true, daysPerWeek: true}}),
    ]);
    response.json({ data: {...availability, schedulePreferences: preferences} });
  }),
);
router.get(
  "/history",
  handleRequest(async (request, response) => {
    const cursor = z.uuid().optional().parse(request.query.cursor);
    const query = request.query.period == null ? null : progressDatesQuery.parse(request.query);
    response.json({
      data: await listPlanHistory(request.user!.userId, cursor,
          query ? progressRange(query, '2000-01-01') : undefined),
    });
  }),
);
router.get(
  "/saved/:id",
  handleRequest(async (request, response) => {
    response.json({
      data: await getSavedPlan(
        request.user!.userId,
        z.uuid().parse(request.params.id),
      ),
    });
  }),
);
router.get(
  "/demo",
  handleRequest(async (request, response) => {
    // Keep older clients compatible without offering demo history.
    response.json({ data: [] });
  }),
);
router.post(
  "/generate",
  requirePremium,
  rateLimit("generatePlan"),
  handleRequest(async (request, response) => {
    if (request.body?.includeDemo === true) {
      throw new PlannerError(
        "DEMO_HISTORY_DISABLED",
        "Plans use your real profile and saved history only.",
      );
    }
    const input = generateInput.parse(request.body);

    response.status(202).json({
      data: await requestPlan(
        request.user!.userId,
        input.weekStart,
        input.timezone,
        input.includeDemo,
        input.startDate && input.trainingDates ? {startDate: input.startDate, trainingDates: input.trainingDates} : undefined,
      ),
    });
  }),
);
// Cloud Run only gives this service CPU while a request is open. Holding the
// status poll open (up to RUN_POLL_HOLD_MS) while a plan is being generated
// keeps CPU allocated for the worker on this instance, so generation and its
// database connections are not starved between the app's 3-second polls.
const RUN_POLL_HOLD_MS = 15000;
const RUN_POLL_STEP_MS = 1500;
router.get(
  "/runs/:id",
  handleRequest(async (request, response) => {
    const userId = request.user!.userId;
    const id = z.uuid().parse(request.params.id);
    const deadline = Date.now() + RUN_POLL_HOLD_MS;
    const peek = () =>
      prisma.weeklyPlanRun.findFirst({
        where: { id, userId },
        select: { status: true, updatedAt: true },
      });
    const first = await peek();
    let current = first;
    while (
      current &&
      (current.status === "QUEUED" || current.status === "RUNNING") &&
      Date.now() + RUN_POLL_STEP_MS < deadline &&
      !request.socket.destroyed
    ) {
      // Pick the run up here, where CPU is currently allocated.
      if (current.status === "QUEUED") void processNextPlan();
      await new Promise((resolve) => setTimeout(resolve, RUN_POLL_STEP_MS));
      current = await peek();
      if (
        !current ||
        current.status !== first!.status ||
        current.updatedAt.getTime() !== first!.updatedAt.getTime()
      )
        break;
    }
    response.json({ data: await getRun(userId, id) });
  }),
);
router.post(
  "/runs/:id/retry",
  requirePremium,
  rateLimit("generatePlan"),
  handleRequest(async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    response
      .status(202)
      .json({ data: await retryPlan(request.user!.userId, id) });
  }),
);
router.post(
  "/:id/activate",
  requirePremium,
  handleRequest(async (request, response) => {
    const id = z.uuid().parse(request.params.id);
    await assertFreshPlan(request.user!.userId, id);
    response.json({ data: await activatePlan(request.user!.userId, id) });
  }),
);
export default router;
