-- Migration: Create asset_requests table
-- Purpose: Track off-chain issuer requests for new asset tokenization.

CREATE TABLE IF NOT EXISTS asset_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  issuer_wallet TEXT NOT NULL,
  legal_owner TEXT,
  reference_id TEXT,
  name TEXT NOT NULL,
  symbol TEXT NOT NULL,
  description TEXT,
  asset_type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  location TEXT,
  underlying_value DOUBLE PRECISION NOT NULL,
  total_supply INTEGER NOT NULL,
  decimals INTEGER NOT NULL DEFAULT 6,
  initial_price DOUBLE PRECISION NOT NULL,
  claim_topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  trusted_issuers JSONB,
  compliance_modules TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  documents JSONB,
  metadata JSONB,
  reviewed_at TIMESTAMPTZ,
  reviewed_by TEXT,
  rejection_reason TEXT,
  deployed_asset_id TEXT,
  tx_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asset_requests_status ON asset_requests(status);
CREATE INDEX IF NOT EXISTS idx_asset_requests_issuer_wallet ON asset_requests(issuer_wallet);
CREATE INDEX IF NOT EXISTS idx_asset_requests_created_at ON asset_requests(created_at);
