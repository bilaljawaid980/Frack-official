"use client";

import { motion } from "framer-motion";
import { Wallet } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ConnectWalletCardProps {
  onConnect: () => void;
  isConnecting?: boolean;
}

export function ConnectWalletCard({
  onConnect,
  isConnecting,
}: ConnectWalletCardProps) {
  const { connected } = useWallet();
  const isConnected = connected;
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center justify-center min-h-[400px]"
    >
      <Card className="relative max-w-md w-full bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {/* Subtle gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50/50 via-purple-50/30 to-transparent pointer-events-none" />

        <CardContent className="relative pt-8 pb-10 text-center space-y-6">
          <motion.div
            className="mx-auto w-20 h-20 rounded-full bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] flex items-center justify-center shadow-lg"
            animate={{
              scale: [1, 1.05, 1],
            }}
            transition={{
              duration: 2,
              repeat: Infinity,
              repeatType: "reverse",
            }}
          >
            <Wallet className="h-10 w-10 text-white" />
          </motion.div>

          <div className="space-y-3">
            <h3 className="text-2xl font-bold text-gray-900">
              Please Connect Your Wallet to Continue
            </h3>
            <p className="text-sm text-gray-600 max-w-sm mx-auto">
              Please connect your wallet to access this feature and manage your
              assets. We support Phantom, Backpack, and Solflare wallets.
            </p>
          </div>

          <Button
            size="lg"
            onClick={onConnect}
            disabled={isConnecting || isConnected}
            className="w-full gap-2 bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] hover:opacity-90 text-white shadow-lg"
          >
            <Wallet className="h-5 w-5" />
            {isConnected ? "Wallet Connected" : "Connect Wallet"}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
