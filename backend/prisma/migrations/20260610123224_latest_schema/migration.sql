-- AlterTable
ALTER TABLE "ActivityLog" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "deployedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TokenBuyIntent" ADD COLUMN     "activatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "activationTxHash" TEXT,
ADD COLUMN     "amlClaimTxHash" TEXT,
ADD COLUMN     "amlClaimedAt" TIMESTAMPTZ(3),
ADD COLUMN     "country" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "fullName" TEXT,
ADD COLUMN     "idDocumentUrl" TEXT,
ADD COLUMN     "kycClaimTxHash" TEXT,
ADD COLUMN     "kycClaimedAt" TIMESTAMPTZ(3),
ADD COLUMN     "nationality" TEXT,
ADD COLUMN     "proofOfAddressUrl" TEXT,
ADD COLUMN     "whitelistTxHash" TEXT,
ADD COLUMN     "whitelistedAt" TIMESTAMPTZ(3),
ALTER COLUMN "transferredAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TokenPurchaseRequest" ADD COLUMN     "activatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "activationTxHash" TEXT,
ADD COLUMN     "whitelistTxHash" TEXT,
ADD COLUMN     "whitelistedAt" TIMESTAMPTZ(3),
ALTER COLUMN "kycApprovedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "amlApprovedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "issuerApprovedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "mintedAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TokenSellListing" ADD COLUMN     "targetBuyerWallet" TEXT;

-- AlterTable
ALTER TABLE "TokenTransferHistory" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "TokenTransferRequest" ADD COLUMN     "activatedAt" TIMESTAMPTZ(3),
ADD COLUMN     "activationTxHash" TEXT,
ADD COLUMN     "amlClaimTxHash" TEXT,
ADD COLUMN     "amlClaimedAt" TIMESTAMPTZ(3),
ADD COLUMN     "kycClaimTxHash" TEXT,
ADD COLUMN     "kycClaimedAt" TIMESTAMPTZ(3),
ADD COLUMN     "whitelistTxHash" TEXT,
ADD COLUMN     "whitelistedAt" TIMESTAMPTZ(3),
ALTER COLUMN "transferredAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "BlockchainTransaction" (
    "id" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actorWallet" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "assetId" TEXT,
    "tokenContract" TEXT,
    "metadata" JSONB,
    "networkFeeLamports" BIGINT,
    "rentDepositLamports" BIGINT,
    "rentRefundLamports" BIGINT,
    "netSolChangeLamports" BIGINT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockchainTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedIssuer" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "authorityName" TEXT NOT NULL,
    "kycAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "amlAuthorized" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedIssuer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainTransaction_txHash_key" ON "BlockchainTransaction"("txHash");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_occurredAt_idx" ON "BlockchainTransaction"("occurredAt");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_actionType_idx" ON "BlockchainTransaction"("actionType");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_assetId_idx" ON "BlockchainTransaction"("assetId");

-- CreateIndex
CREATE INDEX "BlockchainTransaction_tokenContract_idx" ON "BlockchainTransaction"("tokenContract");

-- CreateIndex
CREATE UNIQUE INDEX "TrustedIssuer_walletAddress_key" ON "TrustedIssuer"("walletAddress");

-- CreateIndex
CREATE INDEX "TrustedIssuer_authorityName_idx" ON "TrustedIssuer"("authorityName");

-- CreateIndex
CREATE INDEX "TrustedIssuer_kycAuthorized_idx" ON "TrustedIssuer"("kycAuthorized");

-- CreateIndex
CREATE INDEX "TrustedIssuer_amlAuthorized_idx" ON "TrustedIssuer"("amlAuthorized");

-- CreateIndex
CREATE INDEX "TokenSellListing_targetBuyerWallet_idx" ON "TokenSellListing"("targetBuyerWallet");
