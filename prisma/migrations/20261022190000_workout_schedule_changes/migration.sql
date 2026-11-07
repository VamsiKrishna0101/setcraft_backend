CREATE TABLE "WorkoutScheduleChange" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "planId" TEXT,
  "weekStart" TEXT NOT NULL,
  "fromDate" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "changes" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkoutScheduleChange_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutScheduleChange_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkoutScheduleChange_userId_fingerprint_key" ON "WorkoutScheduleChange"("userId", "fingerprint");
CREATE INDEX "WorkoutScheduleChange_userId_weekStart_createdAt_idx" ON "WorkoutScheduleChange"("userId", "weekStart", "createdAt");
CREATE INDEX "WorkoutScheduleChange_planId_createdAt_idx" ON "WorkoutScheduleChange"("planId", "createdAt");
