import { Prisma } from "@prisma/client";
import { MAX_PLAN_ATTEMPTS, planFailure } from "./common/retry_policy";

export async function claimPlanRun(
  db: Prisma.TransactionClient,
  leaseToken: string,
  now = new Date(),
  onlyRunId?: string,
) {
  const scope = onlyRunId ? Prisma.sql`AND "id" = ${onlyRunId}` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM "WeeklyPlanRun"
    WHERE "status" IN ('QUEUED', 'RUNNING')
      AND ("leaseUntil" IS NULL OR "leaseUntil" <= ${now})
      AND "attempts" < ${MAX_PLAN_ATTEMPTS} ${scope}
    ORDER BY "createdAt" FOR UPDATE SKIP LOCKED LIMIT 1`);
  if (!rows[0]) return null;
  return db.weeklyPlanRun.update({
    where: { id: rows[0].id },
    data: {
      status: "RUNNING",
      stage: "preparing",
      errorCode: null,
      attempts: { increment: 1 },
      leaseUntil: new Date(now.getTime() + 180000),
      leaseToken,
    },
  });
}

export function recordPlanFailure(
  db: Prisma.TransactionClient,
  runId: string,
  leaseToken: string,
  attempts: number,
  error: unknown,
  now = new Date(),
) {
  // An expired worker cannot overwrite another worker's progress or completion.
  return db.weeklyPlanRun.updateMany({
    where: { id: runId, leaseToken, status: "RUNNING" },
    data: planFailure(error, attempts, now),
  });
}
