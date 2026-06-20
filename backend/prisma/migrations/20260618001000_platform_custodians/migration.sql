CREATE TABLE IF NOT EXISTS "platform_custodians" (
  "id" TEXT NOT NULL,
  "organization_name" TEXT NOT NULL,
  "wallet_address" TEXT NOT NULL,
  "fid_address" TEXT,
  "platform_authority_address" TEXT,
  "authority_topic" INTEGER NOT NULL DEFAULT 4,
  "status" TEXT NOT NULL DEFAULT 'REGISTERED',
  "fid_tx_hash" TEXT,
  "approval_tx_hash" TEXT,
  "approved_at" TIMESTAMPTZ(3),
  "suspended_at" TIMESTAMPTZ(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_custodians_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "platform_custodians_wallet_address_key"
  ON "platform_custodians"("wallet_address");
CREATE INDEX IF NOT EXISTS "platform_custodians_wallet_address_idx" ON "platform_custodians"("wallet_address");
CREATE INDEX IF NOT EXISTS "platform_custodians_fid_address_idx" ON "platform_custodians"("fid_address");
CREATE INDEX IF NOT EXISTS "platform_custodians_status_idx" ON "platform_custodians"("status");
