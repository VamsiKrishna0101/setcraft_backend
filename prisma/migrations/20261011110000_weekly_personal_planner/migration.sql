CREATE TABLE "WeeklyPlanRun" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "weekStart" TEXT NOT NULL, "contextHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "stage" TEXT NOT NULL DEFAULT 'queued', "input" JSONB NOT NULL, "errorCode" TEXT,
 "attempts" INTEGER NOT NULL DEFAULT 0, "leaseUntil" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "WeeklyPlanRun_status_check" CHECK ("status" IN ('QUEUED','RUNNING','COMPLETED','FAILED'))
);
CREATE UNIQUE INDEX "WeeklyPlanRun_userId_weekStart_contextHash_key" ON "WeeklyPlanRun"("userId","weekStart","contextHash");
CREATE INDEX "WeeklyPlanRun_status_leaseUntil_createdAt_idx" ON "WeeklyPlanRun"("status","leaseUntil","createdAt");
CREATE TABLE "WeeklyPersonalPlan" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "runId" TEXT NOT NULL REFERENCES "WeeklyPlanRun"("id") ON DELETE CASCADE,
 "weekStart" TEXT NOT NULL, "version" INTEGER NOT NULL, "status" TEXT NOT NULL DEFAULT 'DRAFT',
 "synthetic" BOOLEAN NOT NULL DEFAULT false, "payload" JSONB NOT NULL, "promptVersion" TEXT NOT NULL,
 "ruleVersion" TEXT NOT NULL, "model" TEXT NOT NULL, "activatedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "WeeklyPersonalPlan_status_check" CHECK ("status" IN ('DRAFT','ACTIVE','ARCHIVED'))
);
CREATE UNIQUE INDEX "WeeklyPersonalPlan_runId_key" ON "WeeklyPersonalPlan"("runId");
CREATE UNIQUE INDEX "WeeklyPersonalPlan_userId_weekStart_version_key" ON "WeeklyPersonalPlan"("userId","weekStart","version");
CREATE INDEX "WeeklyPersonalPlan_userId_weekStart_status_idx" ON "WeeklyPersonalPlan"("userId","weekStart","status");
CREATE UNIQUE INDEX "WeeklyPersonalPlan_one_active_week" ON "WeeklyPersonalPlan"("userId","weekStart") WHERE "status" = 'ACTIVE';
CREATE TABLE "PlannerDemoWeek" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "weekStart" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "PlannerDemoWeek_userId_weekStart_key" ON "PlannerDemoWeek"("userId","weekStart");
