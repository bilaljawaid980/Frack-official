'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useWallet } from '@/hooks/use-wallet';
import { apiFetch, storeTokens } from '@/lib/backend';
import { createKycApplication } from '@/lib/kyc-api';

import { ConnectWalletStep } from '@/components/register/connect-wallet-step';
import { ChooseRoleStep } from '@/components/register/choose-role-step';
import { InvestorFormStep } from '@/components/register/investor-form-step';
import { IssuerFormStep, type IssuerFormData } from '@/components/register/issuer-form-step';
import { PendingVerificationStep } from '@/components/register/pending-verification-step';

import Link from 'next/link';

type WizardStep =
  | 'connect-wallet'
  | 'choose-role'
  | 'investor-form'
  | 'issuer-form'
  | 'pending-verification';

// Step progress for the indicator bar
const stepOrder: WizardStep[] = [
  'connect-wallet',
  'choose-role',
  'investor-form', // or issuer-form — same position
  'pending-verification',
];

function getStepIndex(step: WizardStep): number {
  if (step === 'issuer-form') return 2;
  const idx = stepOrder.indexOf(step);
  return idx >= 0 ? idx : 0;
}

export default function RegisterPage() {
  const router = useRouter();
  const { address, isConnected, connectWallet, isConnecting } = useWallet();
  const [step, setStep] = useState<WizardStep>('connect-wallet');
  const [isLoading, setIsLoading] = useState(false);

  // Auto-advance when wallet connects
  useEffect(() => {
    if (isConnected && address && step === 'connect-wallet') {
      setStep('choose-role');
    }
  }, [isConnected, address, step]);

  const handleConnect = useCallback(() => {
    connectWallet();
  }, [connectWallet]);

  const handleRoleSelect = useCallback((role: 'investor' | 'issuer') => {
    setStep(role === 'investor' ? 'investor-form' : 'issuer-form');
  }, []);

  // Investor registration — create account, redirect to /identity
  const handleInvestorSubmit = useCallback(
    async (data: { email: string; password: string }) => {
      setIsLoading(true);
      try {
        const tokens = await apiFetch<{ accessToken: string; refreshToken: string }>(
          '/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              email: data.email,
              password: data.password,
              walletAddress: address,
              requestedRole: 'investor',
            }),
          },
        );
        storeTokens(tokens);
        toast.success('Account created! Redirecting to your dashboard...');
        router.push('/identity');
      } catch (err: any) {
        const msg = err?.message || 'Registration failed';
        toast.error(msg.includes('Email already') ? 'This email is already registered' : msg);
      } finally {
        setIsLoading(false);
      }
    },
    [address, router],
  );

  // Issuer registration — create account + submit KYC, then show pending screen
  const handleIssuerSubmit = useCallback(
    async (data: IssuerFormData) => {
      if (!address) return;
      setIsLoading(true);
      try {
        // Step A: create the user account
        const tokens = await apiFetch<{ accessToken: string; refreshToken: string }>(
          '/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              email: data.email,
              password: data.password,
              walletAddress: address,
              requestedRole: 'issuer',
            }),
          },
        );
        storeTokens(tokens);

        // Step B: submit KYC application
        await createKycApplication({
          walletAddress: address,
          email: data.email,
          fullName: data.fullName,
          dateOfBirth: data.dateOfBirth || undefined,
          nationality: data.nationality,
          country: data.country,
          phoneNumber: data.phoneNumber || undefined,
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2 || undefined,
          city: data.city,
          state: data.state || undefined,
          postalCode: data.postalCode,
        });

        toast.success('Application submitted!');
        setStep('pending-verification');
      } catch (err: any) {
        const msg = err?.message || 'Submission failed';
        toast.error(msg.includes('Email already') ? 'This email is already registered' : msg);
      } finally {
        setIsLoading(false);
      }
    },
    [address],
  );

  const handleApproved = useCallback(() => {
    toast.success('Identity verified! Welcome aboard.');
    router.push('/identity');
  }, [router]);

  const currentStepIndex = getStepIndex(step);
  const totalSteps = 4;
  const progressPercent = ((currentStepIndex + 1) / totalSteps) * 100;

  return (
    <div className="w-full animate-in fade-in duration-500 pb-12">
      <div className="border border-slate-200/70 shadow-sm rounded-[24px] bg-white/90 backdrop-blur overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 w-full bg-slate-100 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-[#172E7F] to-[#2A5FA6]"
            initial={{ width: 0 }}
            animate={{ width: `${progressPercent}%` }}
            transition={{ duration: 0.4, ease: 'easeInOut' }}
          />
        </div>

        <div className="w-full p-6 md:p-10">
          <AnimatePresence mode="wait">
            {step === 'connect-wallet' && (
              <motion.div key="cw" exit={{ opacity: 0, x: -20 }}>
                <ConnectWalletStep onConnect={handleConnect} isConnecting={isConnecting} />
              </motion.div>
            )}

            {step === 'choose-role' && address && (
              <motion.div key="cr" exit={{ opacity: 0, x: -20 }}>
                <ChooseRoleStep
                  walletAddress={address}
                  onSelect={handleRoleSelect}
                  onBack={() => setStep('connect-wallet')}
                />
              </motion.div>
            )}

            {step === 'investor-form' && address && (
              <motion.div key="if" exit={{ opacity: 0, x: -20 }}>
                <InvestorFormStep
                  walletAddress={address}
                  onSubmit={handleInvestorSubmit}
                  onBack={() => setStep('choose-role')}
                  isLoading={isLoading}
                />
              </motion.div>
            )}

            {step === 'issuer-form' && address && (
              <motion.div key="isf" exit={{ opacity: 0, x: -20 }}>
                <IssuerFormStep
                  walletAddress={address}
                  onSubmit={handleIssuerSubmit}
                  onBack={() => setStep('choose-role')}
                  isLoading={isLoading}
                />
              </motion.div>
            )}

            {step === 'pending-verification' && address && (
              <motion.div key="pv" exit={{ opacity: 0, x: -20 }}>
                <PendingVerificationStep
                  walletAddress={address}
                  onApproved={handleApproved}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="mt-4 px-6 md:px-10 py-5 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 bg-slate-50/50">
          <span>
            Already have an account?{' '}
            <Link href="/login" className="text-primary hover:underline font-medium">
              Sign in
            </Link>
          </span>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Solana {(process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta').toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}
