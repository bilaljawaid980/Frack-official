ALTER TABLE "asset_requests"
  ADD COLUMN IF NOT EXISTS "factory_asset_id" INTEGER;

CREATE TABLE IF NOT EXISTS "custody_mandates" (
  "id" TEXT NOT NULL,
  "asset_request_id" TEXT NOT NULL,
  "factory_asset_id" INTEGER NOT NULL,
  "issuer_wallet" TEXT NOT NULL,
  "issuer_fid" TEXT NOT NULL,
  "custodian_wallet" TEXT NOT NULL,
  "custodian_fid" TEXT NOT NULL,
  "mandate_address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "create_tx_hash" TEXT,
  "accept_tx_hash" TEXT,
  "release_tx_hash" TEXT,
  "accepted_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custody_mandates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custody_mandates_asset_request_id_fkey" FOREIGN KEY ("asset_request_id") REFERENCES "asset_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "custody_mandates_asset_request_id_custodian_wallet_key"
  ON "custody_mandates"("asset_request_id", "custodian_wallet");
CREATE INDEX IF NOT EXISTS "custody_mandates_factory_asset_id_idx" ON "custody_mandates"("factory_asset_id");
CREATE INDEX IF NOT EXISTS "custody_mandates_custodian_wallet_idx" ON "custody_mandates"("custodian_wallet");
CREATE INDEX IF NOT EXISTS "custody_mandates_status_idx" ON "custody_mandates"("status");

CREATE TABLE IF NOT EXISTS "custody_attestations" (
  "id" TEXT NOT NULL,
  "mandate_id" TEXT NOT NULL,
  "factory_asset_id" INTEGER NOT NULL,
  "attestation_address" TEXT NOT NULL,
  "document_hash" TEXT NOT NULL,
  "attestation_hash" TEXT NOT NULL,
  "reserve_ratio_bps" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "tx_hash" TEXT NOT NULL,
  "attested_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "custody_attestations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "custody_attestations_mandate_id_fkey" FOREIGN KEY ("mandate_id") REFERENCES "custody_mandates"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "custody_attestations_attestation_address_tx_hash_key"
  ON "custody_attestations"("attestation_address", "tx_hash");
CREATE INDEX IF NOT EXISTS "custody_attestations_mandate_id_idx" ON "custody_attestations"("mandate_id");
CREATE INDEX IF NOT EXISTS "custody_attestations_factory_asset_id_idx" ON "custody_attestations"("factory_asset_id");
CREATE INDEX IF NOT EXISTS "custody_attestations_status_idx" ON "custody_attestations"("status");
