'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff, ChevronLeft, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';

interface InvestorFormStepProps {
  walletAddress: string;
  onSubmit: (data: { email: string; password: string }) => void;
  onBack: () => void;
  isLoading: boolean;
}

export function InvestorFormStep({ walletAddress, onSubmit, onBack, isLoading }: InvestorFormStepProps) {
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');

  const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }
    if (!acceptTerms) { setError('Please accept the terms'); return; }
    onSubmit({ email, password });
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full max-w-3xl mx-auto"
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-6"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Investor Registration</h2>
        <p className="text-slate-500 text-sm">Create your account to start investing</p>
      </div>

      {/* Wallet badge */}
      <div className="flex items-center justify-center gap-2 mb-6">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-slate-500">Wallet:</span>
          <span className="font-mono text-xs text-slate-700">{shortAddr}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="inv-email">Email</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              id="inv-email"
              type="email"
              placeholder="name@example.com"
              className="pl-10 bg-white/90 border-slate-200/70"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="inv-pw">Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="inv-pw"
                type={showPw ? 'text' : 'password'}
                placeholder="Min. 8 characters"
                className="pl-10 pr-10 bg-white/90 border-slate-200/70"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="inv-cpw">Confirm Password</Label>
            <div className="relative">
              <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                id="inv-cpw"
                type={showConfirm ? 'text' : 'password'}
                placeholder="Re-enter password"
                className="pl-10 pr-10 bg-white/90 border-slate-200/70"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-start space-x-2 pt-2">
          <Checkbox id="inv-terms" checked={acceptTerms} onCheckedChange={(v) => setAcceptTerms(!!v)} />
          <Label htmlFor="inv-terms" className="text-sm font-normal leading-relaxed">
            I agree to the{' '}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          </Label>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-[#172E7F] to-[#2A5FA6] hover:opacity-90 h-11 rounded-xl gap-2"
        >
          {isLoading ? 'Creating Account...' : 'Create Account'}
          {!isLoading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>

      <p className="text-center text-sm text-slate-400 mt-6">
        Already have an account?{' '}
        <Link href="/login" className="text-primary hover:underline font-medium">Sign in</Link>
      </p>
    </motion.div>
  );
}
