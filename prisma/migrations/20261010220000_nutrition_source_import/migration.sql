ALTER TYPE "NutritionCategory" ADD VALUE IF NOT EXISTS 'FAT_SOURCE';
ALTER TYPE "NutritionCategory" ADD VALUE IF NOT EXISTS 'MEAL';
ALTER TYPE "NutritionCategory" ADD VALUE IF NOT EXISTS 'OTHER';
ALTER TABLE "Nutrition" ADD COLUMN "sourceName" TEXT,
  ADD COLUMN "sourceFoodCode" TEXT,
  ADD COLUMN "sourceVersion" TEXT,
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "sourceDetails" JSONB;
CREATE UNIQUE INDEX "Nutrition_sourceName_sourceFoodCode_sourceVersion_key"
  ON "Nutrition"("sourceName", "sourceFoodCode", "sourceVersion");
