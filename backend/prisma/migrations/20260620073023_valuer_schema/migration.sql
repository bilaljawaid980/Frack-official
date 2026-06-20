-- AlterTable
ALTER TABLE "asset_documents" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "asset_valuations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "asset_valuer_assignments" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "custody_attestations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "custody_mandates" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_custodians" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "platform_valuers" ALTER COLUMN "updated_at" DROP DEFAULT;
