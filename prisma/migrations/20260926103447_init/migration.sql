-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "WorkingToward" AS ENUM ('BUILD_MUSCLE', 'LOSE_BODY_FAT', 'LOSE_WEIGHT', 'GET_FITTER', 'BUILD_CONSISTENCY');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "Experience" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "DaysPerWeek" AS ENUM ('DAYS_2', 'DAYS_3', 'DAYS_4', 'DAYS_5', 'DAYS_6_PLUS');

-- CreateEnum
CREATE TYPE "WorkoutDuration" AS ENUM ('MIN_20', 'MIN_30', 'MIN_45', 'MIN_60_PLUS');

-- CreateEnum
CREATE TYPE "TrainingLocation" AS ENUM ('GYM', 'HOME', 'OUTDOORS', 'MIX');

-- CreateEnum
CREATE TYPE "Equipment" AS ENUM ('DUMBBELLS', 'BARBELLS', 'MACHINES', 'CABLE', 'BENCH', 'OTHER');

-- CreateEnum
CREATE TYPE "ActivityLevel" AS ENUM ('LOW', 'MODERATE', 'HIGH');

-- CreateEnum
CREATE TYPE "SleepDuration" AS ENUM ('LESS_THAN_6_HOURS', 'HOURS_6_TO_7', 'HOURS_7_TO_8', 'HOURS_8_PLUS');

-- CreateEnum
CREATE TYPE "EatingStyle" AS ENUM ('NO_PREFERENCE', 'VEGETARIAN', 'VEGAN', 'OTHER');

-- CreateEnum
CREATE TYPE "WeeklyFoodBudget" AS ENUM ('BUDGET_50', 'BUDGET_75', 'BUDGET_100', 'BUDGET_150', 'BUDGET_200_PLUS');

-- CreateEnum
CREATE TYPE "BodyLimitation" AS ENUM ('NONE', 'SHOULDER', 'KNEE', 'BACK', 'WRIST', 'HIP', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'REST_DAY', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Difficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'LUNCH', 'DINNER', 'SNACK', 'PRE_WORKOUT', 'POST_WORKOUT');

-- CreateEnum
CREATE TYPE "NutritionCategory" AS ENUM ('PROTEIN_SOURCE', 'CARB_SOURCE', 'HEALTHY_FAT', 'VEGETABLE', 'FRUIT', 'DAIRY', 'SUPPLEMENT', 'BEVERAGE');

-- CreateEnum
CREATE TYPE "DayOfWeek" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workingToward" "WorkingToward" NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" "Gender" NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "experience" "Experience" NOT NULL,
    "daysPerWeek" "DaysPerWeek" NOT NULL,
    "workoutDuration" "WorkoutDuration" NOT NULL,
    "trainingLocation" "TrainingLocation" NOT NULL,
    "equipment" "Equipment"[],
    "activityLevel" "ActivityLevel" NOT NULL,
    "sleepDuration" "SleepDuration" NOT NULL,
    "eatingStyle" "EatingStyle" NOT NULL,
    "weeklyFoodBudget" "WeeklyFoodBudget" NOT NULL,
    "limitations" "BodyLimitation"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Readiness" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sleep" TEXT NOT NULL,
    "recovery" TEXT NOT NULL,
    "aiTarget" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Readiness_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "bodyPart" TEXT NOT NULL,
    "equipment" TEXT NOT NULL,
    "instructions" TEXT[],
    "difficulty" "Difficulty" NOT NULL,
    "videoUrl" TEXT,
    "trainingLocation" "TrainingLocation" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWorkout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekLabel" TEXT NOT NULL,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "aiNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWorkoutItem" (
    "id" TEXT NOT NULL,
    "userWorkoutId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "dayOfWeek" "DayOfWeek" NOT NULL,
    "orderIndex" INTEGER NOT NULL DEFAULT 0,
    "targetSets" INTEGER NOT NULL DEFAULT 3,
    "targetReps" TEXT NOT NULL DEFAULT '8-10',
    "targetRpe" DOUBLE PRECISION DEFAULT 8.0,
    "restSeconds" INTEGER NOT NULL DEFAULT 90,
    "status" "WorkStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWorkoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Nutrition" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "category" "NutritionCategory" NOT NULL,
    "imageUrl" TEXT,
    "barcode" TEXT,
    "servingSize" DOUBLE PRECISION NOT NULL,
    "servingUnit" TEXT NOT NULL,
    "caloriesPerServing" DOUBLE PRECISION NOT NULL,
    "proteinPerServing" DOUBLE PRECISION NOT NULL,
    "carbsPerServing" DOUBLE PRECISION NOT NULL,
    "fatPerServing" DOUBLE PRECISION NOT NULL,
    "fiberPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sugarPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sodiumPerServing" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "mealTypes" "MealType"[],
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Nutrition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMealLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nutritionId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "servings" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "calories" DOUBLE PRECISION NOT NULL,
    "protein" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,
    "fiber" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sugar" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMealLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_userId_key" ON "Onboarding"("userId");

-- CreateIndex
CREATE INDEX "Onboarding_userId_idx" ON "Onboarding"("userId");

-- CreateIndex
CREATE INDEX "Readiness_userId_idx" ON "Readiness"("userId");

-- CreateIndex
CREATE INDEX "Readiness_day_month_year_idx" ON "Readiness"("day", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Readiness_userId_day_month_year_key" ON "Readiness"("userId", "day", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_name_key" ON "Workout"("name");

-- CreateIndex
CREATE INDEX "Workout_category_idx" ON "Workout"("category");

-- CreateIndex
CREATE INDEX "Workout_bodyPart_idx" ON "Workout"("bodyPart");

-- CreateIndex
CREATE INDEX "Workout_difficulty_idx" ON "Workout"("difficulty");

-- CreateIndex
CREATE INDEX "Workout_trainingLocation_idx" ON "Workout"("trainingLocation");

-- CreateIndex
CREATE INDEX "UserWorkout_userId_idx" ON "UserWorkout"("userId");

-- CreateIndex
CREATE INDEX "UserWorkout_userId_status_idx" ON "UserWorkout"("userId", "status");

-- CreateIndex
CREATE INDEX "UserWorkoutItem_userWorkoutId_idx" ON "UserWorkoutItem"("userWorkoutId");

-- CreateIndex
CREATE INDEX "UserWorkoutItem_workoutId_idx" ON "UserWorkoutItem"("workoutId");

-- CreateIndex
CREATE INDEX "UserWorkoutItem_userWorkoutId_dayOfWeek_idx" ON "UserWorkoutItem"("userWorkoutId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "Nutrition_name_key" ON "Nutrition"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Nutrition_barcode_key" ON "Nutrition"("barcode");

-- CreateIndex
CREATE INDEX "Nutrition_name_idx" ON "Nutrition"("name");

-- CreateIndex
CREATE INDEX "Nutrition_category_idx" ON "Nutrition"("category");

-- CreateIndex
CREATE INDEX "Nutrition_barcode_idx" ON "Nutrition"("barcode");

-- CreateIndex
CREATE INDEX "UserMealLog_userId_idx" ON "UserMealLog"("userId");

-- CreateIndex
CREATE INDEX "UserMealLog_userId_day_month_year_idx" ON "UserMealLog"("userId", "day", "month", "year");

-- CreateIndex
CREATE INDEX "UserMealLog_mealType_idx" ON "UserMealLog"("mealType");

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Readiness" ADD CONSTRAINT "Readiness_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorkout" ADD CONSTRAINT "UserWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorkoutItem" ADD CONSTRAINT "UserWorkoutItem_userWorkoutId_fkey" FOREIGN KEY ("userWorkoutId") REFERENCES "UserWorkout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWorkoutItem" ADD CONSTRAINT "UserWorkoutItem_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMealLog" ADD CONSTRAINT "UserMealLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMealLog" ADD CONSTRAINT "UserMealLog_nutritionId_fkey" FOREIGN KEY ("nutritionId") REFERENCES "Nutrition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
