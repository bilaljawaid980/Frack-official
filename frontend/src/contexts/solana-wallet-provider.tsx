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

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const [endpoint, setEndpoint] = useState(RPC_URLS[0]);
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

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
