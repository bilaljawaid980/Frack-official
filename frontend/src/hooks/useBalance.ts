// ─── Balance Hooks ────────────────────────────────────────────────────────────
//
// React Query hooks for fetching token balances, SOL balances, and transfer history.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { useConnection } from "@solana/wallet-adapter-react";
import { createReadonlyProvider } from "@/lib/anchor";
import { PUBLIC_TOKEN_HOLDER_INDEX } from "@/lib/constants";
import { getBalance } from "@/services/connection";
import { IdentityService } from "@/services/identity";
import { useAppStore } from "@/store/appStore";
import type { TransferHistoryItem } from "@/types";

const STALE_TIME_BALANCE = 60_000;
const STALE_TIME_HISTORY = 2 * 60_000;
const EMPTY_HOLDER_INDEX: string[] = [];

// ─── useTokenSupply ───────────────────────────────────────────────────────────

/**
 * Fetches the total on-chain supply of a Token-2022 mint.
 * Returns BigInt(0) when the mint doesn't exist yet.
 */
export function useTokenSupply(
  mint: PublicKey | null
): import("@tanstack/react-query").UseQueryResult<bigint> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["tokenSupply", mint?.toBase58() ?? null],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");
      try {
        const supply = await connection.getTokenSupply(mint, "confirmed");
        return BigInt(supply.value.amount);
      } catch {
        return BigInt(0);
      }
    },
    enabled: mint !== null,
    staleTime: STALE_TIME_BALANCE,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useTokenBalance ─────────────────────────────────────────────────────────

/**
 * Fetches the Token-2022 balance for a wallet's associated token account.
 * Returns BigInt(0) when the ATA does not exist yet.
 */
export function useTokenBalance(
  mint: PublicKey | null,
  wallet: PublicKey | null
): UseQueryResult<bigint> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: [
      "tokenBalance",
      mint?.toBase58() ?? null,
      wallet?.toBase58() ?? null,
    ],
    queryFn: async () => {
      if (!mint || !wallet) throw new Error("Mint and wallet are required");

      const ata = getAssociatedTokenAddressSync(
        mint,
        wallet,
        false,
        SPL_TOKEN_2022_PROGRAM_ID
      );

      try {
        const acct = await connection.getTokenAccountBalance(ata, "confirmed");
        return BigInt(acct.value.amount);
      } catch {
        // ATA does not exist — return zero
        return BigInt(0);
      }
    },
    enabled: mint !== null && wallet !== null,
    staleTime: STALE_TIME_BALANCE,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useSolBalance ────────────────────────────────────────────────────────────

/**
 * Fetches the SOL balance (in lamports) for a wallet.
 */
export function useSolBalance(
  wallet: PublicKey | null
): UseQueryResult<number> {
  return useQuery({
    queryKey: ["solBalance", wallet?.toBase58() ?? null],
    queryFn: async () => {
      if (!wallet) throw new Error("Wallet is required");
      return getBalance(wallet);
    },
    enabled: wallet !== null,
    staleTime: STALE_TIME_BALANCE,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useToken2022Accounts ────────────────────────────────────────────────────

export interface Token2022Holding {
  ata: string;
  mint: string;
  amount: bigint;
  decimals: number;
}

export interface ActiveTokenHolder extends Token2022Holding {
  wallet: string;
  fid: string;
  country: number;
  identityStatus: "active" | "inactive" | "unknown";
}

/**
 * Discovers Token-2022 accounts owned by a wallet. This lets investor pages
 * show actual holdings even when the issuer deployment cache is unavailable.
 */
export function useToken2022Accounts(
  wallet: PublicKey | null
): UseQueryResult<Token2022Holding[]> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["token2022Accounts", wallet?.toBase58() ?? null],
    queryFn: async () => {
      if (!wallet) throw new Error("Wallet is required");
      const accounts = await connection.getParsedTokenAccountsByOwner(
        wallet,
        { programId: SPL_TOKEN_2022_PROGRAM_ID },
        "confirmed"
      );
      return accounts.value
        .map(({ pubkey, account }) => {
          const info = account.data.parsed.info;
          return {
            ata: pubkey.toBase58(),
            mint: info.mint as string,
            amount: BigInt(info.tokenAmount.amount as string),
            decimals: Number(info.tokenAmount.decimals),
          };
        })
        .filter((item) => item.amount > BigInt(0));
    },
    enabled: wallet !== null,
    staleTime: STALE_TIME_BALANCE,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}

// ─── useActiveTokenHolders ───────────────────────────────────────────────────

/**
 * Discovers real Token-2022 holders for a mint, then keeps only wallets with an
 * active identity in that token's registry. This backs investor-to-investor
 * request routing with on-chain balances instead of local UI state.
 */
export function useActiveTokenHolders(
  mint: PublicKey | null,
  excludeWallet?: PublicKey | null,
  options: { scanLargestAccounts?: boolean } = {}
): UseQueryResult<ActiveTokenHolder[]> {
  const { connection } = useConnection();
  const scanLargestAccounts = options.scanLargestAccounts ?? true;
  const mintKey = mint?.toBase58() ?? null;
  const indexedHoldersKey = useAppStore((state) =>
    mintKey ? (state.tokenHolderIndex?.[mintKey] ?? EMPTY_HOLDER_INDEX).join("|") : ""
  );
  const localTransferHoldersKey = useAppStore((state) =>
    mintKey
      ? state.txHistory
          .filter((tx) => tx.status === "success")
          .flatMap((tx) => [tx.from, tx.to])
          .filter(Boolean)
          .join("|")
      : ""
  );
  const onboardingHoldersKey = useAppStore((state) =>
    mintKey
      ? state.onboardingRequests
          .filter((request) => request.mint === mintKey)
          .map((request) => request.wallet)
          .join("|")
      : ""
  );
  const indexedHolders = indexedHoldersKey
    ? indexedHoldersKey.split("|").filter(Boolean)
    : EMPTY_HOLDER_INDEX;
  const localTransferHolders = localTransferHoldersKey
    ? localTransferHoldersKey.split("|").filter(Boolean)
    : EMPTY_HOLDER_INDEX;
  const onboardingHolders = onboardingHoldersKey
    ? onboardingHoldersKey.split("|").filter(Boolean)
    : EMPTY_HOLDER_INDEX;
  const envIndexedHolders = mint
    ? PUBLIC_TOKEN_HOLDER_INDEX.filter((entry) => entry.mint === mint.toBase58()).map(
        (entry) => entry.wallet
      )
    : [];
  const holderIndex = Array.from(
    new Set([
      ...envIndexedHolders,
      ...indexedHolders,
      ...localTransferHolders,
      ...onboardingHolders,
    ])
  );

  return useQuery({
    queryKey: [
      "activeTokenHolders",
      mint?.toBase58() ?? null,
      excludeWallet?.toBase58() ?? null,
      scanLargestAccounts ? "scan-largest" : "indexed-only",
      holderIndex.join("|"),
    ],
    queryFn: async () => {
      if (!mint) throw new Error("Mint is required");

      const provider = createReadonlyProvider(connection);
      const identityService = new IdentityService(provider);
      const holdersByWallet = new Map<string, ActiveTokenHolder>();

      const addHolder = async (
        wallet: string,
        ata: PublicKey,
        amount: bigint,
        decimals: number
      ) => {
        if (amount <= BigInt(0)) return;
        if (excludeWallet && wallet === excludeWallet.toBase58()) return;
        if (holdersByWallet.has(wallet)) return;

        let identity = null;
        try {
          identity = await identityService.fetchWalletIdentity(
            mint,
            new PublicKey(wallet)
          );
        } catch {
          identity = null;
        }
        holders.push({
          ata: ata.toBase58(),
          mint: mint.toBase58(),
          wallet,
          amount,
          decimals,
          fid: identity?.fid ?? "",
          country: identity?.country ?? 0,
          identityStatus: identity?.isActive
            ? "active"
            : identity
              ? "inactive"
              : "unknown",
        });
        holdersByWallet.set(wallet, holders[holders.length - 1]);
      };

      const holders: ActiveTokenHolder[] = [];
      if (scanLargestAccounts) {
        try {
          const largestAccounts = await connection.getTokenLargestAccounts(
            mint,
            "confirmed"
          );

          for (const tokenAccount of largestAccounts.value) {
            const amount = BigInt(tokenAccount.amount);
            if (amount <= BigInt(0)) continue;

            const parsedAccount = await connection.getParsedAccountInfo(
              tokenAccount.address,
              "confirmed"
            );
            const data = parsedAccount.value?.data;
            if (!data || typeof data === "string" || !("parsed" in data)) continue;

            const info = data.parsed.info as {
              owner?: string;
              mint?: string;
              tokenAmount?: { decimals?: number };
            };
            if (!info.owner || info.mint !== mint.toBase58()) continue;
            await addHolder(
              info.owner,
              tokenAccount.address,
              amount,
              Number(info.tokenAmount?.decimals ?? tokenAccount.decimals)
            );
          }
        } catch {
          // Public RPC can rate-limit largest-account scans. The local holder
          // index below still lets the UI recover by checking known ATAs.
        }
      }

      for (const wallet of holderIndex) {
        try {
          const owner = new PublicKey(wallet);
          const ata = getAssociatedTokenAddressSync(
            mint,
            owner,
            false,
            SPL_TOKEN_2022_PROGRAM_ID
          );
          const balance = await connection.getTokenAccountBalance(ata, "confirmed");
          await addHolder(
            wallet,
            ata,
            BigInt(balance.value.amount),
            Number(balance.value.decimals)
          );
        } catch {
          // Skip indexed wallets that no longer have a Token-2022 balance.
        }
      }

      return holders.sort((a, b) => {
        if (a.amount === b.amount) return a.wallet.localeCompare(b.wallet);
        return a.amount > b.amount ? -1 : 1;
      });
    },
    enabled: mint !== null,
    staleTime: 2 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── useTransferHistory ───────────────────────────────────────────────────────

/**
 * Fetches confirmed transaction signatures for a wallet and maps them to
 * TransferHistoryItem records for display in the UI.
 *
 * Only the last 20 confirmed signatures are returned.
 */
export function useTransferHistory(
  wallet: PublicKey | null
): UseQueryResult<TransferHistoryItem[]> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["transferHistory", wallet?.toBase58() ?? null],
    queryFn: async () => {
      if (!wallet) throw new Error("Wallet is required");

      const sigs = await connection.getSignaturesForAddress(wallet, {
        limit: 20,
      });

      return sigs.map((sig): TransferHistoryItem => ({
        signature: sig.signature,
        from: wallet.toBase58(),
        to: "",
        amount: BigInt(0),
        timestamp: sig.blockTime ?? Math.floor(Date.now() / 1000),
        status: sig.err ? "failed" : "success",
        error: sig.err ? JSON.stringify(sig.err) : undefined,
      }));
    },
    enabled: wallet !== null,
    staleTime: STALE_TIME_HISTORY,
    refetchOnWindowFocus: false,
    retry: 2,
  });
}
