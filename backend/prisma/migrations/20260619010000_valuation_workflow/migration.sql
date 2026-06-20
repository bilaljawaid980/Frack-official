CREATE TABLE IF NOT EXISTS "platform_valuers" (
  "id" TEXT NOT NULL,
  "organization_name" TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "fid_address" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "fid_tx_hash" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "suspended_at" TIMESTAMPTZ(3),
  "credentials" JSONB,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_valuers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_valuers_wallet_address_key" ON "platform_valuers"("wallet_address");
CREATE INDEX IF NOT EXISTS "platform_valuers_wallet_address_idx" ON "platform_valuers"("wallet_address");
CREATE INDEX IF NOT EXISTS "platform_valuers_fid_address_idx" ON "platform_valuers"("fid_address");
CREATE INDEX IF NOT EXISTS "platform_valuers_status_idx" ON "platform_valuers"("status");

CREATE TABLE IF NOT EXISTS "asset_valuer_assignments" (
  "id" TEXT NOT NULL,
  "asset_request_id" TEXT NOT NULL,
  "deployed_asset_id" TEXT,
  "factory_asset_id" INTEGER NOT NULL,
  "token_contract" TEXT NOT NULL,
  "asset_registry_address" TEXT NOT NULL,
  "tir_state_address" TEXT NOT NULL,
  "valuer_profile_id" TEXT NOT NULL,
  "valuer_wallet" TEXT NOT NULL,
  "valuer_fid" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
  "assigned_by" TEXT,
  "accepted_at" TIMESTAMPTZ(3),
  "tir_trust_tx_hash" TEXT,
  "tir_trusted_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "replaced_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_valuer_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_asset_request_id_idx" ON "asset_valuer_assignments"("asset_request_id");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_deployed_asset_id_idx" ON "asset_valuer_assignments"("deployed_asset_id");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_factory_asset_id_idx" ON "asset_valuer_assignments"("factory_asset_id");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_token_contract_idx" ON "asset_valuer_assignments"("token_contract");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_valuer_wallet_idx" ON "asset_valuer_assignments"("valuer_wallet");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_valuer_fid_idx" ON "asset_valuer_assignments"("valuer_fid");
CREATE INDEX IF NOT EXISTS "asset_valuer_assignments_status_idx" ON "asset_valuer_assignments"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "asset_valuer_assignments_one_active_per_asset_idx"
  ON "asset_valuer_assignments"("factory_asset_id")
  WHERE "status" IN ('ASSIGNED', 'ACCEPTED', 'ATTESTATION_PENDING', 'CONFIRMED');

CREATE TABLE IF NOT EXISTS "asset_valuations" (
  "id" TEXT NOT NULL,
  "assignment_id" TEXT NOT NULL,
  "asset_request_id" TEXT NOT NULL,
  "deployed_asset_id" TEXT,
  "factory_asset_id" INTEGER NOT NULL,
  "token_contract" TEXT NOT NULL,
  "asset_registry_address" TEXT NOT NULL,
  "valuer_wallet" TEXT NOT NULL,
  "valuer_fid" TEXT NOT NULL,
  "nav_raw" TEXT NOT NULL,
  "nav_currency" TEXT NOT NULL DEFAULT 'PKR',
  "nav_scale" INTEGER NOT NULL DEFAULT 2,
  "nav_date" TIMESTAMPTZ(3) NOT NULL,
  "nav_validity_days" INTEGER NOT NULL,
  "valid_until" TIMESTAMPTZ(3) NOT NULL,
  "methodology_hash" TEXT NOT NULL,
  "report_document_id" TEXT,
  "tx_hash" TEXT NOT NULL,
  "confirmed_slot" BIGINT,
  "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "asset_valuations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "asset_valuations_tx_hash_key" ON "asset_valuations"("tx_hash");
CREATE INDEX IF NOT EXISTS "asset_valuations_assignment_id_idx" ON "asset_valuations"("assignment_id");
CREATE INDEX IF NOT EXISTS "asset_valuations_asset_request_id_idx" ON "asset_valuations"("asset_request_id");
CREATE INDEX IF NOT EXISTS "asset_valuations_deployed_asset_id_idx" ON "asset_valuations"("deployed_asset_id");
CREATE INDEX IF NOT EXISTS "asset_valuations_factory_asset_id_idx" ON "asset_valuations"("factory_asset_id");
CREATE INDEX IF NOT EXISTS "asset_valuations_token_contract_idx" ON "asset_valuations"("token_contract");
CREATE INDEX IF NOT EXISTS "asset_valuations_valuer_wallet_idx" ON "asset_valuations"("valuer_wallet");
CREATE INDEX IF NOT EXISTS "asset_valuations_status_idx" ON "asset_valuations"("status");
CREATE INDEX IF NOT EXISTS "asset_valuations_valid_until_idx" ON "asset_valuations"("valid_until");