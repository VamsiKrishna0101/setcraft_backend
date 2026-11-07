CREATE TABLE "UserNutritionSettings" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "mode" TEXT NOT NULL DEFAULT 'ROUTINE',
  "mealSlots" "MealType"[] DEFAULT ARRAY['BREAKFAST','LUNCH','DINNER','SNACK']::"MealType"[],
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserNutritionSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "UserMealRoutine" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "nutritionId" TEXT NOT NULL,
  "mealType" "MealType" NOT NULL,
  "days" "DayOfWeek"[],
  "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
  "startsOn" TEXT NOT NULL,
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMealRoutine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserMealRoutine_nutritionId_fkey" FOREIGN KEY ("nutritionId") REFERENCES "Nutrition"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "UserMealRoutine_userId_paused_idx" ON "UserMealRoutine"("userId", "paused");
CREATE TABLE "UserMealOccurrence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "sourceKey" TEXT NOT NULL,
  "mealType" "MealType" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "entries" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserMealOccurrence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "UserMealOccurrence_userId_date_sourceKey_key" ON "UserMealOccurrence"("userId", "date", "sourceKey");
CREATE INDEX "UserMealOccurrence_userId_date_idx" ON "UserMealOccurrence"("userId", "date");
ALTER TABLE "UserMealLog" ADD COLUMN "occurrenceId" TEXT;
CREATE INDEX "UserMealLog_occurrenceId_idx" ON "UserMealLog"("occurrenceId");
ALTER TABLE "UserMealLog" ADD CONSTRAINT "UserMealLog_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "UserMealOccurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
