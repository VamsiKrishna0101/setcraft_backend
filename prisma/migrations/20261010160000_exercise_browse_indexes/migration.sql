CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Workout_catalog_search_trgm_idx" ON "Workout" USING GIN
((lower("name" || ' ' || COALESCE("namesByLang"::text, '') || ' ' || "bodyPart" || ' ' || COALESCE("target", '') || ' ' || "equipment" || ' ' || COALESCE("muscleGroup", ''))) gin_trgm_ops);

CREATE INDEX "Workout_bodyPart_equipment_name_id_idx" ON "Workout" ("bodyPart", "equipment", "name", "id");
CREATE INDEX "Workout_equipment_name_id_idx" ON "Workout" ("equipment", "name", "id");
CREATE INDEX "Workout_name_id_idx" ON "Workout" ("name", "id");
