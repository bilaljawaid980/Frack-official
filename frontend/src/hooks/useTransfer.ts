// ─── Transfer Hooks ───────────────────────────────────────────────────────────
//
// React Query mutation hooks for simulating and executing token transfers.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { TransferService } from "@/services/transfer";
import { useAnchorProvider } from "./useAnchorProvider";
import { useAppStore } from "@/store/appStore";
import type { SimulationResult, TransferResult } from "@/types";

// ─── Argument types ───────────────────────────────────────────────────────────

export interface TransferArgs {
  mint: PublicKey;
  from: PublicKey;
  to: PublicKey;
  amount: bigint;
  decimals: number;
}

// ─── useSimulateTransfer ──────────────────────────────────────────────────────

/**
 * Mutation hook that simulates a Token-2022 transfer without submitting.
 * Returns SimulationResult with success flag, error message, and logs.
 */
export function useSimulateTransfer(): UseMutationResult<
  SimulationResult,
  Error,
  TransferArgs
> {
  const { connection } = useConnection();
  const provider = useAnchorProvider();

  return useMutation({
    mutationFn: async (args: TransferArgs) => {
      if (!provider) {
        throw new Error("Wallet not connected.");
      }
      const service = new TransferService(connection, provider);
      return service.simulateTransfer(
        args.mint,
        args.from,
        args.to,
        args.amount,
        args.decimals
      );
    },
  });
}

// ─── useExecuteTransfer ───────────────────────────────────────────────────────

/**
 * Mutation hook that simulates and then submits a Token-2022 transfer.
 * Adds the result to local transaction history on completion.
 */
export function useExecuteTransfer(): UseMutationResult<
  TransferResult,
  Error,
  TransferArgs
> {
  const { connection } = useConnection();
  const provider = useAnchorProvider();
  const addTxToHistory = useAppStore((s) => s.addTxToHistory);
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async (args: TransferArgs) => {
      if (!provider) {
        throw new Error("Wallet not connected.");
      }
      const service = new TransferService(connection, provider);
      return service.executeTransfer(
        args.mint,
        args.from,
        args.to,
        args.amount,
        args.decimals
      );
    },
    onSuccess: (result, args) => {
      // Record to local history
      addTxToHistory({
        signature: result.signature,
        from: args.from.toBase58(),
        to: args.to.toBase58(),
        amount: args.amount,
        timestamp: Math.floor(Date.now() / 1000),
        status: result.success ? "success" : "failed",
        error: result.error,
      });

      if (result.success) {
        addNotification({
          type: "success",
          message: `Transfer successful. Signature: ${result.signature.slice(0, 8)}…`,
        });
      } else {
        addNotification({
          type: "error",
          message: result.error ?? "Transfer failed.",
        });
      }
    },
    onError: (err, args) => {
      addTxToHistory({
        signature: "",
        from: args.from.toBase58(),
        to: args.to.toBase58(),
        amount: args.amount,
        timestamp: Math.floor(Date.now() / 1000),
        status: "failed",
        error: err.message,
      });
      addNotification({
        type: "error",
        message: err.message,
      });
    },
  });
}
