// ─── Factory Hooks ────────────────────────────────────────────────────────────
//
// React Query hooks for factory state, deployments, and the deploy mutation.
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import {
  useQuery,
  useMutation,
  useQueryClient,
  UseQueryResult,
  UseMutationResult,
} from "@tanstack/react-query";
import { Keypair, PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { createReadonlyProvider } from "@/lib/anchor";
import { FactoryService } from "@/services/factory";
import { useAnchorProvider } from "./useAnchorProvider";
import { useAppStore } from "@/store/appStore";
import type { FactoryState, TokenDeployment, DeployTokenSuiteArgs } from "@/types";

const STALE_TIME = 2 * 60_000;
const DEPLOYMENT_SCAN_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

// ─── useFactoryState ──────────────────────────────────────────────────────────

/**
 * Fetches the singleton FactoryState account.
 */
export function useFactoryState(): UseQueryResult<FactoryState> {
  const { connection } = useConnection();

  return useQuery({
    queryKey: ["factoryState"],
    queryFn: async () => {
      const provider = createReadonlyProvider(connection);
      const service = new FactoryService(provider);
      return service.fetchFactoryState();
    },
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

// ─── useDeployments ───────────────────────────────────────────────────────────

/**
 * Fetches all TokenDeployment accounts, optionally filtered to a specific issuer.
 *
 * When issuer is provided, results are filtered client-side after fetching all
 * deployments (the program does not support server-side issuer filtering via
 * discriminator alone without a secondary memcmp on the issuer offset).
 */
export function useDeployments(
  issuer?: PublicKey
): UseQueryResult<TokenDeployment[]> {
  const { connection } = useConnection();
  const deploymentsCache = useAppStore((s) => s.deployments);
  const setDeployments = useAppStore((s) => s.setDeployments);

  return useQuery({
    queryKey: ["deployments", issuer?.toBase58() ?? "all"],
    queryFn: async () => {
      const provider = createReadonlyProvider(connection);
      const service = new FactoryService(provider);
      try {
        const all = await withTimeout(
          service.fetchAllDeployments(),
          DEPLOYMENT_SCAN_TIMEOUT_MS,
          "Deployment scan"
        );
        setDeployments(all);
        if (!issuer) return all;
        return all.filter((d) => d.issuer === issuer.toBase58());
      } catch (error) {
        if (deploymentsCache.length > 0) {
          if (!issuer) return deploymentsCache;
          return deploymentsCache.filter((d) => d.issuer === issuer.toBase58());
        }
        throw error;
      }
    },
    initialData: () => {
      if (deploymentsCache.length === 0) return undefined;
      if (!issuer) return deploymentsCache;
      return deploymentsCache.filter((d) => d.issuer === issuer.toBase58());
    },
    staleTime: STALE_TIME,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: 1,
    retryDelay: 500,
  });
}

// ─── useDeployTokenSuite ──────────────────────────────────────────────────────

/**
 * Mutation hook for deploying a new token suite via the factory.
 * Invalidates deployments and factory state queries on success.
 * Also updates the Zustand deployments cache.
 */
export interface DeployWithKeypairArgs extends DeployTokenSuiteArgs {
  /** Pre-generated keypair for the new Token-2022 mint. Required for on-chain deployment. */
  mintKeypair: Keypair;
}

export function useDeployTokenSuite(): UseMutationResult<
  string,
  Error,
  DeployWithKeypairArgs
> {
  const queryClient = useQueryClient();
  const provider = useAnchorProvider();
  const wallet = useWallet();
  const setDeployments = useAppStore((s) => s.setDeployments);
  const addDeployment = useAppStore((s) => s.addDeployment);
  const setActiveMint = useAppStore((s) => s.setActiveMint);
  const setActiveDeploymentPda = useAppStore((s) => s.setActiveDeploymentPda);
  const addNotification = useAppStore((s) => s.addNotification);

  return useMutation({
    mutationFn: async ({ mintKeypair, ...args }: DeployWithKeypairArgs) => {
      if (!provider) {
        throw new Error("Wallet not connected. Please connect your wallet.");
      }
      const service = new FactoryService(provider, wallet.sendTransaction);
      return service.deployTokenSuite(args, mintKeypair);
    },
    onSuccess: async (result, args) => {
      // result is the tx signature; derive the deployment PDA from args
      const signature = result;
      addNotification({
        type: "success",
        message: `Token suite deployed. Signature: ${signature.slice(0, 8)}…`,
      });

      // Invalidate and refetch
      await queryClient.invalidateQueries({ queryKey: ["deployments"] });
      await queryClient.invalidateQueries({ queryKey: ["factoryState"] });

      // Set the newly deployed mint as the active selection
      if (args.tokenMint) {
        setActiveMint(args.tokenMint.toString());
      }

      // Wait a moment for the account to be confirmed, then fetch the deployment
      if (provider && args.tokenMint) {
        try {
          await new Promise((r) => setTimeout(r, 2000));
          const service = new FactoryService(provider);
          const all = await service.fetchAllDeployments();
          setDeployments(all);
          const newDeployment = all.find(
            (d) => d.tokenMint === args.tokenMint!.toString()
          );
          if (newDeployment) {
            addDeployment(newDeployment);
            setActiveDeploymentPda(newDeployment.deploymentPda);
          }
        } catch {
          // non-fatal — the queries will refetch via invalidation
        }
      }
    },
    onError: (err) => {
      addNotification({
        type: "error",
        message: err.message,
      });
    },
  });
}
