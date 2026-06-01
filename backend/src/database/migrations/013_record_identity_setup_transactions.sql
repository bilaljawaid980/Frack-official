-- Record the on-chain IRS setup transactions executed before minting or transfer.

ALTER TABLE "TokenPurchaseRequest"
  ADD COLUMN IF NOT EXISTS "whitelistTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "whitelistedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "activationTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMPTZ;

ALTER TABLE "TokenTransferRequest"
  ADD COLUMN IF NOT EXISTS "whitelistTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "whitelistedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "activationTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMPTZ;

ALTER TABLE "TokenBuyIntent"
  ADD COLUMN IF NOT EXISTS "whitelistTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "whitelistedAt" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "activationTxHash" TEXT,
  ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMPTZ;
