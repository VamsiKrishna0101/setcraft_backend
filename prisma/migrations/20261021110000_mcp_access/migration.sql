CREATE TABLE "McpAccessToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" VARCHAR(60) NOT NULL,
  "secretHash" VARCHAR(64) NOT NULL UNIQUE,
  "hashVersion" INTEGER NOT NULL DEFAULT 1,
  "lastFour" VARCHAR(4) NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "McpAccessToken_userId_revokedAt_expiresAt_idx" ON "McpAccessToken"("userId", "revokedAt", "expiresAt");
CREATE TABLE "McpAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenId" TEXT NOT NULL REFERENCES "McpAccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "action" VARCHAR(64) NOT NULL,
  "outcome" VARCHAR(32) NOT NULL,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "McpAuditEvent_userId_createdAt_idx" ON "McpAuditEvent"("userId", "createdAt");
CREATE INDEX "McpAuditEvent_createdAt_idx" ON "McpAuditEvent"("createdAt");
