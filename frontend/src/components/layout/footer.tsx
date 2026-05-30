'use client';

import { motion } from 'framer-motion';
import { Github, Twitter, Linkedin, ExternalLink } from 'lucide-react';
import Link from 'next/link';

export function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="border-t bg-card"
    >
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Platform Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary to-primary/70" />
              <span className="text-xl font-bold">FRACKS Platform</span>
            </div>
            <p className="text-sm text-muted-foreground">
              FRACKS asset tokenization platform on Solana with integrated compliance controls.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="font-semibold mb-4">Platform</h3>
            <ul className="space-y-2">
              <FooterLink href="/">Dashboard</FooterLink>
              <FooterLink href="/issuance">Asset Issuance</FooterLink>
              <FooterLink href="/compliance">Compliance</FooterLink>
              <FooterLink href="/assets">Browse Assets</FooterLink>
              <FooterLink href="/transfer">Token Management</FooterLink>
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h3 className="font-semibold mb-4">Resources</h3>
            <ul className="space-y-2">
              <li>
                <a
                  href="/compliance"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  Compliance Center <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="/issuance"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  Issuance Center <ExternalLink className="h-3 w-3" />
                </a>
              </li>
              <li>
                <a
                  href="/assets"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  Asset Marketplace <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            </ul>
          </div>

          {/* Social Links */}
          <div>
            <h3 className="font-semibold mb-4">Connect</h3>
            <div className="flex gap-3">
              <SocialIcon href="https://github.com" icon={Github} />
              <SocialIcon href="https://twitter.com" icon={Twitter} />
              <SocialIcon href="https://linkedin.com" icon={Linkedin} />
              <SocialIcon href="https://fracks.io" icon={ExternalLink} />
            </div>
            <div className="mt-6 p-3 rounded-lg bg-muted">
              <p className="text-xs">
                Built for <span className="font-semibold">FRACKS Operations</span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Network: Solana
              </p>
            </div>
          </div>
        </div>

        {/* Copyright & Disclaimer */}
        <div className="mt-8 pt-6 border-t space-y-3">
          <p className="text-sm text-muted-foreground text-center">
            © {currentYear} FRACKS Platform. All rights reserved.
          </p>
          <div className="max-w-3xl mx-auto p-4 rounded-lg bg-muted/50 border border-muted">
            <p className="text-xs text-muted-foreground text-center leading-relaxed">
              <strong className="text-foreground">Operational Notice:</strong> Use authorized FRACKS wallets for issuance, compliance and transfer operations.
            </p>
          </div>
        </div>
      </div>
    </motion.footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <li>
      <Link
        href={href}
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {children}
      </Link>
    </li>
  );
}

function SocialIcon({ href, icon: Icon }: { href: string; icon: any }) {
  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      whileHover={{ scale: 1.1, y: -2 }}
      whileTap={{ scale: 0.95 }}
      className="h-10 w-10 rounded-full border flex items-center justify-center hover:bg-accent"
    >
      <Icon className="h-5 w-5" />
    </motion.a>
  );
}
