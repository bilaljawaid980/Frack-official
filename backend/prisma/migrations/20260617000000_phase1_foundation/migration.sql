-- Phase 1 foundation migration.
-- Additive only: no table drops, no data deletes, no destructive column changes.

CREATE TABLE IF NOT EXISTS "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OrganizationMember" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "memberRole" TEXT NOT NULL,
  "invitedBy" TEXT,
  "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "WalletAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "publicKey" TEXT NOT NULL,
  "network" TEXT NOT NULL,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "label" TEXT,
  "verifiedAt" TIMESTAMPTZ(3),
  "lastChallengeAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OrganizationWallet" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "walletAccountId" TEXT NOT NULL,
  "purpose" TEXT,
  "isAuthorizedSignatory" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "validFrom" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationWallet_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationWallet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OrganizationWallet_walletAccountId_fkey" FOREIGN KEY ("walletAccountId") REFERENCES "WalletAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PlatformRoleAssignment" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "grantedBy" TEXT,
  "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMPTZ(3),
  "revokedBy" TEXT,
  "reason" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformRoleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PlatformRoleAssignment_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "PlatformRoleAssignment_revokedBy_fkey" FOREIGN KEY ("revokedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "OnChainAuthorityBinding" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "fidAddress" TEXT,
  "authorityType" TEXT NOT NULL,
  "tokenContract" TEXT,
  "txHash" TEXT,
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "confirmedAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OnChainAuthorityBinding_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "WorkflowTransition" (
  "id" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT NOT NULL,
  "actorWallet" TEXT,
  "actorUserId" TEXT,
  "txHash" TEXT,
  "reason" TEXT,
  "metadata" JSONB,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkflowTransition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorWallet" TEXT,
  "organizationId" TEXT,
  "action" TEXT NOT NULL,
  "resourceType" TEXT,
  "resourceId" TEXT,
  "requestId" TEXT,
  "correlationId" TEXT,
  "ipAddressHash" TEXT,
  "userAgentHash" TEXT,
  "before" JSONB,
  "after" JSONB,
  "result" TEXT NOT NULL,
  "failureCode" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "OutboxEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "aggregateType" TEXT NOT NULL,
  "aggregateId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMPTZ(3),
  "processedAt" TIMESTAMPTZ(3),
  "lastError" TEXT,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "network" TEXT NOT NULL DEFAULT 'devnet',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BlockchainTransaction" ADD COLUMN IF NOT EXISTS "network" TEXT NOT NULL DEFAULT 'devnet';
ALTER TABLE "TrustedIssuer" ADD COLUMN IF NOT EXISTS "fidAddress" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "WalletAccount_publicKey_network_key" ON "WalletAccount"("publicKey", "network");
CREATE UNIQUE INDEX IF NOT EXISTS "BlockchainTransaction_network_txHash_key" ON "BlockchainTransaction"("network", "txHash");

CREATE INDEX IF NOT EXISTS "Organization_type_idx" ON "Organization"("type");
CREATE INDEX IF NOT EXISTS "Organization_status_idx" ON "Organization"("status");
CREATE INDEX IF NOT EXISTS "Organization_environment_idx" ON "Organization"("environment");
CREATE INDEX IF NOT EXISTS "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE INDEX IF NOT EXISTS "OrganizationMember_memberRole_idx" ON "OrganizationMember"("memberRole");
CREATE INDEX IF NOT EXISTS "WalletAccount_userId_idx" ON "WalletAccount"("userId");
CREATE INDEX IF NOT EXISTS "WalletAccount_publicKey_idx" ON "WalletAccount"("publicKey");
CREATE INDEX IF NOT EXISTS "WalletAccount_status_idx" ON "WalletAccount"("status");
CREATE INDEX IF NOT EXISTS "OrganizationWallet_organizationId_idx" ON "OrganizationWallet"("organizationId");
CREATE INDEX IF NOT EXISTS "OrganizationWallet_walletAccountId_idx" ON "OrganizationWallet"("walletAccountId");
CREATE INDEX IF NOT EXISTS "OrganizationWallet_status_idx" ON "OrganizationWallet"("status");
CREATE INDEX IF NOT EXISTS "PlatformRoleAssignment_walletAddress_idx" ON "PlatformRoleAssignment"("walletAddress");
CREATE INDEX IF NOT EXISTS "PlatformRoleAssignment_role_idx" ON "PlatformRoleAssignment"("role");
CREATE INDEX IF NOT EXISTS "PlatformRoleAssignment_revokedAt_idx" ON "PlatformRoleAssignment"("revokedAt");
CREATE INDEX IF NOT EXISTS "PlatformRoleAssignment_environment_idx" ON "PlatformRoleAssignment"("environment");
CREATE INDEX IF NOT EXISTS "OnChainAuthorityBinding_walletAddress_idx" ON "OnChainAuthorityBinding"("walletAddress");
CREATE INDEX IF NOT EXISTS "OnChainAuthorityBinding_tokenContract_idx" ON "OnChainAuthorityBinding"("tokenContract");
CREATE INDEX IF NOT EXISTS "OnChainAuthorityBinding_authorityType_idx" ON "OnChainAuthorityBinding"("authorityType");
CREATE INDEX IF NOT EXISTS "OnChainAuthorityBinding_network_idx" ON "OnChainAuthorityBinding"("network");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_entityType_entityId_idx" ON "WorkflowTransition"("entityType", "entityId");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_actorWallet_idx" ON "WorkflowTransition"("actorWallet");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_createdAt_idx" ON "WorkflowTransition"("createdAt");
CREATE INDEX IF NOT EXISTS "WorkflowTransition_environment_idx" ON "WorkflowTransition"("environment");
CREATE INDEX IF NOT EXISTS "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");
CREATE INDEX IF NOT EXISTS "AuditLog_actorWallet_idx" ON "AuditLog"("actorWallet");
CREATE INDEX IF NOT EXISTS "AuditLog_action_resourceType_idx" ON "AuditLog"("action", "resourceType");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");
CREATE INDEX IF NOT EXISTS "OutboxEvent_environment_idx" ON "OutboxEvent"("environment");
