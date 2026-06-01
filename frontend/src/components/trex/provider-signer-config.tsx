"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { TransactionToastLink } from "@/lib/solscan";
import { IdentityService } from "@/services/identity";
import type { FidAccount } from "@/types";
import type { BadgeProps } from "@/components/ui/badge";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

type ProviderSignerConfigProps = {
  walletAddress: string;
  onRotated?: () => void;
};

export function ProviderSignerConfig({
  walletAddress,
  onRotated,
}: ProviderSignerConfigProps) {
  const anchorProvider = useAnchorProvider();
  const [fid, setFid] = useState<FidAccount | null>(null);
  const [fidPda, setFidPda] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRestoringWallet, setIsRestoringWallet] = useState(false);

  const claimCount = fid?.claimCount ?? 0;
  const bootstrapAllowed = claimCount === 0;
  const signerAlreadyWallet = fid?.signerKey === walletAddress;

  const statusTone = useMemo<BadgeProps["variant"]>(() => {
    if (!fid) return "secondary";
    if (claimCount > 0) return "destructive";
    return "default";
  }, [claimCount, fid]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!anchorProvider || !walletAddress) return;
      setIsLoading(true);
      try {
        const identity = new IdentityService(anchorProvider);
        const wallet = new PublicKey(walletAddress);
        const [derivedFid] = await identity.findActiveFidPda(wallet);
        const nextFid = await identity.fetchFid(wallet);
        if (!cancelled) {
          setFidPda(derivedFid.toBase58());
          setFid(nextFid);
        }
      } catch (error) {
        if (!cancelled) {
          setFid(null);
          setFidPda(null);
        }
        console.error("Failed to load provider FID signer config", error);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [anchorProvider, walletAddress]);

  const refresh = async () => {
    if (!anchorProvider || !walletAddress) return;
    setIsLoading(true);
    try {
      const identity = new IdentityService(anchorProvider);
      const wallet = new PublicKey(walletAddress);
      const [derivedFid] = await identity.findActiveFidPda(wallet);
      const nextFid = await identity.fetchFid(wallet);
      setFidPda(derivedFid.toBase58());
      setFid(nextFid);
    } finally {
      setIsLoading(false);
    }
  };

  const setSigner = async (nextSigner: string) => {
    if (!anchorProvider) return;
    if (!fid) {
      toast.error("Create the provider FID first.");
      return;
    }
    if (!bootstrapAllowed) {
      toast.error(
        "This provider FID already issued claims. Do not rotate signer keys on a live provider under the current contract rules.",
      );
      return;
    }

    setIsRestoringWallet(true);
    try {
      const identity = new IdentityService(anchorProvider);
      const tx = await identity.setOwnFidSignerKey(new PublicKey(nextSigner));
      toast.success("Wallet signer restored.", {
        description: <TransactionToastLink signature={tx} />,
      });
      await refresh();
      onRotated?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update provider signer key.",
      );
    } finally {
      setIsRestoringWallet(false);
    }
  };

  return (
    <Card className="rounded-2xl bg-white">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Provider Wallet Signer
        </CardTitle>
        <CardDescription>
          This deployed FID program only behaves correctly when the provider FID signer key equals the provider wallet.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Do not use a separate delegated signer with this deployed FID program. Claim
              validity requires the provider FID signer key, the signing keypair, and the
              stored claim signer key to stay aligned.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs text-slate-500">Connected Wallet</p>
            <p className="font-mono text-sm">{walletAddress}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Provider FID PDA</p>
            <p className="font-mono text-sm">{fidPda ?? "Loading..."}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Current Signer Key</p>
            <p className="font-mono text-sm">{fid?.signerKey ?? "Missing FID"}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Claim Count</p>
            <div className="mt-1 flex items-center gap-2">
              <Badge variant={statusTone}>{claimCount}</Badge>
              <span className="text-xs text-slate-500">
                {bootstrapAllowed
                  ? "Safe for one-time bootstrap"
                  : "Live provider: signer changes are unsafe"}
              </span>
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-500">Mode</p>
            <div className="mt-1 flex items-center gap-2">
              {signerAlreadyWallet ? (
                <Badge variant="secondary">Wallet-backed signer active</Badge>
              ) : fid?.signerKey ? (
                <Badge variant="outline">{shortAddress(fid.signerKey)}</Badge>
              ) : (
                <Badge variant="secondary">Unknown</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={isLoading}
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="secondary"
            onClick={() => void setSigner(walletAddress)}
            disabled={
              !fid ||
              signerAlreadyWallet ||
              isRestoringWallet ||
              !bootstrapAllowed
            }
          >
            {isRestoringWallet ? "Restoring..." : "Restore Wallet Signer"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
