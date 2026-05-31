"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Loader2, RefreshCw, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWallet } from "@/hooks/use-wallet";
import { buildAdminWalletHeaders } from "@/lib/admin-wallet-auth";
import { apiFetch } from "@/lib/backend";
import { queryCache } from "@/lib/query-cache";
import { ROLE_WALLETS } from "@/lib/zigchain-config";

type TrustedIssuer = {
  id: string;
  walletAddress: string;
  authorityName: string;
  kycAuthorized: boolean;
  amlAuthorized: boolean;
  createdAt: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function isValidWallet(value: string) {
  try {
    new PublicKey(value.trim());
    return true;
  } catch {
    return false;
  }
}

function AuthorizationBadges({ issuer }: { issuer: TrustedIssuer }) {
  return (
    <div className="flex flex-wrap gap-2">
      {issuer.kycAuthorized ? <Badge className="bg-[#172E7F] text-white">KYC topic 1</Badge> : null}
      {issuer.amlAuthorized ? <Badge className="bg-[#CBA135] text-white">AML topic 2</Badge> : null}
    </div>
  );
}

export default function PersonnelPage() {
  const { address, connectWallet, isConnected, isConnecting } = useWallet();
  const { signMessage } = useSolanaWallet();
  const [trustedIssuers, setTrustedIssuers] = useState<TrustedIssuer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [issuerWallet, setIssuerWallet] = useState("");
  const [authorityName, setAuthorityName] = useState("");
  const [kycAuthorized, setKycAuthorized] = useState(false);
  const [amlAuthorized, setAmlAuthorized] = useState(false);

  const isPlatformAdmin =
    Boolean(address) &&
    address?.toLowerCase() === ROLE_WALLETS.platformOwner.toLowerCase();

  const loadTrustedIssuers = useCallback(async () => {
    setLoading(true);
    try {
      setTrustedIssuers(await apiFetch<TrustedIssuer[]>("/trusted-issuers"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load trusted issuers.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadTrustedIssuers);
  }, [loadTrustedIssuers]);

  const resetForm = () => {
    setIssuerWallet("");
    setAuthorityName("");
    setKycAuthorized(false);
    setAmlAuthorized(false);
  };

  const addTrustedIssuer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPlatformAdmin) {
      toast.error("Connect the platform admin wallet to add trusted issuers.");
      return;
    }
    if (!isValidWallet(issuerWallet)) {
      toast.error("Enter a valid Solana issuer wallet address.");
      return;
    }
    if (!kycAuthorized && !amlAuthorized) {
      toast.error("Authorize the issuer for KYC, AML, or both.");
      return;
    }

    setSaving(true);
    const toastId = toast.loading("Saving trusted issuer...");
    try {
      const body = JSON.stringify({
        walletAddress: issuerWallet.trim(),
        authorityName: authorityName.trim(),
        kycAuthorized,
        amlAuthorized,
      });
      const headers = await buildAdminWalletHeaders({
        body,
        method: "POST",
        path: "/trusted-issuers",
        signMessage,
        walletAddress: address!,
      });
      await apiFetch<TrustedIssuer>("/trusted-issuers", {
        method: "POST",
        body,
        headers,
      });
      queryCache.invalidatePrefix("trusted-provider:");
      resetForm();
      await loadTrustedIssuers();
      toast.success("Trusted issuer added.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add trusted issuer.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const removeTrustedIssuer = async (issuer: TrustedIssuer) => {
    if (!isPlatformAdmin) return;
    setRemovingId(issuer.id);
    const toastId = toast.loading(`Removing ${issuer.authorityName}...`);
    try {
      const path = `/trusted-issuers/${issuer.id}`;
      const headers = await buildAdminWalletHeaders({
        method: "DELETE",
        path,
        signMessage,
        walletAddress: address!,
      });
      await apiFetch(path, { method: "DELETE", headers });
      queryCache.invalidatePrefix("trusted-provider:");
      await loadTrustedIssuers();
      toast.success("Trusted issuer removed.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove trusted issuer.", { id: toastId });
    } finally {
      setRemovingId(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-xl bg-[#172E7F] p-3 text-white">
            <Wallet className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">Trusted Issuer Registry</h1>
          <p className="mt-2 text-sm text-slate-600">
            Connect the platform admin wallet to manage approved KYC and AML authorities.
          </p>
          <Button className="mt-6 bg-[#172E7F] hover:bg-[#21439B]" onClick={connectWallet} disabled={isConnecting}>
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  if (!isPlatformAdmin) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            This page is restricted to the platform admin wallet.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-[22px] p-8 glass-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-[#CBA135]/40 text-[#172E7F]">
            Platform Administration
          </Badge>
          <h1 className="text-3xl font-semibold text-slate-950">Trusted Issuer Registry</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Approve the authorities that token administrators can assign to KYC and AML claim topics.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadTrustedIssuers()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Card className="border-slate-200 bg-white">
        <CardHeader>
          <CardTitle>Add trusted issuer</CardTitle>
          <CardDescription>
            Save an approved issuer authority and the claim topics it is permitted to issue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={addTrustedIssuer}>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="issuer-wallet">Issuer wallet address</Label>
                <Input
                  id="issuer-wallet"
                  value={issuerWallet}
                  onChange={(event) => setIssuerWallet(event.target.value)}
                  placeholder="Solana wallet address"
                  className="font-mono text-sm"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="issuer-authority-name">Issuer authority name</Label>
                <Input
                  id="issuer-authority-name"
                  value={authorityName}
                  onChange={(event) => setAuthorityName(event.target.value)}
                  placeholder="e.g. Acme Compliance Services"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Authorized claim topics</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-md border border-slate-200 p-4">
                  <Checkbox checked={kycAuthorized} onCheckedChange={(checked) => setKycAuthorized(checked === true)} />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Authorize for KYC</span>
                    <span className="mt-1 block text-xs text-slate-500">Allows this issuer to apply claim topic 1.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-md border border-slate-200 p-4">
                  <Checkbox checked={amlAuthorized} onCheckedChange={(checked) => setAmlAuthorized(checked === true)} />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">Authorize for AML</span>
                    <span className="mt-1 block text-xs text-slate-500">Allows this issuer to apply claim topic 2.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving} className="bg-[#172E7F] hover:bg-[#21439B]">
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Save trusted issuer
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <div className="mb-3">
          <h2 className="text-lg font-semibold text-slate-950">Approved issuers</h2>
          <p className="text-sm text-slate-600">These authorities are available during token compliance configuration.</p>
        </div>
        {loading ? (
          <div className="py-10 text-center text-sm text-slate-500">Loading trusted issuers...</div>
        ) : trustedIssuers.length === 0 ? (
          <div className="rounded-md border border-dashed border-slate-300 bg-white/60 py-10 text-center text-sm text-slate-500">
            No trusted issuers have been added yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Authority</th>
                  <th className="px-4 py-3 font-semibold">Wallet address</th>
                  <th className="px-4 py-3 font-semibold">Authorized topics</th>
                  <th className="px-4 py-3 text-right font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trustedIssuers.map((issuer) => (
                  <tr key={issuer.id}>
                    <td className="px-4 py-4 font-medium text-slate-900">{issuer.authorityName}</td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-600" title={issuer.walletAddress}>
                      {shortAddress(issuer.walletAddress)}
                    </td>
                    <td className="px-4 py-4"><AuthorizationBadges issuer={issuer} /></td>
                    <td className="px-4 py-4 text-right">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        title={`Remove ${issuer.authorityName}`}
                        disabled={removingId === issuer.id}
                        onClick={() => void removeTrustedIssuer(issuer)}
                      >
                        {removingId === issuer.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
