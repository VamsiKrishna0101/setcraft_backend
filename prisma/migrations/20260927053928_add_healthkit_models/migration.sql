-- CreateTable
CREATE TABLE "HealthKitSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sleepTotalMinutes" DOUBLE PRECISION,
    "sleepDeepMinutes" DOUBLE PRECISION,
    "sleepRemMinutes" DOUBLE PRECISION,
    "sleepCoreMinutes" DOUBLE PRECISION,
    "sleepEfficiency" DOUBLE PRECISION,
    "hrv" DOUBLE PRECISION,
    "restingHR" DOUBLE PRECISION,
    "avgDayHR" DOUBLE PRECISION,
    "activeCalories" DOUBLE PRECISION,
    "basalCalories" DOUBLE PRECISION,
    "steps" INTEGER,
    "flightsClimbed" INTEGER,
    "weight" DOUBLE PRECISION,
    "bodyFatPct" DOUBLE PRECISION,
    "leanMassKg" DOUBLE PRECISION,
    "vo2Max" DOUBLE PRECISION,
    "bloodOxygen" DOUBLE PRECISION,
    "respiratoryRate" DOUBLE PRECISION,
    "recoveryScore" DOUBLE PRECISION,
    "aiNote" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthKitSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthKitWorkout" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "workoutType" TEXT NOT NULL,
    "durationMinutes" DOUBLE PRECISION NOT NULL,
    "activeCalories" DOUBLE PRECISION NOT NULL,
    "totalDistance" DOUBLE PRECISION,
    "avgHeartRate" DOUBLE PRECISION,
    "maxHeartRate" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthKitWorkout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthKitSnapshot_userId_idx" ON "HealthKitSnapshot"("userId");

-- CreateIndex
CREATE INDEX "HealthKitSnapshot_userId_date_idx" ON "HealthKitSnapshot"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HealthKitSnapshot_userId_date_key" ON "HealthKitSnapshot"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "HealthKitWorkout_externalId_key" ON "HealthKitWorkout"("externalId");

-- CreateIndex
CREATE INDEX "HealthKitWorkout_userId_idx" ON "HealthKitWorkout"("userId");

-- CreateIndex
CREATE INDEX "HealthKitWorkout_userId_startedAt_idx" ON "HealthKitWorkout"("userId", "startedAt");

-- AddForeignKey
ALTER TABLE "HealthKitSnapshot" ADD CONSTRAINT "HealthKitSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthKitWorkout" ADD CONSTRAINT "HealthKitWorkout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
