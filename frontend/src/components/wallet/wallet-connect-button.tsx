"use client";

import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function WalletConnectButton() {
  const { connected, publicKey } = useSolanaWallet();
  const { setVisible } = useWalletModal();
  const { disconnect } = useWallet();

  const address = publicKey?.toBase58();
  const isConnected = connected;

  return (
    <div className="flex items-center gap-2">
      <Button
        onClick={() => setVisible(true)}
        className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] text-white rounded-[11px] px-6 h-10 font-medium"
      >
        {isConnected
          ? `${address?.slice(0, 6)}...${address?.slice(-4)}`
          : "Connect Wallet"}
      </Button>

      {isConnected && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                onClick={disconnect}
                className="h-10 w-10 rounded-[11px] border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors"
                aria-label="Disconnect wallet"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Disconnect wallet</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
