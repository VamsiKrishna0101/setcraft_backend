-- Additive migration. Existing IDs and user/history relations are untouched.
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "mediaVariants" JSONB;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "coachingMetadata" JSONB;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "catalogVersion" TEXT;
ALTER TABLE "Workout" ADD COLUMN IF NOT EXISTS "catalogStatus" TEXT NOT NULL DEFAULT 'LEGACY';
CREATE INDEX IF NOT EXISTS "Workout_catalogStatus_idx" ON "Workout"("catalogStatus");
