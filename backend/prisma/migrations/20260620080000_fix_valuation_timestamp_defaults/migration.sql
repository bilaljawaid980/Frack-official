UPDATE "platform_valuers" SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;
UPDATE "asset_valuer_assignments" SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;
UPDATE "asset_valuations" SET "updated_at" = COALESCE("updated_at", "created_at", CURRENT_TIMESTAMP) WHERE "updated_at" IS NULL;

ALTER TABLE "platform_valuers" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "platform_valuers" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "platform_valuers" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "updated_at" SET NOT NULL;

ALTER TABLE "asset_valuations" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "asset_valuations" ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "asset_valuations" ALTER COLUMN "updated_at" SET NOT NULL;
