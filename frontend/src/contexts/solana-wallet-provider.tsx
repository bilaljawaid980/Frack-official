"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { Connection } from "@solana/web3.js";
import { RPC_URLS } from "@/lib/constants";

type PhantomSolanaProvider = {
  isPhantom?: boolean;
  on?: (event: "accountChanged", handler: (publicKey: unknown) => void) => void;
  removeListener?: (
    event: "accountChanged",
    handler: (publicKey: unknown) => void,
  ) => void;
};

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState(RPC_URLS[0]);
  const [walletProviderKey, setWalletProviderKey] = useState(0);
  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new BackpackWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      for (const rpcUrl of RPC_URLS) {
        try {
          const connection = new Connection(rpcUrl, "confirmed");
          await connection.getLatestBlockhash("confirmed");
          if (!cancelled) setEndpoint(rpcUrl);
          return;
        } catch {
          continue;
        }
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    const browserWindow = window as Window & {
      phantom?: { solana?: PhantomSolanaProvider };
      solana?: PhantomSolanaProvider;
    };
    const phantomProvider =
      browserWindow.phantom?.solana ||
      (browserWindow.solana?.isPhantom ? browserWindow.solana : undefined);
    if (!phantomProvider?.on) return;

    let timer: number | null = null;
    const handleAccountChanged = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setWalletProviderKey((current) => current + 1);
      }, 50);
    };

    phantomProvider.on("accountChanged", handleAccountChanged);

    return () => {
      if (timer) window.clearTimeout(timer);
      phantomProvider.removeListener?.("accountChanged", handleAccountChanged);
    };
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider key={walletProviderKey} wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
