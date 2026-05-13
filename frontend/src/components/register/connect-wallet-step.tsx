'use client';

import { motion } from 'framer-motion';
import { Wallet, ArrowRight, Shield, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ConnectWalletStepProps {
  onConnect: () => void;
  isConnecting: boolean;
}

export function ConnectWalletStep({ onConnect, isConnecting }: ConnectWalletStepProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[520px] text-center px-4">
      {/* Animated wallet icon */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative mb-8"
      >
        <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-[#172E7F] to-[#2A5FA6] flex items-center justify-center shadow-xl shadow-[#172E7F]/20">
          <Wallet className="h-12 w-12 text-white" />
        </div>
        {/* Pulse ring */}
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute inset-0 rounded-3xl border-2 border-[#172E7F]/30"
        />
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-2xl font-bold text-slate-900 mb-2"
      >
        Connect Your Wallet
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="text-slate-500 max-w-sm mb-8 leading-relaxed"
      >
        Link your Solana wallet to get started with the Fracks RWA platform.
        Your wallet serves as your on-chain identity.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="w-full max-w-xs"
      >
        <Button
          onClick={onConnect}
          disabled={isConnecting}
          size="lg"
          className="w-full gap-2 bg-gradient-to-r from-[#172E7F] to-[#2A5FA6] hover:opacity-90 h-12 text-base rounded-xl shadow-lg shadow-[#172E7F]/20"
        >
          <Wallet className="h-5 w-5" />
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
          {!isConnecting && <ArrowRight className="h-4 w-4 ml-1" />}
        </Button>
      </motion.div>

      {/* Trust badges */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex items-center gap-6 mt-10 text-xs text-slate-400"
      >
        <span className="flex items-center gap-1.5">
          <Shield className="h-3.5 w-3.5" /> Non-custodial
        </span>
        <span className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5" /> Instant Setup
        </span>
      </motion.div>
    </div>
  );
}
