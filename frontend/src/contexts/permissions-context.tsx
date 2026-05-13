"use client";

/**
 * PermissionsContext - Centralized, singleton provider for user permissions.
 *
 * Previously, the Sidebar, Dashboard, Compliance, Issuance, KYC Provider, Token Admin,
 * Personnel, and Admin Identities pages each called `usePermissions()` independently,
 * each making 7 parallel RPC calls to check roles. With 9 consumers, that's 63 redundant RPC calls.
 *
 * Now, permissions are fetched ONCE in this provider and shared via context.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  connection,
  deriveAgentRolePDA,
  deriveComplianceStatePDA,
  deriveCtrStatePDA,
  deriveFactoryStatePDA,
  deriveFidPDA,
  deriveIrpStatePDA,
  deriveIssuerEntryPDA,
  deriveOwnerStatePDA,
  deriveTirStatePDA,
} from "@/lib/solana";
import { TREX_CONTRACTS, ROLE_WALLETS } from "@/lib/zigchain-config";
import { queryCache } from "@/lib/query-cache";
import { useAppContext } from "@/contexts/app-context";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PermissionsState {
  isFactoryAdmin: boolean;
  isIdentityRegistryOwner: boolean;
  isClaimTopicsOwner: boolean;
  isComplianceOwner: boolean;
  isTokenOwner: boolean;
  isTokenIssuer: boolean;
  isTokenController: boolean;
  isTokenAgent: boolean;
  isTrustedIssuer: boolean;
  canKycProvider: boolean;
}

interface PermissionsContextType {
  permissions: PermissionsState;
  loading: boolean;
  error: string | null;
  canSeeAdminIdentities: boolean;
  canSeeCompliance: boolean;
  canSeeIssuance: boolean;
  canSeeKycProvider: boolean;
  canSeeAdminTab: boolean;
  canSeeActivityLogs: boolean;
}

const emptyPermissions: PermissionsState = {
  isFactoryAdmin: false,
  isIdentityRegistryOwner: false,
  isClaimTopicsOwner: false,
  isComplianceOwner: false,
  isTokenOwner: false,
  isTokenIssuer: false,
  isTokenController: false,
  isTokenAgent: false,
  isTrustedIssuer: false,
  canKycProvider: false,
};

const PermissionsContext = createContext<PermissionsContextType | undefined>(
  undefined,
);

function toPublicKey(value?: string | null) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

function readOwnerFromAccount(info: AccountInfo<Buffer> | null, offset = 8) {
  if (!info || info.data.length < offset + 32) return null;
  return new PublicKey(info.data.subarray(offset, offset + 32));
}

function parseIssuerEntry(info: AccountInfo<Buffer> | null) {
  if (!info) return null;
  const data = info.data;
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return null;
  const topicsLen = data.readUInt32LE(offset);
  offset += 4;
  const topics: number[] = [];
  for (let i = 0; i < topicsLen; i += 1) {
    if (data.length < offset + 8) break;
    const value = Number(data.readBigUInt64LE(offset));
    topics.push(value);
    offset += 8;
  }
  if (data.length < offset + 1) return null;
  const isActive = data.readUInt8(offset) === 1;
  offset += 1;
  if (data.length >= offset + 4) {
    const labelLen = data.readUInt32LE(offset);
    offset += 4 + labelLen;
  }
  return { isActive, topics };
}

export async function fetchPermissionsForWallet(
  walletAddress: string,
  tokenMint: PublicKey,
): Promise<PermissionsState> {
  const wallet = new PublicKey(walletAddress);
  const [ownerState] = deriveOwnerStatePDA(tokenMint);
  const [agentRole] = deriveAgentRolePDA(tokenMint, wallet);
  const [factoryState] = deriveFactoryStatePDA();
  const [irpState] = deriveIrpStatePDA(tokenMint);
  const [ctrState] = deriveCtrStatePDA(tokenMint);
  const [complianceState] = deriveComplianceStatePDA(tokenMint);
  const [tirState] = deriveTirStatePDA(tokenMint);
  const [fid] = deriveFidPDA(wallet);
  const [issuerEntry] = deriveIssuerEntryPDA(tirState, fid);
  const [issuerEntryByWallet] = deriveIssuerEntryPDA(tirState, wallet);

  const [
    ownerInfo,
    agentInfo,
    factoryInfo,
    irpInfo,
    ctrInfo,
    complianceInfo,
    tirInfo,
    issuerEntryInfo,
  ] = await connection.getMultipleAccountsInfo(
    [
      ownerState,
      agentRole,
      factoryState,
      irpState,
      ctrState,
      complianceState,
      tirState,
      issuerEntry,
    ],
    "confirmed",
  );

  const tokenOwner = readOwnerFromAccount(ownerInfo, 8);
  const factoryOwner = readOwnerFromAccount(factoryInfo, 8);
  const irpOwner = readOwnerFromAccount(irpInfo, 40);
  const ctrOwner = readOwnerFromAccount(ctrInfo, 8);
  const complianceOwner = readOwnerFromAccount(complianceInfo, 8);
  let issuerEntryData = parseIssuerEntry(issuerEntryInfo);
  if (!issuerEntryData?.isActive) {
    // MIGRATED: legacy entries may be keyed by wallet when FID was not created yet.
    // Accept both keying modes so role-gating matches on-chain TIR state.
    const fallbackInfo = await connection.getAccountInfo(issuerEntryByWallet, "confirmed");
    const fallbackData = parseIssuerEntry(fallbackInfo);
    if (fallbackData?.isActive) {
      issuerEntryData = fallbackData;
    }
  }

  const isTokenOwner = !!tokenOwner && tokenOwner.equals(wallet);
  const isFactoryAdmin = !!factoryOwner && factoryOwner.equals(wallet);
  const isIdentityRegistryOwner = !!irpOwner && irpOwner.equals(wallet);
  const isClaimTopicsOwner = !!ctrOwner && ctrOwner.equals(wallet);
  const isComplianceOwner = !!complianceOwner && complianceOwner.equals(wallet);
  const isTokenAgent = !!agentInfo;
  const isTrustedIssuer = !!issuerEntryData?.isActive;
  const canKycProvider = !!issuerEntryData?.isActive && issuerEntryData.topics.includes(1);

  return {
    isFactoryAdmin,
    isIdentityRegistryOwner,
    isClaimTopicsOwner,
    isComplianceOwner,
    isTokenOwner,
    isTokenIssuer: isTokenOwner,
    isTokenController: isTokenOwner,
    isTokenAgent,
    isTrustedIssuer,
    canKycProvider,
  };
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const { address: walletAddress } = useAppContext();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] =
    useState<PermissionsState>(emptyPermissions);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let isCancelled = false;

    const loadPermissions = async () => {
      const tokenMint = toPublicKey(TREX_CONTRACTS.token);
      if (!walletAddress || !tokenMint) {
        setPermissions(emptyPermissions);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const cacheKey = `permissions:${walletAddress.toLowerCase()}:${tokenMint.toBase58()}`;
        const result = await queryCache.query(
          cacheKey,
          () => fetchPermissionsForWallet(walletAddress, tokenMint),
          60_000,
        );

        if (isCancelled || requestId !== requestIdRef.current) {
          return;
        }

        setPermissions(result);
      } catch (err: any) {
        console.error("Failed to load permissions:", err);
        setError(err.message || "Failed to load permissions");
      } finally {
        setLoading(false);
      }
    };

    loadPermissions();
    return () => {
      isCancelled = true;
    };
  }, [walletAddress]);

  // ─ Derived visibility flags ─
  const canSeeAdminIdentities = useMemo(
    () => permissions.isIdentityRegistryOwner || permissions.isTrustedIssuer,
    [permissions],
  );
  const canSeeCompliance =
    permissions.isComplianceOwner || permissions.isFactoryAdmin;
  const canSeeIssuance = permissions.isFactoryAdmin;
  const canSeeKycProvider = permissions.canKycProvider;
  const canSeeAdminTab =
    permissions.isTokenOwner ||
    permissions.isTokenIssuer ||
    permissions.isTokenController ||
    permissions.isTokenAgent ||
    permissions.isComplianceOwner ||
    permissions.isClaimTopicsOwner ||
    permissions.isFactoryAdmin;
  const canSeeActivityLogs =
    !!walletAddress &&
    walletAddress.toLowerCase() === ROLE_WALLETS.platformOwner.toLowerCase();

  const value: PermissionsContextType = {
    permissions,
    loading,
    error,
    canSeeAdminIdentities,
    canSeeCompliance,
    canSeeIssuance,
    canSeeKycProvider,
    canSeeAdminTab,
    canSeeActivityLogs,
  };

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

// ─── Consumer Hook ───────────────────────────────────────────────────────────

export function usePermissionsContext() {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error(
      "usePermissionsContext must be used within PermissionsProvider",
    );
  }
  return context;
}
