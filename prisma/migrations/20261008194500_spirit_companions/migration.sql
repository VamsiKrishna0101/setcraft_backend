ALTER TABLE "UserCompanion" ADD COLUMN "appearanceNoticePending" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "UserCompanion" ALTER COLUMN "species" SET DEFAULT 'SPIRIT_FOX';

UPDATE "UserCompanion"
SET "appearanceNoticePending" = true,
    "species" = CASE "species"
        WHEN 'SILVER_CAT' THEN 'SPIRIT_PANTHER'
        WHEN 'SILVER_RABBIT' THEN 'SPIRIT_DEER'
        WHEN 'SILVER_PANDA' THEN 'SPIRIT_PHOENIX'
        ELSE 'SPIRIT_FOX'
    END
WHERE "species" IN ('SILVER_FOX', 'SILVER_CAT', 'SILVER_RABBIT', 'SILVER_PANDA');
