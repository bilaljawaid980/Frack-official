ALTER TABLE "TokenSellListing"
  ADD COLUMN IF NOT EXISTS "targetBuyerWallet" TEXT;

ALTER TABLE "TokenBuyIntent"
  ADD COLUMN IF NOT EXISTS "fullName" TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS nationality TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT,
  ADD COLUMN IF NOT EXISTS "idDocumentUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "proofOfAddressUrl" TEXT;

CREATE INDEX IF NOT EXISTS "TokenSellListing_targetBuyerWallet_idx"
  ON "TokenSellListing"("targetBuyerWallet");
