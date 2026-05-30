'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Mail, Lock, Eye, EyeOff, ChevronLeft, ArrowRight,
  User, Globe, MapPin, Phone, Calendar,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import Link from 'next/link';

export interface IssuerFormData {
  email: string;
  password: string;
  fullName: string;
  dateOfBirth: string;
  nationality: string;
  country: string;
  phoneNumber: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
}

interface IssuerFormStepProps {
  walletAddress: string;
  onSubmit: (data: IssuerFormData) => void;
  onBack: () => void;
  isLoading: boolean;
}

export function IssuerFormStep({ walletAddress, onSubmit, onBack, isLoading }: IssuerFormStepProps) {
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '', password: '', confirmPassword: '',
    fullName: '', dateOfBirth: '', nationality: '', country: '',
    phoneNumber: '', addressLine1: '', addressLine2: '',
    city: '', state: '', postalCode: '',
  });

  const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 8) { setError('Password must be at least 8 characters'); return; }
    if (form.password !== form.confirmPassword) { setError('Passwords do not match'); return; }
    if (!acceptTerms) { setError('Please accept the terms'); return; }
    const { confirmPassword: _, ...data } = form;
    onSubmit(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="w-full mx-auto"
    >
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </button>

      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Issuer Application</h2>
        <p className="text-slate-500 text-sm">Complete your profile to tokenize assets</p>
        <div className="inline-flex items-center gap-2 mt-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-sm">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="font-mono text-xs text-slate-700">{shortAddr}</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Account */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Lock className="h-3.5 w-3.5" /> Account Credentials
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="iss-email" className="text-xs">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-email" type="email" placeholder="name@company.com" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.email} onChange={set('email')} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-pw" className="text-xs">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-pw" type={showPw ? 'text' : 'password'} placeholder="Min. 8 chars" className="pl-10 pr-10 bg-white/90 border-slate-200/70 h-10" value={form.password} onChange={set('password')} required />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-cpw" className="text-xs">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-cpw" type={showConfirm ? 'text' : 'password'} placeholder="Re-enter" className="pl-10 pr-10 bg-white/90 border-slate-200/70 h-10" value={form.confirmPassword} onChange={set('confirmPassword')} required />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-3 text-muted-foreground hover:text-foreground">
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Legal Identity */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <User className="h-3.5 w-3.5" /> Legal Identity
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="iss-name" className="text-xs">Full Legal Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-name" placeholder="As on official ID" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.fullName} onChange={set('fullName')} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-dob" className="text-xs">Date of Birth</Label>
              <div className="relative">
                <Calendar className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-dob" type="date" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.dateOfBirth} onChange={set('dateOfBirth')} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-nat" className="text-xs">Nationality</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-nat" placeholder="e.g. United States" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.nationality} onChange={set('nationality')} required />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-country" className="text-xs">Country of Residence</Label>
              <div className="relative">
                <Globe className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-country" placeholder="e.g. United States" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.country} onChange={set('country')} required />
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Contact & Address */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
            <MapPin className="h-3.5 w-3.5" /> Contact & Address
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="iss-phone" className="text-xs">Phone Number</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input id="iss-phone" type="tel" placeholder="+1 555 000 0000" className="pl-10 bg-white/90 border-slate-200/70 h-10" value={form.phoneNumber} onChange={set('phoneNumber')} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-addr1" className="text-xs">Address Line 1</Label>
              <Input id="iss-addr1" placeholder="Street address" className="bg-white/90 border-slate-200/70 h-10" value={form.addressLine1} onChange={set('addressLine1')} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-addr2" className="text-xs">Address Line 2 (optional)</Label>
              <Input id="iss-addr2" placeholder="Apt, Suite, etc." className="bg-white/90 border-slate-200/70 h-10" value={form.addressLine2} onChange={set('addressLine2')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-city" className="text-xs">City</Label>
              <Input id="iss-city" placeholder="City" className="bg-white/90 border-slate-200/70 h-10" value={form.city} onChange={set('city')} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-state" className="text-xs">State / Province</Label>
              <Input id="iss-state" placeholder="State" className="bg-white/90 border-slate-200/70 h-10" value={form.state} onChange={set('state')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="iss-zip" className="text-xs">Postal Code</Label>
              <Input id="iss-zip" placeholder="Postal code" className="bg-white/90 border-slate-200/70 h-10" value={form.postalCode} onChange={set('postalCode')} required />
            </div>
          </div>
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex items-start space-x-2">
          <Checkbox id="iss-terms" checked={acceptTerms} onCheckedChange={(v) => setAcceptTerms(!!v)} />
          <Label htmlFor="iss-terms" className="text-sm font-normal leading-relaxed">
            I agree to the{' '}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>,{' '}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>, and consent to KYC verification
          </Label>
        </div>

        <Button
          type="submit"
          disabled={isLoading}
          className="w-full bg-gradient-to-r from-[#172E7F] to-[#2A5FA6] hover:opacity-90 h-11 rounded-xl gap-2"
        >
          {isLoading ? 'Submitting Application...' : 'Submit Application'}
          {!isLoading && <ArrowRight className="h-4 w-4" />}
        </Button>
      </form>
    </motion.div>
  );
}
