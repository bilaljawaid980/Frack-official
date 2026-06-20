-- Add normalized legal/public document metadata for asset requests.

DO $$ BEGIN
  CREATE TYPE "DocumentType" AS ENUM (
    'FARD',
    'SALE_DEED',
    'MUTATION_RECORD',
    'SPV_REGISTRATION',
    'LEGAL_OPINION',
    'WHITEPAPER',
    'INSURANCE_POLICY',
    'VALUATION_REPORT',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "asset_documents" (
  "id" TEXT NOT NULL,
  "asset_request_id" TEXT NOT NULL,
  "factory_asset_id" INTEGER,
  "deployed_asset_id" TEXT,
  "type" "DocumentType" NOT NULL,
  "visibility" "DocumentVisibility" NOT NULL DEFAULT 'PRIVATE',
  "bucket" TEXT NOT NULL DEFAULT 'legal-docs',
  "storage_key" TEXT NOT NULL,
  "file_hash" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "uploaded_by_id" TEXT,
  "uploaded_by_wallet" TEXT,
  "verified_at" TIMESTAMPTZ(3),
  "verified_by_id" TEXT,
  "deleted_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "uploaded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "asset_documents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "asset_documents_asset_request_id_fkey"
    FOREIGN KEY ("asset_request_id") REFERENCES "asset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_documents_asset_request_id_storage_key_key"
  ON "asset_documents"("asset_request_id", "storage_key");
CREATE INDEX IF NOT EXISTS "asset_documents_asset_request_id_idx" ON "asset_documents"("asset_request_id");
CREATE INDEX IF NOT EXISTS "asset_documents_factory_asset_id_idx" ON "asset_documents"("factory_asset_id");
CREATE INDEX IF NOT EXISTS "asset_documents_deployed_asset_id_idx" ON "asset_documents"("deployed_asset_id");
CREATE INDEX IF NOT EXISTS "asset_documents_type_idx" ON "asset_documents"("type");
CREATE INDEX IF NOT EXISTS "asset_documents_visibility_idx" ON "asset_documents"("visibility");
CREATE INDEX IF NOT EXISTS "asset_documents_deleted_at_idx" ON "asset_documents"("deleted_at");
