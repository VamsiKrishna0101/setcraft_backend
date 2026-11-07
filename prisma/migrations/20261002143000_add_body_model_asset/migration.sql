CREATE TABLE "body_model_assets" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL DEFAULT 'model/gltf-binary',
    "model_data" BYTEA NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "body_model_assets_pkey" PRIMARY KEY ("id")
);
