ALTER TABLE "Onboarding"
  ADD COLUMN "countryCode" TEXT NOT NULL DEFAULT 'GB',
  ADD COLUMN "preferredTime" TEXT,
  ADD COLUMN "trainingDays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "focusMuscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "customLimitations" TEXT,
  ADD COLUMN "foodAllergies" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "dislikedFoods" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "foodBudgetAmount" DOUBLE PRECISION,
  ADD COLUMN "foodBudgetCurrency" TEXT;

CREATE TABLE "MuscleCheckIn" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "muscleId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "soreness" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MuscleCheckIn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MuscleCheckIn_soreness_check" CHECK ("soreness" BETWEEN 0 AND 3),
  CONSTRAINT "MuscleCheckIn_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MuscleCheckIn_userId_muscleId_date_key" ON "MuscleCheckIn"("userId", "muscleId", "date");
CREATE INDEX "MuscleCheckIn_userId_date_idx" ON "MuscleCheckIn"("userId", "date");
