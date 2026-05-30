CREATE TABLE IF NOT EXISTS "TokenSellListing" (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  "tokenContract" TEXT NOT NULL,
  "sellerWallet" TEXT NOT NULL,
  "amountBaseUnits" TEXT NOT NULL,
  "amountRemaining" TEXT NOT NULL,
  price DOUBLE PRECISION,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'LISTED',
  "settlementTerms" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "TokenBuyIntent" (
  id TEXT PRIMARY KEY,
  "listingId" TEXT NOT NULL,
  asset_id TEXT,
  "tokenContract" TEXT NOT NULL,
  "sellerWallet" TEXT NOT NULL,
  "buyerWallet" TEXT NOT NULL,
  "amountBaseUnits" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'BUYER_INTERESTED',
  required_claim_topics TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "kycProvider" TEXT,
  "amlProvider" TEXT,
  "issuerWallet" TEXT,
  "preflightFailure" TEXT,
  "simulationError" TEXT,
  "transferTxHash" TEXT,
  "transferredAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "rejectedAt" TIMESTAMP(3),
  "rejectedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "TokenTransferHistory" (
  id TEXT PRIMARY KEY,
  "listingId" TEXT,
  "buyIntentId" TEXT,
  "tokenContract" TEXT NOT NULL,
  "fromWallet" TEXT NOT NULL,
  "toWallet" TEXT NOT NULL,
  "amountBaseUnits" TEXT NOT NULL,
  "txHash" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'TRANSFERRED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TokenSellListing_asset_id_idx" ON "TokenSellListing"(asset_id);
CREATE INDEX IF NOT EXISTS "TokenSellListing_tokenContract_idx" ON "TokenSellListing"("tokenContract");
CREATE INDEX IF NOT EXISTS "TokenSellListing_sellerWallet_idx" ON "TokenSellListing"("sellerWallet");
CREATE INDEX IF NOT EXISTS "TokenSellListing_status_idx" ON "TokenSellListing"(status);
CREATE INDEX IF NOT EXISTS "TokenSellListing_expiresAt_idx" ON "TokenSellListing"("expiresAt");

CREATE INDEX IF NOT EXISTS "TokenBuyIntent_listingId_idx" ON "TokenBuyIntent"("listingId");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_asset_id_idx" ON "TokenBuyIntent"(asset_id);
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_tokenContract_idx" ON "TokenBuyIntent"("tokenContract");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_sellerWallet_idx" ON "TokenBuyIntent"("sellerWallet");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_buyerWallet_idx" ON "TokenBuyIntent"("buyerWallet");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_kycProvider_idx" ON "TokenBuyIntent"("kycProvider");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_amlProvider_idx" ON "TokenBuyIntent"("amlProvider");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_issuerWallet_idx" ON "TokenBuyIntent"("issuerWallet");
CREATE INDEX IF NOT EXISTS "TokenBuyIntent_status_idx" ON "TokenBuyIntent"(status);

CREATE INDEX IF NOT EXISTS "TokenTransferHistory_listingId_idx" ON "TokenTransferHistory"("listingId");
CREATE INDEX IF NOT EXISTS "TokenTransferHistory_buyIntentId_idx" ON "TokenTransferHistory"("buyIntentId");
CREATE INDEX IF NOT EXISTS "TokenTransferHistory_tokenContract_idx" ON "TokenTransferHistory"("tokenContract");
CREATE INDEX IF NOT EXISTS "TokenTransferHistory_fromWallet_idx" ON "TokenTransferHistory"("fromWallet");
CREATE INDEX IF NOT EXISTS "TokenTransferHistory_toWallet_idx" ON "TokenTransferHistory"("toWallet");
CREATE INDEX IF NOT EXISTS "TokenTransferHistory_txHash_idx" ON "TokenTransferHistory"("txHash");
