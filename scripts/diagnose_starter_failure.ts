import "dotenv/config";
import prisma from "../config/prisma";
import { buildStarterFallback } from "../graphworkflow/starter_fallback";
import { PlannerError, Snapshot } from "../graphworkflow/common/types";
import { requestStarter } from "../graphworkflow/starter_service";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Pass the failed starter run ID.");
  const run = await prisma.weeklyPlanRun.findUniqueOrThrow({
    where: { id },
    select: {
      userId: true,
      status: true,
      errorCode: true,
      attempts: true,
      input: true,
      progress: true,
      plan: { select: { id: true, status: true, model: true } },
    },
  });
  const snapshot = run.input as unknown as Snapshot;
  if (!snapshot.onboardingStarter)
    throw new Error("Expected an onboarding starter run.");
  if (process.argv.includes("--retry")) {
    if (run.status !== "FAILED" || run.plan)
      throw new Error(
        "Only a failed starter without a saved plan can be retried here.",
      );
    const queued = await requestStarter(run.userId, snapshot.timezone);
    console.log(
      JSON.stringify({
        status: queued.status,
        attempts: queued.attempts,
        errorCode: queued.errorCode,
      }),
    );
    return;
  }
  if (process.argv.includes("--status")) {
    console.log(
      JSON.stringify({
        status: run.status,
        errorCode: run.errorCode,
        attempts: run.attempts,
        plan: run.plan,
      }),
    );
    return;
  }
  console.log(
    JSON.stringify({
      status: run.status,
      errorCode: run.errorCode,
      attempts: run.attempts,
      progress: run.progress,
      setup: {
        level: snapshot.profile.experience,
        location: snapshot.profile.location,
        days: snapshot.profile.daysPerWeek,
        minutes: snapshot.profile.minutes,
        split: snapshot.profile.trainingSplit,
        candidates: snapshot.candidates.length,
        hasMovementNotes: !!snapshot.profile.customLimitations?.trim(),
        hasLimitations: snapshot.profile.limitations.some(
          (value) => value !== "NONE",
        ),
      },
    }),
  );
  try {
    const plan = await buildStarterFallback(snapshot);
    console.log(
      JSON.stringify({
        fallback: "valid",
        sessions: plan.workouts
          .filter((d) => !d.restDay)
          .map((d) => ({
            date: d.date,
            exercises: d.exercises.map((e) => ({ name: e.name, sets: e.sets })),
          })),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        fallback: "failed",
        code: error instanceof PlannerError ? error.code : "UNEXPECTED",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}
main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
