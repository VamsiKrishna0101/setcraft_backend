CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED');
CREATE TYPE "SupportTicketCategory" AS ENUM ('ACCOUNT', 'BILLING', 'WORKOUTS', 'NUTRITION', 'PRIVACY', 'BUG', 'OTHER');
ALTER TABLE "UserPrivacyConsent"
 ADD COLUMN "aiPlanningConsent" BOOLEAN NOT NULL DEFAULT false,
 ADD COLUMN "aiPlanningPolicyVersion" TEXT,
 ADD COLUMN "aiPlanningAcceptedAt" TIMESTAMP(3),
 ADD COLUMN "aiPlanningWithdrawnAt" TIMESTAMP(3);
CREATE TABLE "SupportTicket" (
 "id" TEXT PRIMARY KEY, "number" SERIAL NOT NULL UNIQUE, "userId" TEXT NOT NULL,
 "assignedToId" TEXT, "category" "SupportTicketCategory" NOT NULL,
 "subject" VARCHAR(120) NOT NULL, "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
 "version" INTEGER NOT NULL DEFAULT 1, "clientRequestId" VARCHAR(36) NOT NULL,
 "requestHash" VARCHAR(64) NOT NULL, "diagnostics" JSONB,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SupportTicket_userId_clientRequestId_key" ON "SupportTicket"("userId", "clientRequestId");
CREATE INDEX "SupportTicket_userId_updatedAt_idx" ON "SupportTicket"("userId", "updatedAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status", "updatedAt");
CREATE INDEX "SupportTicket_assignedToId_status_idx" ON "SupportTicket"("assignedToId", "status");
CREATE TABLE "SupportMessage" (
 "id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL, "authorId" TEXT, "authorRole" "Role" NOT NULL,
 "body" VARCHAR(4000) NOT NULL, "internal" BOOLEAN NOT NULL DEFAULT false,
 "requestKey" VARCHAR(64) NOT NULL UNIQUE, "requestHash" VARCHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "SupportMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");
CREATE TABLE "SupportAttachment" (
 "id" TEXT PRIMARY KEY, "messageId" TEXT NOT NULL, "mimeType" VARCHAR(30) NOT NULL,
 "byteLength" INTEGER NOT NULL CHECK ("byteLength" > 0 AND "byteLength" <= 1048576),
 "data" BYTEA NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SupportAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "SupportMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SupportAttachment_messageId_idx" ON "SupportAttachment"("messageId");
CREATE TABLE "PrivacyConsentEvent" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "scope" VARCHAR(40) NOT NULL,
 "granted" BOOLEAN NOT NULL, "policyVersion" VARCHAR(80) NOT NULL, "provider" VARCHAR(100) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "PrivacyConsentEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PrivacyConsentEvent_userId_createdAt_idx" ON "PrivacyConsentEvent"("userId", "createdAt");
