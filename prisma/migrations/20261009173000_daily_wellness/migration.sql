CREATE TABLE "DailyWellnessEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "sleepMinutes" INTEGER NOT NULL,
    "energy" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DailyWellnessEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DailyWellnessEntry_sleep_check" CHECK ("sleepMinutes" BETWEEN 0 AND 1440),
    CONSTRAINT "DailyWellnessEntry_energy_check" CHECK ("energy" BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX "DailyWellnessEntry_userId_date_key" ON "DailyWellnessEntry"("userId", "date");
CREATE INDEX "DailyWellnessEntry_userId_date_idx" ON "DailyWellnessEntry"("userId", "date");
ALTER TABLE "DailyWellnessEntry" ADD CONSTRAINT "DailyWellnessEntry_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
