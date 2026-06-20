-- AlterTable
ALTER TABLE "asset_valuations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_valuers" ALTER COLUMN "updated_at" DROP DEFAULT;
