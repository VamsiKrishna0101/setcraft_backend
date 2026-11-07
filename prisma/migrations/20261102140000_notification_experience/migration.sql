ALTER TABLE "NotificationPreference"
  ADD COLUMN "pausedUntil" TIMESTAMP(3),
  ADD COLUMN "nextScheduleAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "NotificationPreference_enabled_nextScheduleAt_idx" ON "NotificationPreference"("enabled", "nextScheduleAt");

ALTER TABLE "NotificationJob"
  ADD COLUMN "activityDate" TEXT,
  ADD COLUMN "reason" TEXT,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN "openedAt" TIMESTAMP(3);
CREATE INDEX "NotificationJob_createdAt_idx" ON "NotificationJob"("createdAt");
