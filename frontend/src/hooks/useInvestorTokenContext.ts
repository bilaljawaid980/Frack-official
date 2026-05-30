"use client";

import { useEffect, useMemo } from "react";
import { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { useAppStore } from "@/store/appStore";
import { PUBLIC_TOKEN_MINTS } from "@/lib/constants";
import { useDeployments } from "./useFactory";
import {
  useToken2022Accounts,
  useTokenBalance,
  useTokenSupply,
  useTransferHistory,
} from "./useBalance";
import { useTokenMintHealths, useTokenState } from "./useTokenState";
import { useWalletIdentity } from "./useIdentity";

function toPublicKey(value: string | null | undefined): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export function useInvestorTokenContext() {
  const { publicKey } = useWallet();
  const activeMint = useAppStore((s) => s.activeMint);
  const setActiveMint = useAppStore((s) => s.setActiveMint);
  const deploymentsCache = useAppStore((s) => s.deployments);
  const { data: chainDeployments = [], isLoading: deploymentsLoading } = useDeployments();
  const holdingsQuery = useToken2022Accounts(publicKey ?? null);
  const holdings = holdingsQuery.data ?? [];

  const deployments = useMemo(() => {
    const byMint = new Map<string, (typeof chainDeployments)[number]>();
    deploymentsCache.forEach((deployment) => byMint.set(deployment.tokenMint, deployment));
    chainDeployments.forEach((deployment) => byMint.set(deployment.tokenMint, deployment));
    return Array.from(byMint.values());
  }, [chainDeployments, deploymentsCache]);
  const tokenMints = useMemo(() => {
    const ordered = [
      activeMint,
      ...PUBLIC_TOKEN_MINTS,
      ...deployments.map((deployment) => deployment.tokenMint),
      ...holdings.map((holding) => holding.mint),
    ].filter((mint): mint is string => Boolean(mint));
    return Array.from(new Set(ordered));
  }, [activeMint, deployments, holdings]);

  useEffect(() => {
    if ((!activeMint || !tokenMints.includes(activeMint)) && tokenMints.length > 0) {
      setActiveMint(tokenMints[0]);
    }
  }, [activeMint, tokenMints, setActiveMint]);

  const mintPubkey = useMemo(() => {
    const selected = activeMint ?? tokenMints[0] ?? null;
    return toPublicKey(selected);
  }, [activeMint, tokenMints]);

  const deployment = useMemo(
    () => deployments.find((item) => item.tokenMint === mintPubkey?.toBase58()) ?? null,
    [deployments, mintPubkey]
  );
  const mintHealthQuery = useTokenMintHealths(tokenMints);
  const transferableTokenMints = useMemo(
    () =>
      tokenMints.filter((mint) => {
        const health = mintHealthQuery.byMint.get(mint);
        return health?.transferable ?? false;
      }),
    [mintHealthQuery.byMint, tokenMints]
  );

  useEffect(() => {
    if (transferableTokenMints.length === 0) {
      return;
    }
    if (!activeMint || !transferableTokenMints.includes(activeMint)) {
      setActiveMint(transferableTokenMints[0]);
    }
  }, [activeMint, setActiveMint, transferableTokenMints]);

  const tokenStateQuery = useTokenState(mintPubkey);
  const balanceQuery = useTokenBalance(mintPubkey, publicKey ?? null);
  const supplyQuery = useTokenSupply(mintPubkey);
  const identityQuery = useWalletIdentity(mintPubkey, publicKey ?? null);
  const historyQuery = useTransferHistory(publicKey ?? null);

  return {
    publicKey,
    activeMint,
    setActiveMint,
    deployments,
    deploymentsLoading: deploymentsLoading || holdingsQuery.isLoading,
    holdings,
    holdingsQuery,
    tokenMints,
    mintHealthQuery,
    transferableTokenMints,
    deployment,
    mintPubkey,
    tokenStateQuery,
    tokenState: tokenStateQuery.data ?? null,
    balanceQuery,
    balance: balanceQuery.data ?? BigInt(0),
    supplyQuery,
    supply: supplyQuery.data ?? BigInt(0),
    identityQuery,
    identity: identityQuery.data ?? null,
    historyQuery,
    history: historyQuery.data ?? [],
  };
}
