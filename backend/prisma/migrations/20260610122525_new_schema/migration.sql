-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "walletAddress" TEXT,
    "roles" TEXT[],
    "requestedRole" TEXT,
    "roleStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "factoryAssetId" INTEGER,
    "tokenContract" TEXT NOT NULL,
    "referenceId" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "issuerWallet" TEXT,
    "legalOwner" TEXT,
    "metadata" JSONB,
    "deployedAt" TIMESTAMP(3),
    "lifecycleState" TEXT NOT NULL DEFAULT 'ISSUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_requests" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "issuer_wallet" TEXT NOT NULL,
    "legal_owner" TEXT,
    "reference_id" TEXT,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "description" TEXT,
    "asset_type" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "location" TEXT,
    "underlying_value" DOUBLE PRECISION,
    "total_supply" INTEGER,
    "decimals" INTEGER DEFAULT 6,
    "initial_price" DOUBLE PRECISION,
    "claim_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "trusted_issuers" JSONB,
    "compliance_modules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documents" JSONB,
    "metadata" JSONB,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "deployed_asset_id" TEXT,
    "tx_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenState" (
    "id" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "decimals" INTEGER NOT NULL,
    "totalSupply" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenAsset" (
    "id" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "assetId" INTEGER NOT NULL,
    "referenceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "legalOwner" TEXT NOT NULL,
    "metadata" JSONB,
    "totalTokenized" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenBalance" (
    "id" TEXT NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "balance" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssuanceRequest" (
    "id" TEXT NOT NULL,
    "requestId" INTEGER NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "assetId" INTEGER NOT NULL,
    "recipient" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "IssuanceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RedemptionRequest" (
    "id" TEXT NOT NULL,
    "requestId" INTEGER NOT NULL,
    "tokenContract" TEXT NOT NULL,
    "assetId" INTEGER NOT NULL,
    "requester" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "RedemptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceRule" (
    "id" TEXT NOT NULL,
    "allowedCountries" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransferLimit" (
    "id" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "limit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransferLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackedWallet" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackedWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexerState" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexerState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorWallet" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "assetId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" TEXT,
    "txHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdentitySnapshot" (
    "id" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "claimTopics" TEXT[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "country" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdentitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycApplication" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "email" TEXT,
    "fullName" TEXT NOT NULL,
    "dateOfBirth" TEXT,
    "nationality" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "idDocumentUrl" TEXT,
    "proofOfAddressUrl" TEXT,
    "selfieUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "onchainIdAddress" TEXT,
    "onchainIdCreated" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "riskScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KycApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedBy" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenPurchaseRequest" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT,
    "tokenContract" TEXT NOT NULL,
    "investorWallet" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "fullName" TEXT,
    "email" TEXT,
    "nationality" TEXT,
    "country" TEXT,
    "idDocumentUrl" TEXT,
    "proofOfAddressUrl" TEXT,
    "kycProvider" TEXT,
    "amlProvider" TEXT,
    "issuerWallet" TEXT,
    "required_claim_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "documents" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "kycApprovedAt" TIMESTAMP(3),
    "kycApprovedBy" TEXT,
    "kycClaimTxHash" TEXT,
    "amlApprovedAt" TIMESTAMP(3),
    "amlApprovedBy" TEXT,
    "amlClaimTxHash" TEXT,
    "issuerApprovedAt" TIMESTAMP(3),
    "issuerApprovedBy" TEXT,
    "mintTxHash" TEXT,
    "mintedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenPurchaseRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenTransferRequest" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT,
    "tokenContract" TEXT NOT NULL,
    "fromWallet" TEXT NOT NULL,
    "toWallet" TEXT NOT NULL,
    "amount" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "required_claim_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenTransferRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenSellListing" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT,
    "tokenContract" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "amountRemaining" TEXT NOT NULL,
    "price" DOUBLE PRECISION,
    "currency" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LISTED',
    "settlementTerms" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenSellListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenBuyIntent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "asset_id" TEXT,
    "tokenContract" TEXT NOT NULL,
    "sellerWallet" TEXT NOT NULL,
    "buyerWallet" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'BUYER_INTERESTED',
    "required_claim_topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenBuyIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenTransferHistory" (
    "id" TEXT NOT NULL,
    "listingId" TEXT,
    "buyIntentId" TEXT,
    "tokenContract" TEXT NOT NULL,
    "fromWallet" TEXT NOT NULL,
    "toWallet" TEXT NOT NULL,
    "amountBaseUnits" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'TRANSFERRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TokenTransferHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tokenContract_key" ON "Asset"("tokenContract");

-- CreateIndex
CREATE INDEX "asset_requests_status_idx" ON "asset_requests"("status");

-- CreateIndex
CREATE INDEX "asset_requests_issuer_wallet_idx" ON "asset_requests"("issuer_wallet");

-- CreateIndex
CREATE INDEX "asset_requests_created_at_idx" ON "asset_requests"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "TokenState_tokenContract_key" ON "TokenState"("tokenContract");

-- CreateIndex
CREATE UNIQUE INDEX "TokenAsset_tokenContract_assetId_key" ON "TokenAsset"("tokenContract", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "TokenBalance_tokenContract_walletAddress_key" ON "TokenBalance"("tokenContract", "walletAddress");

-- CreateIndex
CREATE INDEX "IssuanceRequest_tokenContract_idx" ON "IssuanceRequest"("tokenContract");

-- CreateIndex
CREATE INDEX "IssuanceRequest_status_idx" ON "IssuanceRequest"("status");

-- CreateIndex
CREATE INDEX "IssuanceRequest_requester_idx" ON "IssuanceRequest"("requester");

-- CreateIndex
CREATE INDEX "IssuanceRequest_recipient_idx" ON "IssuanceRequest"("recipient");

-- CreateIndex
CREATE UNIQUE INDEX "IssuanceRequest_tokenContract_requestId_key" ON "IssuanceRequest"("tokenContract", "requestId");

-- CreateIndex
CREATE INDEX "RedemptionRequest_tokenContract_idx" ON "RedemptionRequest"("tokenContract");

-- CreateIndex
CREATE INDEX "RedemptionRequest_status_idx" ON "RedemptionRequest"("status");

-- CreateIndex
CREATE INDEX "RedemptionRequest_requester_idx" ON "RedemptionRequest"("requester");

-- CreateIndex
CREATE UNIQUE INDEX "RedemptionRequest_tokenContract_requestId_key" ON "RedemptionRequest"("tokenContract", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TransferLimit_address_key" ON "TransferLimit"("address");

-- CreateIndex
CREATE UNIQUE INDEX "TrackedWallet_walletAddress_key" ON "TrackedWallet"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX "KycApplication_walletAddress_key" ON "KycApplication"("walletAddress");

-- CreateIndex
CREATE INDEX "KycApplication_walletAddress_idx" ON "KycApplication"("walletAddress");

-- CreateIndex
CREATE INDEX "KycApplication_status_idx" ON "KycApplication"("status");

-- CreateIndex
CREATE INDEX "KycApplication_submittedAt_idx" ON "KycApplication"("submittedAt");

-- CreateIndex
CREATE INDEX "KycDocument_applicationId_idx" ON "KycDocument"("applicationId");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_asset_id_idx" ON "TokenPurchaseRequest"("asset_id");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_tokenContract_idx" ON "TokenPurchaseRequest"("tokenContract");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_investorWallet_idx" ON "TokenPurchaseRequest"("investorWallet");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_kycProvider_idx" ON "TokenPurchaseRequest"("kycProvider");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_amlProvider_idx" ON "TokenPurchaseRequest"("amlProvider");

-- CreateIndex
CREATE INDEX "TokenPurchaseRequest_issuerWallet_idx" ON "TokenPurchaseRequest"("issuerWallet");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_tokenContract_idx" ON "TokenTransferRequest"("tokenContract");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_fromWallet_idx" ON "TokenTransferRequest"("fromWallet");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_toWallet_idx" ON "TokenTransferRequest"("toWallet");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_kycProvider_idx" ON "TokenTransferRequest"("kycProvider");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_amlProvider_idx" ON "TokenTransferRequest"("amlProvider");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_issuerWallet_idx" ON "TokenTransferRequest"("issuerWallet");

-- CreateIndex
CREATE INDEX "TokenTransferRequest_status_idx" ON "TokenTransferRequest"("status");

-- CreateIndex
CREATE INDEX "TokenSellListing_asset_id_idx" ON "TokenSellListing"("asset_id");

-- CreateIndex
CREATE INDEX "TokenSellListing_tokenContract_idx" ON "TokenSellListing"("tokenContract");

-- CreateIndex
CREATE INDEX "TokenSellListing_sellerWallet_idx" ON "TokenSellListing"("sellerWallet");

-- CreateIndex
CREATE INDEX "TokenSellListing_status_idx" ON "TokenSellListing"("status");

-- CreateIndex
CREATE INDEX "TokenSellListing_expiresAt_idx" ON "TokenSellListing"("expiresAt");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_listingId_idx" ON "TokenBuyIntent"("listingId");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_asset_id_idx" ON "TokenBuyIntent"("asset_id");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_tokenContract_idx" ON "TokenBuyIntent"("tokenContract");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_sellerWallet_idx" ON "TokenBuyIntent"("sellerWallet");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_buyerWallet_idx" ON "TokenBuyIntent"("buyerWallet");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_kycProvider_idx" ON "TokenBuyIntent"("kycProvider");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_amlProvider_idx" ON "TokenBuyIntent"("amlProvider");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_issuerWallet_idx" ON "TokenBuyIntent"("issuerWallet");

-- CreateIndex
CREATE INDEX "TokenBuyIntent_status_idx" ON "TokenBuyIntent"("status");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_listingId_idx" ON "TokenTransferHistory"("listingId");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_buyIntentId_idx" ON "TokenTransferHistory"("buyIntentId");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_tokenContract_idx" ON "TokenTransferHistory"("tokenContract");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_fromWallet_idx" ON "TokenTransferHistory"("fromWallet");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_toWallet_idx" ON "TokenTransferHistory"("toWallet");

-- CreateIndex
CREATE INDEX "TokenTransferHistory_txHash_idx" ON "TokenTransferHistory"("txHash");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
