// ─── Identity Hooks ───────────────────────────────────────────────────────────
//
// React Query hooks for fetching wallet identity, investor registry, and agent status.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { createReadonlyProvider } from "@/lib/anchor";
import { IdentityService } from "@/services/identity";
import { TokenService } from "@/services/token";
import type { WalletIdentity } from "@/types";

const STALE_TIME = 30_000;

// ─── useWalletIdentity ────────────────────────────────────────────────────────

/**
 * Fetches the WalletIdentity for a wallet address within a token's IRS.
 * Returns null when the wallet has no registered identity.
 */
export function useWalletIdentity(
  mint: PublicKey | null,
  wallet: PublicKey | null
): UseQueryResult<WalletIdentity | null> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      "walletIdentity",
      mint?.toBase58() ?? null,
      wallet?.toBase58() ?? null,
    ],
    queryFn: async () => {
      if (!mint || !wallet) throw new Error("Mint and wallet are required");
      const provider = createReadonlyProvider(connection);
      const service = new IdentityService(provider);
      return service.fetchWalletIdentity(mint, wallet);
    },
    enabled: mint !== null && wallet !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useInvestorRegistry ──────────────────────────────────────────────────────

/**
 * Fetches all registered WalletIdentity accounts for a token's IRS.
 */
export function useInvestorRegistry(
  mint: PublicKey | null
): UseQueryResult<WalletIdentity[]> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["investorRegistry", mint?.toBase58() ?? null],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      const provider = createReadonlyProvider(connection);
      const service = new IdentityService(provider);
      return service.fetchAllIdentities(mint);
    },
    enabled: mint !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useIsAgent ───────────────────────────────────────────────────────────────

/**
 * Returns true if the given wallet has an active agent role for this mint.
 */
export function useIsAgent(
  mint: PublicKey | null,
  wallet: PublicKey | null
): UseQueryResult<boolean> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      "isAgent",
      mint?.toBase58() ?? null,
      wallet?.toBase58() ?? null,
    ],
    queryFn: async () => {
      if (!mint || !wallet) throw new Error("Mint and wallet are required");
      const provider = createReadonlyProvider(connection);
      const service = new TokenService(provider);
      return service.isAgent(mint, wallet);
    },
    enabled: mint !== null && wallet !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
