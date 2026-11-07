CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "workouts" BOOLEAN NOT NULL DEFAULT true,
  "plans" BOOLEAN NOT NULL DEFAULT true,
  "checkIns" BOOLEAN NOT NULL DEFAULT false,
  "summaries" BOOLEAN NOT NULL DEFAULT false,
  "meals" BOOLEAN NOT NULL DEFAULT false,
  "workoutTime" TEXT NOT NULL DEFAULT '18:00',
  "checkInTime" TEXT NOT NULL DEFAULT '09:00',
  "summaryTime" TEXT NOT NULL DEFAULT '18:00',
  "mealTime" TEXT NOT NULL DEFAULT '12:30',
  "mealType" "MealType" NOT NULL DEFAULT 'LUNCH',
  "quietStart" TEXT NOT NULL DEFAULT '22:00',
  "quietEnd" TEXT NOT NULL DEFAULT '08:00',
  "timezone" TEXT NOT NULL DEFAULT 'UTC',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "installationId" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "foregroundUntil" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationDevice_installationId_key" ON "NotificationDevice"("installationId");
CREATE UNIQUE INDEX "NotificationDevice_token_key" ON "NotificationDevice"("token");
CREATE INDEX "NotificationDevice_userId_lastSeenAt_idx" ON "NotificationDevice"("userId", "lastSeenAt");

CREATE TABLE "NotificationJob" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "eventKey" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "targetId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "routine" BOOLEAN NOT NULL DEFAULT true,
  "deviceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "leaseUntil" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationJob_userId_eventKey_key" ON "NotificationJob"("userId", "eventKey");
CREATE INDEX "NotificationJob_status_nextAttemptAt_idx" ON "NotificationJob"("status", "nextAttemptAt");
CREATE INDEX "NotificationJob_userId_date_routine_sentAt_idx" ON "NotificationJob"("userId", "date", "routine", "sentAt");
