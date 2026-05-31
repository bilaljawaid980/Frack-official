"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useWallet } from "@/hooks/use-wallet";

export default function InvestorLandingPage() {
  const router = useRouter();
  const { address, connectWallet, isConnecting } = useWallet();

  useEffect(() => {
    if (address) {
      router.replace(`/investor/${address}`);
    }
  }, [address, router]);

  return (
    <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />
  );
}
