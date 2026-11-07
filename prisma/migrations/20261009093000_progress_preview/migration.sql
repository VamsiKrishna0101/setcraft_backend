CREATE TABLE "ProgressPreviewDay" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "date" VARCHAR(10) NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressPreviewDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProgressPreviewDay_userId_date_key" ON "ProgressPreviewDay"("userId", "date");
ALTER TABLE "ProgressPreviewDay" ADD CONSTRAINT "ProgressPreviewDay_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
