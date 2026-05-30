-- Migration: Extend token purchase requests for investor compliance workflow.

ALTER TABLE "TokenPurchaseRequest"
  ADD COLUMN IF NOT EXISTS asset_id TEXT,
  ADD COLUMN IF NOT EXISTS required_claim_topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS documents JSONB,
  ADD COLUMN IF NOT EXISTS "kycApprovedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "kycClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "amlApprovedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "amlClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerApprovedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "issuerApprovedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "mintTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "mintedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "rejectedBy" TEXT;

CREATE INDEX IF NOT EXISTS "TokenPurchaseRequest_asset_id_idx"
  ON "TokenPurchaseRequest"(asset_id);
