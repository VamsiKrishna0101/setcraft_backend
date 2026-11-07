ALTER TABLE "BodyAssessmentPhoto" ALTER COLUMN "data" DROP NOT NULL;
ALTER TABLE "BodyAssessmentPhoto" ADD COLUMN "objectKey" TEXT, ADD COLUMN "bucket" TEXT;
CREATE UNIQUE INDEX "BodyAssessmentPhoto_objectKey_key" ON "BodyAssessmentPhoto"("objectKey");
CREATE TABLE "BodyPhotoDeletion" (
  "id" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "notBefore" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BodyPhotoDeletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BodyPhotoDeletion_bucket_objectKey_key" ON "BodyPhotoDeletion"("bucket", "objectKey");
CREATE INDEX "BodyPhotoDeletion_notBefore_idx" ON "BodyPhotoDeletion"("notBefore");
