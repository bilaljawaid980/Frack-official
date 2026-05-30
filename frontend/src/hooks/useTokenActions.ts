// ─── Token Action Hooks ───────────────────────────────────────────────────────
//
// Mutation hooks for all agent/owner-gated token actions.
// Each hook invalidates the appropriate React Query caches on success.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  useMutation,
  useQueryClient,
  UseMutationResult,
} from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { TokenService } from "@/services/token";
import { useAnchorProvider } from "./useAnchorProvider";
import { useAppStore } from "@/store/appStore";

// ─── useMintTokens ───────────────────────────────────────────────────────────

export interface MintArgs {
  mint: PublicKey;
  recipient: PublicKey;
  amount: bigint;
}

/**
 * Agent-gated. Mints tokens to a recipient.
 */
export function useMintTokens(): UseMutationResult<string, Error, MintArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, recipient, amount }: MintArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.mint(mint, recipient, amount);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Tokens minted successfully." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useBurnTokens ───────────────────────────────────────────────────────────

export interface BurnArgs {
  mint: PublicKey;
  from: PublicKey;
  amount: bigint;
}

/**
 * Agent-gated. Burns tokens from a wallet.
 */
export function useBurnTokens(): UseMutationResult<string, Error, BurnArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, from, amount }: BurnArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.burn(mint, from, amount);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Tokens burned successfully." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({ queryKey: ["tokenBalance"] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useFreezeWallet ─────────────────────────────────────────────────────────

export interface FreezeArgs {
  mint: PublicKey;
  wallet: PublicKey;
}

/**
 * Agent-gated. Freezes a wallet for this token.
 */
export function useFreezeWallet(): UseMutationResult<string, Error, FreezeArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, wallet }: FreezeArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.freeze(mint, wallet);
    },
    onSuccess: (_sig, { mint, wallet }) => {
      addNotification({ type: "success", message: "Wallet frozen." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({ queryKey: ["investorRegistry", mint.toBase58()] });
      void qc.invalidateQueries({
        queryKey: ["walletIdentity", mint.toBase58(), wallet.toBase58()],
      });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useUnfreezeWallet ────────────────────────────────────────────────────────

/**
 * Agent-gated. Unfreezes a wallet.
 */
export function useUnfreezeWallet(): UseMutationResult<string, Error, FreezeArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, wallet }: FreezeArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.unfreeze(mint, wallet);
    },
    onSuccess: (_sig, { mint, wallet }) => {
      addNotification({ type: "success", message: "Wallet unfrozen." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({ queryKey: ["investorRegistry", mint.toBase58()] });
      void qc.invalidateQueries({
        queryKey: ["walletIdentity", mint.toBase58(), wallet.toBase58()],
      });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── usePauseToken ───────────────────────────────────────────────────────────

export interface PauseArgs {
  mint: PublicKey;
}

/**
 * Owner-gated. Pauses all token transfers.
 */
export function usePauseToken(): UseMutationResult<string, Error, PauseArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint }: PauseArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.pause(mint);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Token paused." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useUnpauseToken ─────────────────────────────────────────────────────────

/**
 * Owner-gated. Unpauses token transfers.
 */
export function useUnpauseToken(): UseMutationResult<string, Error, PauseArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint }: PauseArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.unpause(mint);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Token unpaused." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useAddAgent ─────────────────────────────────────────────────────────────

export interface AgentArgs {
  mint: PublicKey;
  agent: PublicKey;
}

/**
 * Owner-gated. Grants agent role to a wallet.
 */
export function useAddAgent(): UseMutationResult<string, Error, AgentArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, agent }: AgentArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.addAgent(mint, agent);
    },
    onSuccess: (_sig, { mint, agent }) => {
      addNotification({ type: "success", message: "Agent added." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({
        queryKey: ["isAgent", mint.toBase58(), agent.toBase58()],
      });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useRemoveAgent ───────────────────────────────────────────────────────────

/**
 * Owner-gated. Revokes agent role from a wallet.
 */
export function useRemoveAgent(): UseMutationResult<string, Error, AgentArgs> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, agent }: AgentArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new TokenService(provider);
      return service.removeAgent(mint, agent);
    },
    onSuccess: (_sig, { mint, agent }) => {
      addNotification({ type: "success", message: "Agent removed." });
      void qc.invalidateQueries({ queryKey: ["tokenState", mint.toBase58()] });
      void qc.invalidateQueries({
        queryKey: ["isAgent", mint.toBase58(), agent.toBase58()],
      });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}
