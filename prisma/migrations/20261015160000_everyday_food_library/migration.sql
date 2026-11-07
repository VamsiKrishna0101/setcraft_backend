ALTER TABLE "Nutrition"
  ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "photoData" BYTEA,
  ADD COLUMN "photoMime" TEXT;

CREATE INDEX "Nutrition_userId_isArchived_name_idx"
  ON "Nutrition"("userId", "isArchived", "name");
