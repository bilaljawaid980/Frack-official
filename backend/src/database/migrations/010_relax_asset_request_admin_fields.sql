-- Migration: Relax admin-controlled asset request fields
-- Purpose: Issuers submit legal asset details only; platform admin sets valuation,
-- tokenomics, and compliance before deployment.

ALTER TABLE asset_requests
  ALTER COLUMN underlying_value DROP NOT NULL,
  ALTER COLUMN total_supply DROP NOT NULL,
  ALTER COLUMN decimals DROP NOT NULL,
  ALTER COLUMN initial_price DROP NOT NULL,
  ALTER COLUMN claim_topics SET DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN compliance_modules SET DEFAULT ARRAY[]::TEXT[];
