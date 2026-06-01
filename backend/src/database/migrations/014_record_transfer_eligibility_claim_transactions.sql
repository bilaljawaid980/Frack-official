-- Record KYC and AML claims issued while onboarding transfer recipients.

ALTER TABLE "TokenTransferRequest"
  ADD COLUMN IF NOT EXISTS "kycClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "kycClaimedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "amlClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "amlClaimedAt" TIMESTAMPTZ;

ALTER TABLE "TokenBuyIntent"
  ADD COLUMN IF NOT EXISTS "kycClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "kycClaimedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "amlClaimTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "amlClaimedAt" TIMESTAMPTZ;
