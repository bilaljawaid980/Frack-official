// ─── useTokenState / useOwnerState ───────────────────────────────────────────
//
// React Query hooks for fetching on-chain TokenState and OwnerState accounts.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { useQueries, useQuery, UseQueryResult } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { createReadonlyProvider } from "@/lib/anchor";
import { TokenService } from "@/services/token";
import type { TokenMintHealth, TokenState, OwnerState } from "@/types";

const STALE_TIME = 2 * 60_000;

// ─── useTokenState ────────────────────────────────────────────────────────────

/**
 * Fetches the on-chain TokenState for a given mint.
 * Enabled only when mint is non-null.
 */
export function useTokenState(
  mint: PublicKey | null
): UseQueryResult<TokenState> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["tokenState", mint?.toBase58() ?? null],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      const provider = createReadonlyProvider(connection);
      const service = new TokenService(provider);
      return service.fetchTokenState(mint);
    },
    enabled: mint !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── useOwnerState ────────────────────────────────────────────────────────────

/**
 * Fetches the on-chain OwnerState for a given mint.
 * Enabled only when mint is non-null.
 */
export function useOwnerState(
  mint: PublicKey | null
): UseQueryResult<OwnerState> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["ownerState", mint?.toBase58() ?? null],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      const provider = createReadonlyProvider(connection);
      const service = new TokenService(provider);
      return service.fetchOwnerState(mint);
    },
    enabled: mint !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

export function useTokenStates(mints: string[]) {
  const { connection } = useConnection();
  const uniqueMints = Array.from(new Set(mints.filter(Boolean)));

  const queries = useQueries({
    queries: uniqueMints.map((mint) => ({
      queryKey: ["tokenState", mint],
      queryFn: async () => {
        const provider = createReadonlyProvider(connection);
        const service = new TokenService(provider);
        return service.fetchTokenState(new PublicKey(mint));
      },
      enabled: true,
      staleTime: STALE_TIME,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  return useMemo(() => {
    const byMint = new Map<string, TokenState>();
    uniqueMints.forEach((mint, index) => {
      const tokenState = queries[index]?.data;
      if (tokenState) byMint.set(mint, tokenState);
    });

    return {
      byMint,
      isLoading: queries.some((query) => query.isLoading),
      isFetching: queries.some((query) => query.isFetching),
      errors: queries.map((query) => query.error).filter(Boolean),
    };
  }, [queries, uniqueMints]);
}

export function useTokenMintHealths(mints: string[]) {
  const { connection } = useConnection();
  const uniqueMints = Array.from(new Set(mints.filter(Boolean)));

  const queries = useQueries({
    queries: uniqueMints.map((mint) => ({
      queryKey: ["tokenMintHealth", mint],
      queryFn: async () => {
        const provider = createReadonlyProvider(connection);
        const service = new TokenService(provider);
        return service.fetchTokenMintHealth(new PublicKey(mint));
      },
      enabled: true,
      staleTime: STALE_TIME,
      refetchOnWindowFocus: false,
      retry: 1,
    })),
  });

  return useMemo(() => {
    const byMint = new Map<string, TokenMintHealth>();
    uniqueMints.forEach((mint, index) => {
      const health = queries[index]?.data;
      if (health) byMint.set(mint, health);
    });

    return {
      byMint,
      isLoading: queries.some((query) => query.isLoading),
      isFetching: queries.some((query) => query.isFetching),
      errors: queries.map((query) => query.error).filter(Boolean),
    };
  }, [queries, uniqueMints]);
}
