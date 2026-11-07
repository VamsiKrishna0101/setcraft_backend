ALTER TABLE "UserWorkout" ADD COLUMN "scheduledDate" TEXT;
CREATE UNIQUE INDEX "UserWorkout_userId_scheduledDate_key" ON "UserWorkout"("userId", "scheduledDate");
