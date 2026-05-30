// ─── useComplianceState / useModuleStates ────────────────────────────────────
//
// React Query hooks for fetching ComplianceState and per-module states.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { createReadonlyProvider } from "@/lib/anchor";
import { ComplianceService } from "@/services/compliance";
import {
  MOD_DAILY_LIMIT,
  MOD_MAX_BALANCE,
  MOD_MAX_TRANSFER,
  MOD_LOCKUP,
  MOD_SUPPLY_CAP,
  MOD_MAX_INVESTORS,
  MOD_COUNTRY_RESTRICT,
  MOD_COUNTRY_CAP,
} from "@/lib/constants";
import type { ComplianceState } from "@/types";

const STALE_TIME = 2 * 60_000;

// Map from program ID string to module type identifier
const PROGRAM_TO_MODULE_TYPE: Record<string, string> = {
  [MOD_DAILY_LIMIT.toBase58()]: "daily_limit",
  [MOD_MAX_BALANCE.toBase58()]: "max_balance",
  [MOD_MAX_TRANSFER.toBase58()]: "max_transfer",
  [MOD_LOCKUP.toBase58()]: "lockup",
  [MOD_SUPPLY_CAP.toBase58()]: "supply_cap",
  [MOD_MAX_INVESTORS.toBase58()]: "max_investors",
  [MOD_COUNTRY_RESTRICT.toBase58()]: "country_restrict",
  [MOD_COUNTRY_CAP.toBase58()]: "country_cap",
};

// ─── useComplianceState ───────────────────────────────────────────────────────

/**
 * Fetches the on-chain ComplianceState for a given mint.
 */
export function useComplianceState(
  mint: PublicKey | null
): UseQueryResult<ComplianceState> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["complianceState", mint?.toBase58() ?? null],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      const provider = createReadonlyProvider(connection);
      const service = new ComplianceService(provider);
      return service.fetchComplianceState(mint);
    },
    enabled: mint !== null,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── useModuleStates ──────────────────────────────────────────────────────────

/**
 * Fetches the state for each bound compliance module in parallel.
 * Returns an array of module states (may contain nulls for failed fetches).
 */
export function useModuleStates(
  mint: PublicKey | null,
  modules: PublicKey[]
): UseQueryResult<unknown[]> {
  const { connection } = useConnection();
  const modulesKey = modules.map((m) => m.toBase58()).join(",");

  return useQuery({
    queryKey: ["moduleStates", mint?.toBase58() ?? null, modulesKey],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      if (modules.length === 0) return [];

      const provider = createReadonlyProvider(connection);
      const service = new ComplianceService(provider);

      const results = await Promise.allSettled(
        modules.map((modulePubkey) => {
          const moduleType =
            PROGRAM_TO_MODULE_TYPE[modulePubkey.toBase58()] ?? "unknown";
          if (moduleType === "unknown") {
            return Promise.resolve(null);
          }
          return service.fetchModuleState(moduleType, modulePubkey, mint);
        })
      );

      return results.map((result) =>
        result.status === "fulfilled" ? result.value : null
      );
    },
    enabled: mint !== null && modules.length > 0,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
