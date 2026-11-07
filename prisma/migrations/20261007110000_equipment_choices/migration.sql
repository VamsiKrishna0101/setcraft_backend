-- Preserve existing broad categories. Detailed selections are opt-in for legacy profiles.
ALTER TABLE "Onboarding" ADD COLUMN IF NOT EXISTS "equipmentIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
