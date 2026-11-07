-- Training setup can finish before optional body measurements are recorded.
ALTER TABLE "Onboarding" ALTER COLUMN "height" DROP NOT NULL, ALTER COLUMN "weight" DROP NOT NULL;
