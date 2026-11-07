CREATE TABLE "AcquisitionResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" VARCHAR(32),
    "detail" VARCHAR(100),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AcquisitionResponse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AcquisitionResponse_userId_key" ON "AcquisitionResponse"("userId");
ALTER TABLE "AcquisitionResponse" ADD CONSTRAINT "AcquisitionResponse_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
