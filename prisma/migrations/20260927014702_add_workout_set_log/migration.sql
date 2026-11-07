-- CreateTable
CREATE TABLE "WorkoutSetLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userWorkoutItemId" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION,
    "reps" INTEGER NOT NULL,
    "rpe" DOUBLE PRECISION,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutSetLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutSetLog_userId_idx" ON "WorkoutSetLog"("userId");

-- CreateIndex
CREATE INDEX "WorkoutSetLog_userWorkoutItemId_idx" ON "WorkoutSetLog"("userWorkoutItemId");

-- CreateIndex
CREATE INDEX "WorkoutSetLog_userId_day_month_year_idx" ON "WorkoutSetLog"("userId", "day", "month", "year");

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_userWorkoutItemId_fkey" FOREIGN KEY ("userWorkoutItemId") REFERENCES "UserWorkoutItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
