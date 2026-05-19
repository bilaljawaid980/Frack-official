// ─── Compliance Action Hooks ──────────────────────────────────────────────────
//
// Mutation hooks for binding/unbinding modules and configuring compliance state.
// Each hook invalidates compliance-related query keys on success.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  useMutation,
  useQueryClient,
  UseMutationResult,
} from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ComplianceService } from "@/services/compliance";
import { useAnchorProvider } from "./useAnchorProvider";
import { useAppStore } from "@/store/appStore";

// ─── useBindModule ────────────────────────────────────────────────────────────

export interface BindModuleArgs {
  mint: PublicKey;
  modulePubkey: PublicKey;
}

/**
 * Owner-gated. Binds a compliance module to the token's compliance state.
 */
export function useBindModule(): UseMutationResult<
  string,
  Error,
  BindModuleArgs
> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, modulePubkey }: BindModuleArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new ComplianceService(provider);
      return service.bindModule(mint, modulePubkey);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Compliance module bound." });
      void qc.invalidateQueries({
        queryKey: ["complianceState", mint.toBase58()],
      });
      void qc.invalidateQueries({ queryKey: ["moduleStates", mint.toBase58()] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useUnbindModule ──────────────────────────────────────────────────────────

/**
 * Owner-gated. Unbinds a compliance module from the token's compliance state.
 */
export function useUnbindModule(): UseMutationResult<
  string,
  Error,
  BindModuleArgs
> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, modulePubkey }: BindModuleArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new ComplianceService(provider);
      return service.unbindModule(mint, modulePubkey);
    },
    onSuccess: (_sig, { mint }) => {
      addNotification({ type: "success", message: "Compliance module unbound." });
      void qc.invalidateQueries({
        queryKey: ["complianceState", mint.toBase58()],
      });
      void qc.invalidateQueries({ queryKey: ["moduleStates", mint.toBase58()] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useSetModulesPaused ──────────────────────────────────────────────────────

export interface SetModulesPausedArgs {
  mint: PublicKey;
  paused: boolean;
}

/**
 * Owner-gated. Pauses or unpauses all compliance module checks.
 */
export function useSetModulesPaused(): UseMutationResult<
  string,
  Error,
  SetModulesPausedArgs
> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mint, paused }: SetModulesPausedArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new ComplianceService(provider);
      return service.setModulesPaused(mint, paused);
    },
    onSuccess: (_sig, { mint, paused }) => {
      addNotification({
        type: "success",
        message: paused
          ? "Compliance modules paused."
          : "Compliance modules unpaused.",
      });
      void qc.invalidateQueries({
        queryKey: ["complianceState", mint.toBase58()],
      });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}

// ─── useConfigureModule ───────────────────────────────────────────────────────

export interface ConfigureModuleArgs {
  moduleType: string;
  mint: PublicKey;
  params: Record<string, unknown>;
}

/**
 * Owner-gated. Configures a compliance module via the compliance program's
 * call_module_function CPI.
 */
export function useConfigureModule(): UseMutationResult<
  string,
  Error,
  ConfigureModuleArgs
> {
  const qc = useQueryClient();
  const provider = useAnchorProvider();
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ moduleType, mint, params }: ConfigureModuleArgs) => {
      if (!provider) throw new Error("Wallet not connected.");
      const service = new ComplianceService(provider);
      return service.configureModule(moduleType, mint, params);
    },
    onSuccess: (_sig, { mint, moduleType }) => {
      addNotification({
        type: "success",
        message: `Module "${moduleType}" configured successfully.`,
      });
      void qc.invalidateQueries({
        queryKey: ["complianceState", mint.toBase58()],
      });
      void qc.invalidateQueries({ queryKey: ["moduleStates", mint.toBase58()] });
    },
    onError: (err) => {
      addNotification({ type: "error", message: err.message });
    },
  });
}
