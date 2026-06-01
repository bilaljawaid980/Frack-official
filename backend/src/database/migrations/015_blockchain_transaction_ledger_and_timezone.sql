-- Keep every observed Solana signature and store transaction timestamps as instants.

CREATE TABLE IF NOT EXISTS "BlockchainTransaction" (
  id TEXT PRIMARY KEY,
  "txHash" TEXT NOT NULL UNIQUE,
  "actionType" TEXT NOT NULL,
  "actorWallet" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "assetId" TEXT,
  "tokenContract" TEXT,
  metadata JSONB,
  "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BlockchainTransaction_occurredAt_idx"
  ON "BlockchainTransaction"("occurredAt");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_actionType_idx"
  ON "BlockchainTransaction"("actionType");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_assetId_idx"
  ON "BlockchainTransaction"("assetId");
CREATE INDEX IF NOT EXISTS "BlockchainTransaction_tokenContract_idx"
  ON "BlockchainTransaction"("tokenContract");

-- Existing timestamp-without-time-zone values were written in the local
-- Asia/Karachi database session. Convert them to their real UTC instants.
-- Asset deployment timestamps came from browser ISO strings and were UTC.
ALTER TABLE "Asset"
  ALTER COLUMN "deployedAt" TYPE TIMESTAMPTZ(3)
  USING "deployedAt" AT TIME ZONE 'UTC';

ALTER TABLE "ActivityLog"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3)
  USING "createdAt" AT TIME ZONE 'Asia/Karachi';

ALTER TABLE "TokenPurchaseRequest"
  ALTER COLUMN "kycApprovedAt" TYPE TIMESTAMPTZ(3) USING "kycApprovedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "amlApprovedAt" TYPE TIMESTAMPTZ(3) USING "amlApprovedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "issuerApprovedAt" TYPE TIMESTAMPTZ(3) USING "issuerApprovedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "whitelistedAt" TYPE TIMESTAMPTZ(3) USING "whitelistedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3) USING "activatedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "mintedAt" TYPE TIMESTAMPTZ(3) USING "mintedAt" AT TIME ZONE 'Asia/Karachi';

ALTER TABLE "TokenTransferRequest"
  ALTER COLUMN "kycClaimedAt" TYPE TIMESTAMPTZ(3) USING "kycClaimedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "amlClaimedAt" TYPE TIMESTAMPTZ(3) USING "amlClaimedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "whitelistedAt" TYPE TIMESTAMPTZ(3) USING "whitelistedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3) USING "activatedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "transferredAt" TYPE TIMESTAMPTZ(3) USING "transferredAt" AT TIME ZONE 'Asia/Karachi';

ALTER TABLE "TokenBuyIntent"
  ALTER COLUMN "kycClaimedAt" TYPE TIMESTAMPTZ(3) USING "kycClaimedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "amlClaimedAt" TYPE TIMESTAMPTZ(3) USING "amlClaimedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "whitelistedAt" TYPE TIMESTAMPTZ(3) USING "whitelistedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "activatedAt" TYPE TIMESTAMPTZ(3) USING "activatedAt" AT TIME ZONE 'Asia/Karachi',
  ALTER COLUMN "transferredAt" TYPE TIMESTAMPTZ(3) USING "transferredAt" AT TIME ZONE 'Asia/Karachi';

ALTER TABLE "TokenTransferHistory"
  ALTER COLUMN "createdAt" TYPE TIMESTAMPTZ(3)
  USING "createdAt" AT TIME ZONE 'Asia/Karachi';

INSERT INTO "BlockchainTransaction" (
  id,
  "txHash",
  "actionType",
  "actorWallet",
  "entityType",
  "entityId",
  "assetId",
  "tokenContract",
  "occurredAt"
)
SELECT md5(entries."txHash"), entries."txHash", entries."actionType",
       entries."actorWallet", entries."entityType", entries."entityId",
       entries."assetId", entries."tokenContract", entries."occurredAt"
FROM (
  SELECT "kycClaimTxHash" AS "txHash", 'PURCHASE_KYC_CLAIM' AS "actionType",
         "kycProvider" AS "actorWallet", 'token_purchase_request' AS "entityType",
         id AS "entityId", asset_id AS "assetId", "tokenContract",
         COALESCE("kycApprovedAt", CURRENT_TIMESTAMP) AS "occurredAt"
  FROM "TokenPurchaseRequest" WHERE "kycClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "amlClaimTxHash", 'PURCHASE_AML_CLAIM', "amlProvider",
         'token_purchase_request', id, asset_id, "tokenContract",
         COALESCE("amlApprovedAt", CURRENT_TIMESTAMP)
  FROM "TokenPurchaseRequest" WHERE "amlClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "whitelistTxHash", 'INVESTOR_WHITELISTED', "issuerWallet",
         'token_purchase_request', id, asset_id, "tokenContract",
         COALESCE("whitelistedAt", CURRENT_TIMESTAMP)
  FROM "TokenPurchaseRequest" WHERE "whitelistTxHash" IS NOT NULL
  UNION ALL
  SELECT "activationTxHash", 'IDENTITY_ACTIVATED', "issuerWallet",
         'token_purchase_request', id, asset_id, "tokenContract",
         COALESCE("activatedAt", CURRENT_TIMESTAMP)
  FROM "TokenPurchaseRequest" WHERE "activationTxHash" IS NOT NULL
  UNION ALL
  SELECT "mintTxHash", 'TOKENS_MINTED', "issuerWallet",
         'token_purchase_request', id, asset_id, "tokenContract",
         COALESCE("mintedAt", CURRENT_TIMESTAMP)
  FROM "TokenPurchaseRequest" WHERE "mintTxHash" IS NOT NULL
  UNION ALL
  SELECT "kycClaimTxHash", 'TRANSFER_ELIGIBILITY_KYC_CLAIM', "kycProvider",
         'token_transfer_request', id, asset_id, "tokenContract",
         COALESCE("kycClaimedAt", CURRENT_TIMESTAMP)
  FROM "TokenTransferRequest" WHERE "kycClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "amlClaimTxHash", 'TRANSFER_ELIGIBILITY_AML_CLAIM', "amlProvider",
         'token_transfer_request', id, asset_id, "tokenContract",
         COALESCE("amlClaimedAt", CURRENT_TIMESTAMP)
  FROM "TokenTransferRequest" WHERE "amlClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "whitelistTxHash", 'INVESTOR_WHITELISTED', "issuerWallet",
         'token_transfer_request', id, asset_id, "tokenContract",
         COALESCE("whitelistedAt", CURRENT_TIMESTAMP)
  FROM "TokenTransferRequest" WHERE "whitelistTxHash" IS NOT NULL
  UNION ALL
  SELECT "activationTxHash", 'IDENTITY_ACTIVATED', "issuerWallet",
         'token_transfer_request', id, asset_id, "tokenContract",
         COALESCE("activatedAt", CURRENT_TIMESTAMP)
  FROM "TokenTransferRequest" WHERE "activationTxHash" IS NOT NULL
  UNION ALL
  SELECT "transferTxHash", 'TOKEN_TRANSFER', "fromWallet",
         'token_transfer_request', id, asset_id, "tokenContract",
         COALESCE("transferredAt", CURRENT_TIMESTAMP)
  FROM "TokenTransferRequest" WHERE "transferTxHash" IS NOT NULL
  UNION ALL
  SELECT "kycClaimTxHash", 'TRANSFER_ELIGIBILITY_KYC_CLAIM', "kycProvider",
         'token_buy_intent', id, asset_id, "tokenContract",
         COALESCE("kycClaimedAt", CURRENT_TIMESTAMP)
  FROM "TokenBuyIntent" WHERE "kycClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "amlClaimTxHash", 'TRANSFER_ELIGIBILITY_AML_CLAIM', "amlProvider",
         'token_buy_intent', id, asset_id, "tokenContract",
         COALESCE("amlClaimedAt", CURRENT_TIMESTAMP)
  FROM "TokenBuyIntent" WHERE "amlClaimTxHash" IS NOT NULL
  UNION ALL
  SELECT "whitelistTxHash", 'INVESTOR_WHITELISTED', "issuerWallet",
         'token_buy_intent', id, asset_id, "tokenContract",
         COALESCE("whitelistedAt", CURRENT_TIMESTAMP)
  FROM "TokenBuyIntent" WHERE "whitelistTxHash" IS NOT NULL
  UNION ALL
  SELECT "activationTxHash", 'IDENTITY_ACTIVATED', "issuerWallet",
         'token_buy_intent', id, asset_id, "tokenContract",
         COALESCE("activatedAt", CURRENT_TIMESTAMP)
  FROM "TokenBuyIntent" WHERE "activationTxHash" IS NOT NULL
  UNION ALL
  SELECT "transferTxHash", 'MARKETPLACE_TRANSFER', "sellerWallet",
         'token_buy_intent', id, asset_id, "tokenContract",
         COALESCE("transferredAt", CURRENT_TIMESTAMP)
  FROM "TokenBuyIntent" WHERE "transferTxHash" IS NOT NULL
  UNION ALL
  SELECT metadata->>'txHash', 'TOKEN_DEPLOYED', "issuerWallet",
         'asset', id, id, "tokenContract",
         COALESCE("deployedAt", CURRENT_TIMESTAMP)
  FROM "Asset"
  WHERE metadata->>'txHash' IS NOT NULL
  UNION ALL
  SELECT "txHash", "actionType", "actorWallet",
         COALESCE("entityType", 'activity_log'), COALESCE("entityId", id),
         "assetId", NULL, "createdAt"
  FROM "ActivityLog" WHERE "txHash" IS NOT NULL
  UNION ALL
  SELECT "txHash", 'MARKETPLACE_TRANSFER', "fromWallet",
         'token_transfer_history', id, NULL, "tokenContract", "createdAt"
  FROM "TokenTransferHistory"
) entries
ON CONFLICT ("txHash") DO NOTHING;
