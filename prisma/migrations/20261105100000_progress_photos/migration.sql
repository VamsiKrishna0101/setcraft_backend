CREATE TABLE "ProgressPhoto" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "recordedDate" TEXT NOT NULL,
  "workoutDate" TEXT,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "thumbnailKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressPhoto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressPhoto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProgressPhoto_objectKey_key" ON "ProgressPhoto"("objectKey");
CREATE UNIQUE INDEX "ProgressPhoto_thumbnailKey_key" ON "ProgressPhoto"("thumbnailKey");
CREATE INDEX "ProgressPhoto_userId_recordedDate_createdAt_idx" ON "ProgressPhoto"("userId", "recordedDate", "createdAt");
