CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Nutrition_global_category_name_idx" ON "Nutrition" (category, name, id) WHERE "userId" IS NULL;
CREATE INDEX IF NOT EXISTS "Nutrition_owner_name_idx" ON "Nutrition" ("userId", name, id);
CREATE INDEX IF NOT EXISTS "Nutrition_name_trgm_idx" ON "Nutrition" USING GIN (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Nutrition_brand_trgm_idx" ON "Nutrition" USING GIN (brand gin_trgm_ops);
