DROP INDEX "Nutrition_name_userId_key";
CREATE INDEX "Nutrition_name_userId_idx" ON "Nutrition"("name", "userId");
