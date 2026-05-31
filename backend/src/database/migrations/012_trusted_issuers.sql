CREATE TABLE IF NOT EXISTS "TrustedIssuer" (
  id TEXT PRIMARY KEY,
  "walletAddress" TEXT NOT NULL UNIQUE,
  "authorityName" TEXT NOT NULL,
  "kycAuthorized" BOOLEAN NOT NULL DEFAULT FALSE,
  "amlAuthorized" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "TrustedIssuer_authorityName_idx"
  ON "TrustedIssuer"("authorityName");

CREATE INDEX IF NOT EXISTS "TrustedIssuer_kycAuthorized_idx"
  ON "TrustedIssuer"("kycAuthorized");

CREATE INDEX IF NOT EXISTS "TrustedIssuer_amlAuthorized_idx"
  ON "TrustedIssuer"("amlAuthorized");
