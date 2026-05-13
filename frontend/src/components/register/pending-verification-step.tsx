'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Clock, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getKycApplicationByWallet, type KycStatus } from '@/lib/kyc-api';

interface PendingVerificationStepProps {
  walletAddress: string;
  onApproved: () => void;
}

const POLL_INTERVAL = 10_000;

export function PendingVerificationStep({ walletAddress, onApproved }: PendingVerificationStepProps) {
  const [status, setStatus] = useState<KycStatus>('PENDING');
  const [isPolling, setIsPolling] = useState(true);

  const poll = useCallback(async () => {
    try {
      const app = await getKycApplicationByWallet(walletAddress);
      if (app) {
        setStatus(app.status);
        if (app.status === 'APPROVED') {
          setIsPolling(false);
          setTimeout(onApproved, 1500);
        }
        if (app.status === 'REJECTED') {
          setIsPolling(false);
        }
      }
    } catch {
      // silently retry
    }
  }, [walletAddress, onApproved]);

  useEffect(() => {
    poll();
    if (!isPolling) return;
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll, isPolling]);

  const statusConfig = {
    PENDING: {
      icon: Clock,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      label: 'Pending Review',
      description: 'Your application has been submitted and is awaiting review by our compliance team.',
    },
    UNDER_REVIEW: {
      icon: RefreshCw,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      label: 'Under Review',
      description: 'A compliance officer is currently reviewing your application. This usually takes 1-2 business days.',
    },
    APPROVED: {
      icon: CheckCircle2,
      color: 'text-green-500',
      bg: 'bg-green-50',
      border: 'border-green-200',
      label: 'Approved!',
      description: 'Your identity has been verified. Redirecting you to your dashboard...',
    },
    REJECTED: {
      icon: XCircle,
      color: 'text-red-500',
      bg: 'bg-red-50',
      border: 'border-red-200',
      label: 'Application Rejected',
      description: 'Unfortunately your application was not approved. Please contact support for more details.',
    },
  };

  const cfg = statusConfig[status];
  const Icon = cfg.icon;

  return (
    <div className="flex flex-col items-center justify-center min-h-[520px] text-center px-4">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        className="relative mb-8"
      >
        <div className={`h-24 w-24 rounded-3xl ${cfg.bg} ${cfg.border} border-2 flex items-center justify-center`}>
          <Icon className={`h-12 w-12 ${cfg.color}`} />
        </div>
        {isPolling && (
          <motion.div
            animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
            transition={{ duration: 2, repeat: Infinity }}
            className={`absolute inset-0 rounded-3xl border-2 ${cfg.border}`}
          />
        )}
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="text-2xl font-bold text-slate-900 mb-2"
      >
        {cfg.label}
      </motion.h2>

      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="text-slate-500 max-w-md mb-8 leading-relaxed"
      >
        {cfg.description}
      </motion.p>

      {/* Status progress */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.35 }}
        className="flex items-center gap-3 mb-8"
      >
        {['PENDING', 'UNDER_REVIEW', 'APPROVED'].map((s, i) => {
          const steps = ['PENDING', 'UNDER_REVIEW', 'APPROVED'];
          const currentIdx = steps.indexOf(status);
          const isActive = i <= currentIdx;
          return (
            <div key={s} className="flex items-center gap-3">
              <div className={`h-3 w-3 rounded-full transition-colors ${isActive ? 'bg-gradient-to-r from-[#172E7F] to-[#2A5FA6]' : 'bg-slate-200'}`} />
              {i < steps.length - 1 && (
                <div className={`h-0.5 w-8 transition-colors ${isActive && i < currentIdx ? 'bg-[#172E7F]' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </motion.div>

      {isPolling && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
          className="text-xs text-slate-400 flex items-center gap-1.5"
        >
          <RefreshCw className="h-3 w-3 animate-spin" /> Auto-checking every 10 seconds
        </motion.p>
      )}

      {status === 'REJECTED' && (
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      )}
    </div>
  );
}
