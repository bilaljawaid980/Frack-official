-- Store Solana fee/rent accounting separately from generic transaction metadata.

ALTER TABLE "BlockchainTransaction"
  ADD COLUMN IF NOT EXISTS "networkFeeLamports" BIGINT,
  ADD COLUMN IF NOT EXISTS "rentDepositLamports" BIGINT,
  ADD COLUMN IF NOT EXISTS "rentRefundLamports" BIGINT,
  ADD COLUMN IF NOT EXISTS "netSolChangeLamports" BIGINT;
