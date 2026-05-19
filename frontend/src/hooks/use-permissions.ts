"use client";

import { useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useAppContext } from "@/contexts/app-context";
import {
  RBAC_DISABLED_FOR_SOLANA_TESTING,
  fetchPermissionsForWallet,
  testingPermissions,
  usePermissionsContext,
} from "@/contexts/permissions-context";
import type { PermissionsState as ContextPermissionsState } from "@/contexts/permissions-context";
import { TREX_CONTRACTS } from "@/lib/zigchain-config";
import { queryCache } from "@/lib/query-cache";

export type PermissionsState = ContextPermissionsState;

interface UsePermissionsOptions {
  trexClient?: unknown;
  walletAddress?: string | null;
  tokenContract?: string | null;
}

function toPublicKey(value?: string | null) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export function usePermissions(options?: UsePermissionsOptions) {
  const context = usePermissionsContext();
  const { address: walletAddress } = useAppContext();
  const tokenContract = options?.tokenContract || TREX_CONTRACTS.token;
  const needsTokenSpecific = tokenContract !== TREX_CONTRACTS.token;

  const [tokenPermissions, setTokenPermissions] = useState<
    Pick<
    PermissionsState,
    "isTokenOwner" | "isTokenIssuer" | "isTokenController" | "isTokenAgent"
    >
  >({
    isTokenOwner: context.permissions.isTokenOwner,
    isTokenIssuer: context.permissions.isTokenIssuer,
    isTokenController: context.permissions.isTokenController,
    isTokenAgent: context.permissions.isTokenAgent,
  });
  const [tokenLoading, setTokenLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadTokenPermissions = async () => {
      if (RBAC_DISABLED_FOR_SOLANA_TESTING) {
        setTokenPermissions({
          isTokenOwner: true,
          isTokenIssuer: true,
          isTokenController: true,
          isTokenAgent: true,
        });
        setTokenLoading(false);
        return;
      }

      if (!needsTokenSpecific) {
        setTokenPermissions({
          isTokenOwner: context.permissions.isTokenOwner,
          isTokenIssuer: context.permissions.isTokenIssuer,
          isTokenController: context.permissions.isTokenController,
          isTokenAgent: context.permissions.isTokenAgent,
        });
        setTokenLoading(false);
        return;
      }

      const tokenMint = toPublicKey(tokenContract);
      if (!walletAddress || !tokenMint) {
        setTokenPermissions({
          isTokenOwner: false,
          isTokenIssuer: false,
          isTokenController: false,
          isTokenAgent: false,
        });
        setTokenLoading(false);
        return;
      }

      setTokenLoading(true);
      try {
        const result = await queryCache.query(
          `permissions:${walletAddress.toLowerCase()}:${tokenMint.toBase58()}`,
          () => fetchPermissionsForWallet(walletAddress, tokenMint),
          30_000,
        );

        if (cancelled) return;
        setTokenPermissions({
          isTokenOwner: result.isTokenOwner,
          isTokenIssuer: result.isTokenIssuer,
          isTokenController: result.isTokenController,
          isTokenAgent: result.isTokenAgent,
        });
      } catch {
        if (cancelled) return;
        setTokenPermissions({
          isTokenOwner: false,
          isTokenIssuer: false,
          isTokenController: false,
          isTokenAgent: false,
        });
      } finally {
        if (!cancelled) setTokenLoading(false);
      }
    };

    loadTokenPermissions();
    return () => {
      cancelled = true;
    };
  }, [
    needsTokenSpecific,
    tokenContract,
    walletAddress,
    context.permissions.isTokenOwner,
    context.permissions.isTokenIssuer,
    context.permissions.isTokenController,
    context.permissions.isTokenAgent,
  ]);

  const mergedPermissions: PermissionsState = RBAC_DISABLED_FOR_SOLANA_TESTING
    ? testingPermissions
    : {
        ...context.permissions,
        ...tokenPermissions,
      };

  const canSeeAdminTab =
    RBAC_DISABLED_FOR_SOLANA_TESTING ||
    mergedPermissions.isTokenOwner ||
    mergedPermissions.isTokenIssuer ||
    mergedPermissions.isTokenController ||
    mergedPermissions.isTokenAgent ||
    mergedPermissions.isComplianceOwner ||
    mergedPermissions.isClaimTopicsOwner ||
    mergedPermissions.isFactoryAdmin;

  return {
    ...context,
    permissions: mergedPermissions,
    loading: context.loading || tokenLoading,
    canSeeAdminTab,
  };
}
