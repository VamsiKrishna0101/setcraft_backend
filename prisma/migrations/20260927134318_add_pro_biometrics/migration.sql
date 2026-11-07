-- CreateEnum
CREATE TYPE "CyclePhase" AS ENUM ('MENSTRUAL', 'FOLLICULAR', 'OVULATORY', 'LUTEAL');

-- CreateEnum
CREATE TYPE "HeartRateZone" AS ENUM ('ZONE_1_RECOVERY', 'ZONE_2_AEROBIC', 'ZONE_3_TEMPO', 'ZONE_4_THRESHOLD', 'ZONE_5_MAX');

-- AlterTable
ALTER TABLE "HealthKitSnapshot" ADD COLUMN     "bloodGlucoseAvg" DOUBLE PRECISION,
ADD COLUMN     "cardioRecoveryHr" DOUBLE PRECISION,
ADD COLUMN     "cyclePhase" "CyclePhase",
ADD COLUMN     "healthAge" DOUBLE PRECISION,
ADD COLUMN     "wristTempDeviation" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "HealthKitWorkout" ADD COLUMN     "avgWatts" DOUBLE PRECISION,
ADD COLUMN     "elevationAscent" DOUBLE PRECISION,
ADD COLUMN     "hrZone1Minutes" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "hrZone2Minutes" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "hrZone3Minutes" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "hrZone4Minutes" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "hrZone5Minutes" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "UserMealLog" ADD COLUMN     "caffeineMg" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "sodiumMg" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UserWaterLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMl" INTEGER NOT NULL,
    "day" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWaterLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPrivacyConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "healthKitBiometrics" BOOLEAN NOT NULL DEFAULT true,
    "cycleTrackingConsent" BOOLEAN NOT NULL DEFAULT false,
    "analyticsConsent" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserPrivacyConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserWaterLog_userId_idx" ON "UserWaterLog"("userId");

-- CreateIndex
CREATE INDEX "UserWaterLog_userId_day_month_year_idx" ON "UserWaterLog"("userId", "day", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "UserPrivacyConsent_userId_key" ON "UserPrivacyConsent"("userId");

-- AddForeignKey
ALTER TABLE "UserWaterLog" ADD CONSTRAINT "UserWaterLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPrivacyConsent" ADD CONSTRAINT "UserPrivacyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
