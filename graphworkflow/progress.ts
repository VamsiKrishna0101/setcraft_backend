import prisma from "../config/prisma";
import { PlannerError } from "./common/types";

export const PLANNER_STEPS = [
  "history",
  "chest",
  "back",
  "legs",
  "shoulders",
  "biceps",
  "triceps",
  "core",
  "workouts",
  "nutrition",
  "validation",
  "saved",
] as const;

export type PlannerStep = (typeof PLANNER_STEPS)[number];

export function planProgress(progress: unknown, saved: boolean) {
  const completed = progress && typeof progress === "object" ? progress : {};
  const completedSteps = PLANNER_STEPS.filter(
    (step) => completed[step as keyof typeof completed] === true,
  );

  return {
    percent: saved
      ? 100
      : Math.min(
          99,
          Math.floor((completedSteps.length / PLANNER_STEPS.length) * 100),
        ),
    completedSteps: saved ? [...PLANNER_STEPS] : completedSteps,
  };
}

export async function reportPlanProgress(
  runId: string,
  leaseToken: string,
  stage: string,
  completedStep?: PlannerStep,
) {
  const progress = JSON.stringify(
    completedStep ? { [completedStep]: true } : {},
  );
  const now = new Date();

  // Merge in PostgreSQL: parallel agents must not overwrite sibling progress.
  const updated = await prisma.$executeRaw`
    UPDATE "WeeklyPlanRun"
    SET "stage" = ${stage}, "progress" = "progress" || ${progress}::jsonb,
        "updatedAt" = ${now}
    WHERE "id" = ${runId} AND "status" = 'RUNNING'
      AND "leaseToken" = ${leaseToken} AND "leaseUntil" > ${now}
  `;

  if (!updated) {
    throw new PlannerError(
      "LEASE_LOST",
      "The job was resumed by another worker.",
    );
  }
}
