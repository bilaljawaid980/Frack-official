CREATE TABLE IF NOT EXISTS "TokenTransferRequest" (
  id TEXT PRIMARY KEY,
  asset_id TEXT,
  "tokenContract" TEXT NOT NULL,
  "fromWallet" TEXT NOT NULL,
  "toWallet" TEXT NOT NULL,
  amount DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'DRAFT',
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

CREATE INDEX IF NOT EXISTS "TokenTransferRequest_tokenContract_idx" ON "TokenTransferRequest"("tokenContract");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_fromWallet_idx" ON "TokenTransferRequest"("fromWallet");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_toWallet_idx" ON "TokenTransferRequest"("toWallet");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_kycProvider_idx" ON "TokenTransferRequest"("kycProvider");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_amlProvider_idx" ON "TokenTransferRequest"("amlProvider");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_issuerWallet_idx" ON "TokenTransferRequest"("issuerWallet");
CREATE INDEX IF NOT EXISTS "TokenTransferRequest_status_idx" ON "TokenTransferRequest"(status);
