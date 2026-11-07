-- CreateTable
CREATE TABLE "UserCompanion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(20) NOT NULL DEFAULT 'Lumi',
    "species" TEXT NOT NULL DEFAULT 'SILVER_FOX',
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserCompanion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanionReward" (
    "id" TEXT NOT NULL,
    "companionId" TEXT NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "quest" VARCHAR(20) NOT NULL,
    "xp" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionReward_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserCompanion_userId_key" ON "UserCompanion"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CompanionReward_companionId_date_quest_key" ON "CompanionReward"("companionId", "date", "quest");

-- AddForeignKey
ALTER TABLE "UserCompanion" ADD CONSTRAINT "UserCompanion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanionReward" ADD CONSTRAINT "CompanionReward_companionId_fkey" FOREIGN KEY ("companionId") REFERENCES "UserCompanion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
