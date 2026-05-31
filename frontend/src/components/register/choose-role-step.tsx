'use client';

import { motion } from 'framer-motion';
import { Building2, TrendingUp, ArrowRight, ChevronLeft } from 'lucide-react';

type Role = 'investor' | 'issuer';

interface ChooseRoleStepProps {
  walletAddress: string;
  onSelect: (role: Role) => void;
  onBack: () => void;
}

const roles = [
  {
    id: 'issuer' as Role,
    title: 'Tokenize Your Assets',
    subtitle: 'Asset Issuer',
    description: 'Tokenize real-world assets, manage compliance, and distribute tokens to qualified investors.',
    icon: Building2,
    gradient: 'from-[#172E7F] to-[#2A5FA6]',
    shadowColor: 'shadow-[#172E7F]/15',
    features: ['Deploy security tokens', 'Manage investor registry', 'Set compliance rules'],
  },
  {
    id: 'investor' as Role,
    title: 'Invest in Tokenized Assets',
    subtitle: 'Investor',
    description: 'Browse and invest in tokenized real-world assets with institutional-grade compliance.',
    icon: TrendingUp,
    gradient: 'from-[#CBA135] to-[#E5B84A]',
    shadowColor: 'shadow-[#CBA135]/15',
    features: ['Access verified assets', 'Track your portfolio', 'Compliant trading'],
  },
];

export function ChooseRoleStep({ walletAddress, onSelect, onBack }: ChooseRoleStepProps) {
  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`
    : '';

  return (
    <div className="flex flex-col items-center min-h-[520px] px-4 pt-2">
      <motion.button
        onClick={onBack}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="self-start flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-4"
      >
        <ChevronLeft className="h-4 w-4" /> Back
      </motion.button>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h2 className="text-2xl font-bold text-slate-900 mb-1">Choose Your Path</h2>
        <p className="text-slate-500 text-sm">
          Connected as{' '}
          <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded-md">
            {shortAddr}
          </span>
        </p>
      </motion.div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full mt-4">
        {roles.map((role, i) => (
          <motion.button
            key={role.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.1 }}
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(role.id)}
            className={`group relative text-left p-6 rounded-2xl border border-slate-200/70 bg-white/90 backdrop-blur shadow-lg ${role.shadowColor} hover:shadow-xl transition-all duration-300 cursor-pointer`}
          >
            {/* Icon */}
            <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${role.gradient} flex items-center justify-center mb-4 shadow-md`}>
              <role.icon className="h-6 w-6 text-white" />
            </div>

            <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
              {role.subtitle}
            </p>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">{role.title}</h3>
            <p className="text-sm text-slate-500 mb-4 leading-relaxed">{role.description}</p>

            <ul className="space-y-1.5 mb-4">
              {role.features.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-slate-500">
                  <div className={`h-1.5 w-1.5 rounded-full bg-gradient-to-r ${role.gradient}`} />
                  {f}
                </li>
              ))}
            </ul>

            <div className="flex items-center gap-1 text-sm font-medium text-slate-600 group-hover:text-[#172E7F] transition-colors">
              Get Started <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  );
}
