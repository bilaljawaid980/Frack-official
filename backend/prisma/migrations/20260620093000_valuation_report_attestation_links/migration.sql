ALTER TABLE "asset_documents"
  ADD COLUMN IF NOT EXISTS "attestation_tx_hash" TEXT,
  ADD COLUMN IF NOT EXISTS "attested_at" TIMESTAMPTZ(3);

CREATE INDEX IF NOT EXISTS "asset_documents_attestation_tx_hash_idx" ON "asset_documents"("attestation_tx_hash");
CREATE INDEX IF NOT EXISTS "asset_documents_attested_at_idx" ON "asset_documents"("attested_at");