"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Building2, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Trash2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { buildAdminWalletHeaders } from "@/lib/admin-wallet-auth";
import { apiFetch } from "@/lib/backend";
import {
  createPlatformCustodian,
  listPlatformCustodians,
  recordPlatformCustodianApproval,
  removePlatformCustodian,
  suspendPlatformCustodian,
  type PlatformCustodian,
} from "@/lib/platform-custodians";
import {
  approvePlatformValuer,
  createPlatformValuer,
  listPlatformValuers,
  removePlatformValuer,
  suspendPlatformValuer,
  type PlatformValuer,
} from "@/lib/valuations";
import { queryCache } from "@/lib/query-cache";
import { ROLE_WALLETS } from "@/lib/zigchain-config";
import { CustodyChainService, deriveFidFromWallet, derivePlatformAuthority } from "@/services/custody";

type TrustedIssuer = {
  id: string;
  walletAddress: string;
  authorityName: string;
  kycAuthorized: boolean;
  amlAuthorized: boolean;
  createdAt: string;
};

function shortAddress(address?: string | null) {
  if (!address) return "-";
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

function RegistryStatusBadge({ status }: { status: string }) {
  const className =
    status === "APPROVED"
      ? "bg-emerald-600 text-white"
      : status === "SUSPENDED"
        ? "bg-red-600 text-white"
        : status === "FID_CREATED"
          ? "bg-amber-500 text-white"
          : "bg-slate-100 text-slate-700";
  return <Badge className={className}>{status}</Badge>;
}

function CustodianStatusBadge({ status }: { status: string }) {
  const className =
    status === "APPROVED"
      ? "bg-emerald-600 text-white"
      : status === "SUSPENDED"
        ? "bg-red-600 text-white"
        : status === "FID_CREATED"
          ? "bg-amber-500 text-white"
          : "bg-slate-100 text-slate-700";
  return <Badge className={className}>{status}</Badge>;
}

export default function PersonnelPage() {
  const { address, connectWallet, isConnected, isConnecting } = useWallet();
  const solanaWallet = useSolanaWallet();
  const { signMessage, sendTransaction } = solanaWallet;
  const provider = useAnchorProvider();
  const chain = useMemo(() => {
    if (!provider) return null;
    return new CustodyChainService(provider, sendTransaction);
  }, [provider, sendTransaction]);

  const [trustedIssuers, setTrustedIssuers] = useState<TrustedIssuer[]>([]);
  const [custodians, setCustodians] = useState<PlatformCustodian[]>([]);
  const [valuers, setValuers] = useState<PlatformValuer[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [busyCustodianId, setBusyCustodianId] = useState<string | null>(null);
  const [busyValuerId, setBusyValuerId] = useState<string | null>(null);
  const [issuerWallet, setIssuerWallet] = useState("");
  const [authorityName, setAuthorityName] = useState("");
  const [kycAuthorized, setKycAuthorized] = useState(false);
  const [amlAuthorized, setAmlAuthorized] = useState(false);
  const [custodianName, setCustodianName] = useState("");
  const [custodianWallet, setCustodianWallet] = useState("");
  const [valuerName, setValuerName] = useState("");
  const [valuerWallet, setValuerWallet] = useState("");

  const isPlatformAdmin =
    Boolean(address) &&
    address?.toLowerCase() === ROLE_WALLETS.platformOwner.toLowerCase();

  const loadTrustedIssuers = useCallback(async () => {
    setTrustedIssuers(await apiFetch<TrustedIssuer[]>("/trusted-issuers"));
  }, []);

  const loadCustodians = useCallback(async () => {
    setCustodians(await listPlatformCustodians());
  }, []);

  const loadValuers = useCallback(async () => {
    setValuers(await listPlatformValuers());
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadTrustedIssuers(), loadCustodians(), loadValuers()]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load personnel records.");
    } finally {
      setLoading(false);
    }
  }, [loadCustodians, loadTrustedIssuers, loadValuers]);

  useEffect(() => {
    void Promise.resolve().then(loadAll);
  }, [loadAll]);

  const resetTrustedIssuerForm = () => {
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
      resetTrustedIssuerForm();
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

  const resetCustodianForm = () => {
    setCustodianName("");
    setCustodianWallet("");
  };

  const addCustodian = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPlatformAdmin) {
      toast.error("Connect the platform admin wallet to add custodians.");
      return;
    }
    if (!isValidWallet(custodianWallet)) {
      toast.error("Enter a valid custodian wallet address.");
      return;
    }
    const body = JSON.stringify({
      organizationName: custodianName.trim(),
      walletAddress: custodianWallet.trim(),
      metadata: { source: "personnel-custodians-tab" },
    });
    const toastId = toast.loading("Registering custodian wallet...");
    setSaving(true);
    try {
      const headers = await buildAdminWalletHeaders({
        body,
        method: "POST",
        path: "/platform-custodians",
        signMessage,
        walletAddress: address!,
      });
      await createPlatformCustodian(JSON.parse(body), headers);
      resetCustodianForm();
      await loadCustodians();
      toast.success("Custodian registered. Ask them to connect and create their FID.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register custodian.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const approveCustodian = async (custodian: PlatformCustodian) => {
    if (!chain || !address) {
      toast.error("Connect the platform admin wallet before approving custody authority.");
      return;
    }
    if (!custodian.fidAddress) {
      toast.error("Custodian must create and record its FID first.");
      return;
    }
    setBusyCustodianId(custodian.id);
    const toastId = toast.loading("Approving PlatformAuthority topic 4...");
    try {
      const { signature, platformAuthority } = await chain.approveCustodianAuthority(custodian.fidAddress);
      const body = JSON.stringify({ platformAuthorityAddress: platformAuthority, txHash: signature });
      const path = `/platform-custodians/${custodian.id}/approval`;
      const headers = await buildAdminWalletHeaders({
        body,
        method: "POST",
        path,
        signMessage,
        walletAddress: address,
      });
      await recordPlatformCustodianApproval(custodian.id, JSON.parse(body), headers);
      await loadCustodians();
      toast.success("Custodian approved as PlatformAuthority topic 4.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve custodian.", { id: toastId });
    } finally {
      setBusyCustodianId(null);
    }
  };

  const suspendCustodian = async (custodian: PlatformCustodian) => {
    if (!isPlatformAdmin || !address) return;
    setBusyCustodianId(custodian.id);
    const toastId = toast.loading(`Suspending ${custodian.organizationName}...`);
    try {
      const path = `/platform-custodians/${custodian.id}/suspend`;
      const headers = await buildAdminWalletHeaders({
        method: "PATCH",
        path,
        signMessage,
        walletAddress: address,
      });
      await suspendPlatformCustodian(custodian.id, headers);
      await loadCustodians();
      toast.success("Custodian suspended in the database.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to suspend custodian.", { id: toastId });
    } finally {
      setBusyCustodianId(null);
    }
  };

  const removeCustodian = async (custodian: PlatformCustodian) => {
    if (!isPlatformAdmin || !address) return;
    if (!window.confirm(`Remove ${custodian.organizationName} from the custodian registry?`)) return;
    setBusyCustodianId(custodian.id);
    const toastId = toast.loading(`Removing ${custodian.organizationName}...`);
    try {
      const path = `/platform-custodians/${custodian.id}`;
      const headers = await buildAdminWalletHeaders({
        method: "DELETE",
        path,
        signMessage,
        walletAddress: address,
      });
      await removePlatformCustodian(custodian.id, headers);
      await loadCustodians();
      toast.success("Custodian removed.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove custodian.", { id: toastId });
    } finally {
      setBusyCustodianId(null);
    }
  };

  const resetValuerForm = () => {
    setValuerName("");
    setValuerWallet("");
  };

  const addValuer = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isPlatformAdmin || !address) {
      toast.error("Connect the platform admin wallet to add valuers.");
      return;
    }
    if (!isValidWallet(valuerWallet)) {
      toast.error("Enter a valid valuer wallet address.");
      return;
    }
    const body = JSON.stringify({
      organizationName: valuerName.trim(),
      walletAddress: valuerWallet.trim(),
      metadata: { source: "personnel-valuers-tab" },
    });
    const toastId = toast.loading("Registering valuer wallet...");
    setSaving(true);
    try {
      const headers = await buildAdminWalletHeaders({ body, method: "POST", path: "/platform-valuers", signMessage, walletAddress: address });
      await createPlatformValuer(JSON.parse(body), headers);
      resetValuerForm();
      await loadValuers();
      toast.success("Valuer registered. Ask them to connect to /valuer and create or record their FID.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register valuer.", { id: toastId });
    } finally {
      setSaving(false);
    }
  };

  const approveValuer = async (valuer: PlatformValuer) => {
    if (!isPlatformAdmin || !address) return;
    if (!valuer.fidAddress) {
      toast.error("Valuer must create and record its FID first.");
      return;
    }
    setBusyValuerId(valuer.id);
    const toastId = toast.loading(`Approving ${valuer.organizationName}...`);
    try {
      const path = `/platform-valuers/${valuer.id}/approval`;
      const headers = await buildAdminWalletHeaders({ method: "POST", path, signMessage, walletAddress: address });
      await approvePlatformValuer(valuer.id, headers);
      await loadValuers();
      toast.success("Valuer approved in backend directory.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to approve valuer.", { id: toastId });
    } finally {
      setBusyValuerId(null);
    }
  };

  const suspendValuer = async (valuer: PlatformValuer) => {
    if (!isPlatformAdmin || !address) return;
    setBusyValuerId(valuer.id);
    const toastId = toast.loading(`Suspending ${valuer.organizationName}...`);
    try {
      const path = `/platform-valuers/${valuer.id}/suspend`;
      const headers = await buildAdminWalletHeaders({ method: "PATCH", path, signMessage, walletAddress: address });
      await suspendPlatformValuer(valuer.id, headers);
      await loadValuers();
      toast.success("Valuer suspended.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to suspend valuer.", { id: toastId });
    } finally {
      setBusyValuerId(null);
    }
  };

  const removeValuer = async (valuer: PlatformValuer) => {
    if (!isPlatformAdmin || !address) return;
    if (!window.confirm(`Remove ${valuer.organizationName} from the valuer registry?`)) return;
    setBusyValuerId(valuer.id);
    const toastId = toast.loading(`Removing ${valuer.organizationName}...`);
    try {
      const path = `/platform-valuers/${valuer.id}`;
      const headers = await buildAdminWalletHeaders({ method: "DELETE", path, signMessage, walletAddress: address });
      await removePlatformValuer(valuer.id, headers);
      await loadValuers();
      toast.success("Valuer removed.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove valuer.", { id: toastId });
    } finally {
      setBusyValuerId(null);
    }
  };
  if (!isConnected) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-xl bg-[#172E7F] p-3 text-white">
            <Wallet className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">Personnel Registry</h1>
          <p className="mt-2 text-sm text-slate-600">
            Connect the platform admin wallet to manage trusted claim issuers, platform custodians, and platform valuers.
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
          <h1 className="text-3xl font-semibold text-slate-950">Personnel Registry</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Manage token-specific trusted claim issuers separately from protocol-level platform custodians.
          </p>
        </div>
        <Button variant="outline" onClick={() => void loadAll()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="trusted-issuers" className="space-y-6">
        <TabsList className="bg-white border p-1">
          <TabsTrigger value="trusted-issuers">Trusted Claim Issuers</TabsTrigger>
          <TabsTrigger value="custodians">Custodians</TabsTrigger>
          <TabsTrigger value="valuers">Valuers</TabsTrigger>
        </TabsList>

        <TabsContent value="trusted-issuers" className="space-y-6">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>Add trusted claim issuer</CardTitle>
              <CardDescription>
                Save an approved issuer authority and the claim topics it is permitted to issue for token TIRs.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-5" onSubmit={addTrustedIssuer}>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="issuer-wallet">Issuer wallet address</Label>
                    <Input id="issuer-wallet" value={issuerWallet} onChange={(event) => setIssuerWallet(event.target.value)} placeholder="Solana wallet address" className="font-mono text-sm" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="issuer-authority-name">Issuer authority name</Label>
                    <Input id="issuer-authority-name" value={authorityName} onChange={(event) => setAuthorityName(event.target.value)} placeholder="e.g. Acme Compliance Services" required />
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
              <h2 className="text-lg font-semibold text-slate-950">Approved claim issuers</h2>
              <p className="text-sm text-slate-600">These authorities are available during token compliance configuration.</p>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading trusted issuers...</div>
            ) : trustedIssuers.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white/60 py-10 text-center text-sm text-slate-500">No trusted issuers have been added yet.</div>
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
                        <td className="px-4 py-4 font-mono text-xs text-slate-600" title={issuer.walletAddress}>{shortAddress(issuer.walletAddress)}</td>
                        <td className="px-4 py-4"><AuthorizationBadges issuer={issuer} /></td>
                        <td className="px-4 py-4 text-right">
                          <Button type="button" size="icon" variant="ghost" title={`Remove ${issuer.authorityName}`} disabled={removingId === issuer.id} onClick={() => void removeTrustedIssuer(issuer)}>
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
        </TabsContent>

        <TabsContent value="valuers" className="space-y-6">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>Register platform valuer</CardTitle>
              <CardDescription>
                This is a backend eligibility directory. On-chain valuation authority is granted later per token by adding the valuer FID to that token TIR with topic 5.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end" onSubmit={addValuer}>
                <div className="space-y-2">
                  <Label htmlFor="valuer-name">Valuer organization</Label>
                  <Input id="valuer-name" value={valuerName} onChange={(event) => setValuerName(event.target.value)} placeholder="e.g. Independent Valuers Ltd." required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="valuer-wallet">Operational wallet</Label>
                  <Input id="valuer-wallet" value={valuerWallet} onChange={(event) => setValuerWallet(event.target.value)} placeholder="Valuer wallet address" className="font-mono text-sm" required />
                </div>
                <Button type="submit" disabled={saving} className="bg-[#172E7F] hover:bg-[#21439B]">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                  Register
                </Button>
              </form>
            </CardContent>
          </Card>

          <div>
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-slate-950">Platform valuers</h2>
              <p className="text-sm text-slate-600">Approved valuers still need token-specific TIR topic 5 trust before they can attest NAV for a token.</p>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading valuers...</div>
            ) : valuers.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white/60 py-10 text-center text-sm text-slate-500">No valuers have been registered yet.</div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Valuer</th>
                      <th className="px-4 py-3 font-semibold">Wallet</th>
                      <th className="px-4 py-3 font-semibold">FID</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {valuers.map((valuer) => {
                      const expectedFid = deriveFidFromWallet(valuer.walletAddress).toBase58();
                      return (
                        <tr key={valuer.id}>
                          <td className="px-4 py-4 font-medium text-slate-900">{valuer.organizationName}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600" title={valuer.walletAddress}>{shortAddress(valuer.walletAddress)}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600" title={valuer.fidAddress || expectedFid}>{valuer.fidAddress ? shortAddress(valuer.fidAddress) : `Expected ${shortAddress(expectedFid)}`}</td>
                          <td className="px-4 py-4"><RegistryStatusBadge status={valuer.status} /></td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <Button type="button" size="sm" variant="outline" disabled={!valuer.fidAddress || valuer.status === "APPROVED" || busyValuerId === valuer.id} onClick={() => void approveValuer(valuer)}>
                                {busyValuerId === valuer.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Approve
                              </Button>
                              <Button type="button" size="sm" variant="outline" disabled={busyValuerId === valuer.id || valuer.status === "SUSPENDED"} onClick={() => void suspendValuer(valuer)}>
                                Suspend
                              </Button>
                              <Button type="button" size="icon" variant="ghost" disabled={busyValuerId === valuer.id} onClick={() => void removeValuer(valuer)}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="custodians" className="space-y-6">
          <Card className="border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>Register platform custodian</CardTitle>
              <CardDescription>
                This only registers the custodian wallet in the database. The custodian must create its own FID before admin can approve PlatformAuthority topic 4.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="grid gap-4 lg:grid-cols-[1fr_1.4fr_auto] lg:items-end" onSubmit={addCustodian}>
                <div className="space-y-2">
                  <Label htmlFor="custodian-name">Custodian organization</Label>
                  <Input id="custodian-name" value={custodianName} onChange={(event) => setCustodianName(event.target.value)} placeholder="e.g. Secure Property Custody Ltd." required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="custodian-wallet">Operational wallet</Label>
                  <Input id="custodian-wallet" value={custodianWallet} onChange={(event) => setCustodianWallet(event.target.value)} placeholder="Custodian wallet address" className="font-mono text-sm" required />
                </div>
                <Button type="submit" disabled={saving} className="bg-[#172E7F] hover:bg-[#21439B]">
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Building2 className="mr-2 h-4 w-4" />}
                  Register
                </Button>
              </form>
            </CardContent>
          </Card>

          <div>
            <div className="mb-3">
              <h2 className="text-lg font-semibold text-slate-950">Platform custodians</h2>
              <p className="text-sm text-slate-600">These records are protocol-level PlatformAuthority topic 4 approvals, not token TIR entries.</p>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-slate-500">Loading custodians...</div>
            ) : custodians.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-300 bg-white/60 py-10 text-center text-sm text-slate-500">No custodians have been registered yet.</div>
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Custodian</th>
                      <th className="px-4 py-3 font-semibold">Wallet</th>
                      <th className="px-4 py-3 font-semibold">FID</th>
                      <th className="px-4 py-3 font-semibold">PlatformAuthority</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 text-right font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {custodians.map((custodian) => {
                      const expectedFid = deriveFidFromWallet(custodian.walletAddress).toBase58();
                      const expectedAuthority = custodian.fidAddress ? derivePlatformAuthority(custodian.fidAddress).toBase58() : null;
                      return (
                        <tr key={custodian.id}>
                          <td className="px-4 py-4 font-medium text-slate-900">{custodian.organizationName}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600" title={custodian.walletAddress}>{shortAddress(custodian.walletAddress)}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600" title={custodian.fidAddress || expectedFid}>{custodian.fidAddress ? shortAddress(custodian.fidAddress) : `Expected ${shortAddress(expectedFid)}`}</td>
                          <td className="px-4 py-4 font-mono text-xs text-slate-600" title={custodian.platformAuthorityAddress || expectedAuthority || undefined}>{custodian.platformAuthorityAddress ? shortAddress(custodian.platformAuthorityAddress) : expectedAuthority ? `Expected ${shortAddress(expectedAuthority)}` : "Pending FID"}</td>
                          <td className="px-4 py-4"><CustodianStatusBadge status={custodian.status} /></td>
                          <td className="px-4 py-4">
                            <div className="flex justify-end gap-2">
                              <Button type="button" size="sm" variant="outline" disabled={!custodian.fidAddress || custodian.status === "APPROVED" || busyCustodianId === custodian.id} onClick={() => void approveCustodian(custodian)}>
                                {busyCustodianId === custodian.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                Approve topic 4
                              </Button>
                              <Button type="button" size="sm" variant="outline" disabled={busyCustodianId === custodian.id || custodian.status === "SUSPENDED"} onClick={() => void suspendCustodian(custodian)}>
                                Suspend
                              </Button>
                              <Button type="button" size="icon" variant="ghost" disabled={busyCustodianId === custodian.id} onClick={() => void removeCustodian(custodian)}>
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}


