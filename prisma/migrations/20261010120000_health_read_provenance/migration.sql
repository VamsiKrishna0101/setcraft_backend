ALTER TABLE "HealthKitSnapshot"
  ADD COLUMN "hrvMethod" TEXT,
  ADD COLUMN "metricMetadata" JSONB,
  ADD COLUMN "utcOffsetMinutes" INTEGER;
ALTER TABLE "HealthKitWorkout" ALTER COLUMN "activeCalories" DROP NOT NULL;
