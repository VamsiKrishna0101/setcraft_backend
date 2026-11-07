ALTER TABLE "User" ADD COLUMN "wearableUsage" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "User" ADD CONSTRAINT "User_wearableUsage_check" CHECK ("wearableUsage" IN ('UNKNOWN', 'WEARABLE', 'NONE'));
ALTER TABLE "DailyWellnessEntry"
  ADD COLUMN "rested" INTEGER,
  ADD COLUMN "soreness" INTEGER,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'self_report',
  ADD COLUMN "sleepStartedAt" TIMESTAMP(3),
  ADD COLUMN "sleepEndedAt" TIMESTAMP(3);
