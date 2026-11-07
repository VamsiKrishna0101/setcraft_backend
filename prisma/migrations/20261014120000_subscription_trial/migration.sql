ALTER TABLE "User" ADD COLUMN "trialStartedAt" TIMESTAMP(3), ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "NotificationPreference" ADD COLUMN "billing" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Subscription" ALTER COLUMN "planPriceId" DROP NOT NULL;
ALTER TABLE "Subscription" ADD COLUMN "storeProductId" TEXT, ADD COLUMN "storeBasePlanId" TEXT,
  ADD COLUMN "storeCountryCode" TEXT, ADD COLUMN "verifiedAt" TIMESTAMP(3);
