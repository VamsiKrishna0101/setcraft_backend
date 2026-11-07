ALTER TABLE "WorkoutSetLog" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "WorkoutSetLog_clientKey_key" ON "WorkoutSetLog"("clientKey");

CREATE TABLE "WorkoutSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Workout',
  "status" "WorkStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "userWorkoutId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "durationSeconds" INTEGER,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WorkoutSession_userWorkoutId_fkey" FOREIGN KEY ("userWorkoutId") REFERENCES "UserWorkout"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkoutSession_userId_date_key" ON "WorkoutSession"("userId", "date");
CREATE UNIQUE INDEX "WorkoutSession_userWorkoutId_key" ON "WorkoutSession"("userWorkoutId");
CREATE INDEX "WorkoutSession_userId_status_idx" ON "WorkoutSession"("userId", "status");

CREATE TABLE "WorkoutRoutine" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkoutRoutine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutRoutine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WorkoutRoutine_userId_idx" ON "WorkoutRoutine"("userId");

CREATE TABLE "WorkoutDay" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "name" TEXT NOT NULL DEFAULT 'Workout',
  "restDay" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "WorkoutDay_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WorkoutDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WorkoutDay_userId_date_key" ON "WorkoutDay"("userId", "date");
