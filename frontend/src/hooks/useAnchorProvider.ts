// ─── useAnchorProvider ────────────────────────────────────────────────────────
//
// Creates an AnchorProvider from the connected wallet adapter and connection.
// Returns null when no wallet is connected.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { AnchorProvider } from "@coral-xyz/anchor";
import { createAnchorProvider } from "@/lib/anchor";

/**
 * Returns a memoised AnchorProvider backed by the connected wallet adapter.
 * Returns null when the wallet is not connected or lacks a public key.
 */
export function useAnchorProvider(): AnchorProvider | null {
  const { connection } = useConnection();
  const wallet = useWallet();

  return useMemo(() => {
    if (!wallet.connected || !wallet.publicKey) return null;

    // Build a WalletAdapter-compatible shim from the wallet-adapter-react hooks
    const adapterShim = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction!,
      signAllTransactions: wallet.signAllTransactions!,
    };

    try {
      return createAnchorProvider(connection, adapterShim, "confirmed");
    } catch {
      return null;
    }
  }, [
    connection,
    wallet.connected,
    wallet.publicKey,
    wallet.signTransaction,
    wallet.signAllTransactions,
  ]);
}
