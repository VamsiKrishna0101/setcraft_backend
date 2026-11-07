-- BodyScan is present in the Prisma schema but was not created by the
-- repository's original migration set. Create it for fresh databases, while
-- retaining compatibility with databases where it was created with db push.
CREATE TABLE IF NOT EXISTS "BodyScan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scanDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scanSource" TEXT NOT NULL DEFAULT 'legacy',
    "heightCm" DOUBLE PRECISION,
    "viewsUsed" INTEGER,
    "frontImageUrl" TEXT,
    "rightImageUrl" TEXT,
    "backImageUrl" TEXT,
    "leftImageUrl" TEXT,
    "fullModelGlbUrl" TEXT,
    "heatmapGlbUrl" TEXT,
    "deltaGlbUrl" TEXT,
    "betas" JSONB,
    "rawVertices" JSONB,
    "chestCircumference" DOUBLE PRECISION,
    "waistCircumference" DOUBLE PRECISION,
    "hipCircumference" DOUBLE PRECISION,
    "bicepLeftCircumference" DOUBLE PRECISION,
    "bicepRightCircumference" DOUBLE PRECISION,
    "thighLeftCircumference" DOUBLE PRECISION,
    "thighRightCircumference" DOUBLE PRECISION,
    "shoulderWidth" DOUBLE PRECISION,
    "overallSymmetryScore" DOUBLE PRECISION,
    "vTaperRatio" DOUBLE PRECISION,
    "laggingMuscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "strongMuscles" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "previousScanId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BodyScan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BodyScan"
    ADD COLUMN IF NOT EXISTS "scanSource" TEXT NOT NULL DEFAULT 'legacy',
    ADD COLUMN IF NOT EXISTS "heightCm" DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS "viewsUsed" INTEGER;

CREATE INDEX IF NOT EXISTS "BodyScan_userId_idx" ON "BodyScan"("userId");
CREATE INDEX IF NOT EXISTS "BodyScan_scanDate_idx" ON "BodyScan"("scanDate");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'BodyScan_userId_fkey'
    ) THEN
        ALTER TABLE "BodyScan"
            ADD CONSTRAINT "BodyScan_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
