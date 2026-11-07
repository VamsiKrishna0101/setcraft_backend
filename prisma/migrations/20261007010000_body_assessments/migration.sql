CREATE TABLE "BodyAssessment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordedDate" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SAVED',
    "metrics" JSONB NOT NULL,
    "observations" JSONB NOT NULL,
    "quality" JSONB NOT NULL,
    "summary" TEXT,
    "method" TEXT NOT NULL,
    "analysisVersion" TEXT NOT NULL DEFAULT 'physique-v1',
    "modelVersion" TEXT,
    "heightCm" DOUBLE PRECISION,
    "gender" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BodyAssessment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BodyAssessment_status_check" CHECK ("status" IN ('REVIEW', 'SAVED'))
);
CREATE TABLE "BodyAssessmentPhoto" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "view" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "sha256" TEXT NOT NULL,
    CONSTRAINT "BodyAssessmentPhoto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BodyAssessmentPhoto_view_check" CHECK ("view" IN ('front', 'back', 'left', 'right'))
);
CREATE INDEX "BodyAssessment_userId_status_recordedDate_idx" ON "BodyAssessment"("userId", "status", "recordedDate");
CREATE UNIQUE INDEX "BodyAssessmentPhoto_assessmentId_view_key" ON "BodyAssessmentPhoto"("assessmentId", "view");
ALTER TABLE "BodyAssessment" ADD CONSTRAINT "BodyAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BodyAssessmentPhoto" ADD CONSTRAINT "BodyAssessmentPhoto_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "BodyAssessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
