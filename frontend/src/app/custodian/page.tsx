'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import {
  Archive,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  IdCard,
  Loader2,
  RefreshCcw,
  Shield,
  ShieldCheck,
  Upload,
  Wallet,
} from 'lucide-react';
import { PublicKey } from '@solana/web3.js';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CountryCodeSelect } from '@/components/identity/country-code-select';
import { ConnectWalletCard } from '@/components/wallet/connect-wallet-card';
import { useAnchorProvider } from '@/hooks/useAnchorProvider';
import { useWallet } from '@/hooks/use-wallet';
import { apiFetch } from '@/lib/backend';
import {
  getDeploymentReadiness,
  listCustodyMandates,
  recordCustodyAttestation,
  recordCustodyMandateAcceptance,
  type CustodyMandate,
  type DeploymentReadiness,
} from '@/lib/custody';
import {
  listPlatformCustodians,
  recordPlatformCustodianFid,
  type PlatformCustodian,
} from '@/lib/platform-custodians';
import { EXPLORER_CLUSTER, EXPLORER_URL } from '@/lib/constants';
import { IdentityService } from '@/services/identity';
import { deriveCustodyAttestation, deriveFidFromWallet, CustodyChainService, sha256Hex, sha256TextHex } from '@/services/custody';

/* ─── Types ─── */

type AssetRequestInfo = {
  id: string;
  name: string;
  symbol: string;
  assetType?: string;
  status?: string;
  underlyingValue?: number | null;
};

/* ─── Helpers ─── */

function shorten(value?: string | null) {
  if (!value) return '—';
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-6)}`;
}

function txUrl(signature?: string | null) {
  if (!signature) return '#';
  const cluster = EXPLORER_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${EXPLORER_CLUSTER}`;
  return `${EXPLORER_URL}/tx/${signature}${cluster}`;
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function statusColor(status: string) {
  if (status === 'READY') return 'bg-emerald-500/15 text-emerald-700 border-emerald-200';
  if (status === 'ATTESTATION_PENDING') return 'bg-blue-500/15 text-blue-700 border-blue-200';
  if (status === 'ONCHAIN_CREATED') return 'bg-violet-500/15 text-violet-700 border-violet-200';
  if (status === 'ASSIGNED') return 'bg-amber-500/15 text-amber-700 border-amber-200';
  if (status.includes('EXPIRED') || status === 'REJECTED') return 'bg-red-500/15 text-red-700 border-red-200';
  return 'bg-slate-100 text-slate-600 border-slate-200';
}

function profileStatusColor(status: string) {
  if (status === 'APPROVED') return 'bg-emerald-600 text-white';
  if (status === 'FID_CREATED') return 'bg-amber-500 text-white';
  if (status === 'SUSPENDED') return 'bg-red-600 text-white';
  return 'bg-[#172E7F] text-white';
}

function statusStep(status: string) {
  if (status === 'ASSIGNED') return 1;
  if (status === 'ONCHAIN_CREATED') return 2;
  if (status === 'ATTESTATION_PENDING') return 3;
  if (status === 'READY') return 4;
  return 0;
}

function formatDate(value?: string | Date | null) {
  if (!value) return '—';
  const d = new Date(value);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/* ─── Sub-components ─── */

function InfoCell({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="group rounded-xl border border-slate-200/80 bg-gradient-to-b from-white to-slate-50/50 p-3.5 transition-all duration-200 hover:border-slate-300 hover:shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1.5 break-all text-xs leading-relaxed text-slate-700 ${mono ? 'font-mono' : 'font-medium'}`}>{value}</p>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: number }) {
  const steps = [
    { label: 'Assigned', step: 1 },
    { label: 'On-chain', step: 2 },
    { label: 'Pending Attestation', step: 3 },
    { label: 'Ready', step: 4 },
  ];
  return (
    <div className="flex items-center gap-1">
      {steps.map(({ label, step }, i) => {
        const isCompleted = currentStep >= step;
        const isCurrent = currentStep === step;
        return (
          <div key={step} className="flex items-center gap-1">
            <div className="flex flex-col items-center">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300 ${
                  isCompleted
                    ? 'bg-[#172E7F] text-white shadow-md shadow-blue-900/20'
                    : 'border border-slate-300 bg-white text-slate-400'
                } ${isCurrent ? 'ring-2 ring-blue-200 ring-offset-1' : ''}`}
              >
                {isCompleted ? '✓' : step}
              </div>
              <p className={`mt-1 text-[9px] font-semibold ${isCompleted ? 'text-[#172E7F]' : 'text-slate-400'}`}>
                {label}
              </p>
            </div>
            {i < steps.length - 1 && (
              <div className={`mb-3 h-[2px] w-4 rounded-full transition-colors lg:w-8 ${currentStep > step ? 'bg-[#172E7F]' : 'bg-slate-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent = false }: { icon: typeof Shield; label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 transition-all duration-200 ${accent ? 'border-[#CBA135]/30 bg-gradient-to-br from-amber-50/60 to-white' : 'border-slate-200/80 bg-gradient-to-br from-white to-slate-50/60'}`}>
      <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent ? 'bg-[#CBA135]/15 text-[#CBA135]' : 'bg-[#172E7F]/10 text-[#172E7F]'}`}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <p className="mt-3 text-xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

/* ─── Main Page ─── */

export default function CustodianPage() {
  const { address, connectWallet, isConnecting } = useWallet();
  const solanaWallet = useSolanaWallet();
  const provider = useAnchorProvider();
  const [custodian, setCustodian] = useState<PlatformCustodian | null>(null);
  const [mandates, setMandates] = useState<CustodyMandate[]>([]);
  const [readiness, setReadiness] = useState<Record<string, DeploymentReadiness>>({});
  const [assetInfoMap, setAssetInfoMap] = useState<Record<string, AssetRequestInfo>>({});
  const [fidCountryCode, setFidCountryCode] = useState('840');
  const [documentHashes, setDocumentHashes] = useState<Record<string, string>>({});
  const [attestationHashes, setAttestationHashes] = useState<Record<string, string>>({});
  const [validityDays, setValidityDays] = useState('365');
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const chain = useMemo(() => {
    if (!provider) return null;
    return new CustodyChainService(provider, solanaWallet.sendTransaction);
  }, [provider, solanaWallet.sendTransaction]);

  const identityService = useMemo(() => {
    if (!provider) return null;
    return new IdentityService(provider);
  }, [provider]);

  const derivedFid = useMemo(() => {
    if (!address) return '';
    try {
      return deriveFidFromWallet(address).toBase58();
    } catch {
      return '';
    }
  }, [address]);

  const load = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const custodianRows = await listPlatformCustodians({ walletAddress: address });
      const currentCustodian = custodianRows[0] || null;
      setCustodian(currentCustodian);

      if (!currentCustodian || currentCustodian.status !== 'APPROVED') {
        setMandates([]);
        setReadiness({});
        setAssetInfoMap({});
        return;
      }

      const mandateRows = await listCustodyMandates({ custodianWallet: address });
      setMandates(mandateRows);

      // Fetch deployment readiness for each unique asset request
      const uniqueRequestIds = Array.from(new Set(mandateRows.map((m) => m.assetRequestId)));
      const readinessPairs = await Promise.all(
        uniqueRequestIds.map(async (assetRequestId) => {
          try {
            return [assetRequestId, await getDeploymentReadiness(assetRequestId)] as const;
          } catch {
            return null;
          }
        }),
      );
      setReadiness(Object.fromEntries(readinessPairs.filter(Boolean) as Array<readonly [string, DeploymentReadiness]>));

      // Fetch asset request info (name, symbol, etc.) for each mandate
      const assetInfoPairs = await Promise.all(
        uniqueRequestIds.map(async (assetRequestId) => {
          try {
            const info = await apiFetch<AssetRequestInfo>(`/asset-requests/${assetRequestId}`);
            return [assetRequestId, info] as const;
          } catch {
            return null;
          }
        }),
      );
      setAssetInfoMap(Object.fromEntries(assetInfoPairs.filter(Boolean) as Array<readonly [string, AssetRequestInfo]>));
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to load custodian portal.'));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runAction(key: string, action: () => Promise<void>) {
    try {
      setBusyAction(key);
      await action();
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, 'Custody action failed.'));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateFid() {
    if (!custodian || !identityService || !address) throw new Error('Custodian wallet is not ready.');
    const country = Number(fidCountryCode);
    if (!Number.isInteger(country) || country <= 0 || country > 999) {
      throw new Error('Custodian FID country must be between 1 and 999.');
    }
    const expectedFid = deriveFidFromWallet(address).toBase58();
    const txHash = await identityService.ensureOwnFid(country, false, 'custodian');
    const fid = await identityService.fetchFid(new PublicKey(address));
    if (!fid) throw new Error('FID transaction confirmed, but FID account could not be fetched yet. Refresh and try recording again.');
    await recordPlatformCustodianFid(custodian.id, {
      fidAddress: expectedFid,
      ...(txHash ? { txHash } : {}),
    });
    toast.success(txHash ? 'Custodian FID created.' : 'Existing custodian FID recorded.');
  }

  async function handleAccept(mandate: CustodyMandate) {
    if (!chain) throw new Error('Wallet provider is not ready.');
    if (address !== mandate.custodianWallet) throw new Error('Connect the assigned custodian wallet to accept this mandate.');
    const result = await chain.acceptCustodyMandate({
      mandateId: mandate.id,
      assetId: mandate.factoryAssetId,
      custodianFid: mandate.custodianFid,
    });
    await recordCustodyMandateAcceptance(mandate.id, {
      txHash: result.signature,
      actorWallet: address || undefined,
    });
    toast.success('Custody mandate accepted.', {
      action: { label: 'View', onClick: () => window.open(txUrl(result.signature), '_blank') },
    });
  }

  async function handleFile(mandateId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const documentHash = await sha256Hex(file);
    const attestationHash = await sha256TextHex(`${mandateId}:${documentHash}:${Date.now()}`);
    setDocumentHashes((current) => ({ ...current, [mandateId]: documentHash }));
    setAttestationHashes((current) => ({ ...current, [mandateId]: attestationHash }));
    toast.success('Evidence hash calculated.');
  }

  async function handleAttest(mandate: CustodyMandate) {
    if (!chain) throw new Error('Wallet provider is not ready.');
    if (address !== mandate.custodianWallet) throw new Error('Connect the assigned custodian wallet to attest custody.');
    const documentHash = documentHashes[mandate.id];
    const attestationHash = attestationHashes[mandate.id];
    if (!documentHash || !attestationHash) throw new Error('Upload or select custody evidence first.');
    const days = Number(validityDays);
    if (!Number.isFinite(days) || days <= 0 || days > 365) throw new Error('Validity must be between 1 and 365 days.');
    const result = await chain.attestCustody({
      mandateId: mandate.id,
      assetId: mandate.factoryAssetId,
      documentHash,
      attestationHash,
      validitySeconds: Math.floor(days * 24 * 60 * 60),
    });
    await recordCustodyAttestation(mandate.id, {
      txHash: result.signature,
      attestationAddress: result.attestationAddress,
      documentHash,
      attestationHash,
      actorWallet: address || undefined,
      metadata: { evidenceSource: 'browser-sha256' },
    });
    toast.success('Custody attestation submitted.', {
      action: { label: 'View', onClick: () => window.open(txUrl(result.signature), '_blank') },
    });
  }

  /* ─── Not connected ─── */
  if (!address) {
    return <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />;
  }

  /* ─── Loading ─── */
  if (loading && !custodian) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-[#172E7F]" />
          <p className="text-sm font-medium text-slate-500">Loading custodian profile…</p>
        </div>
      </div>
    );
  }

  /* ─── Not registered ─── */
  if (!custodian) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <div className="mx-auto flex min-h-[40vh] max-w-lg flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-xl bg-amber-100 p-3.5">
            <Shield className="h-7 w-7 text-amber-600" />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">Not Registered</h1>
          <p className="mt-2 max-w-sm text-sm text-slate-600">
            This wallet is not registered as a platform custodian. Ask the platform admin to register your custodian wallet in Personnel → Custodians.
          </p>
        </div>
      </div>
    );
  }

  /* ─── Stats ─── */
  const totalMandates = mandates.length;
  const readyMandates = mandates.filter((m) => m.status === 'READY').length;
  const pendingMandates = mandates.filter((m) => m.status !== 'READY').length;

  /* ─── Main ─── */
  return (
    <div className="space-y-6 rounded-[22px] p-6 lg:p-8 glass-panel">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-[#CBA135]/40 text-[#172E7F] font-semibold">
            PlatformAuthority Topic 4
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950">Custodian Portal</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Manage custody mandates and submit attestations for assigned assets.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void load()}
          disabled={busyAction !== null || loading}
          className="border-slate-200 bg-white hover:bg-slate-50"
        >
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Profile Card */}
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50/80 to-white pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#172E7F]/10">
                <IdCard className="h-5 w-5 text-[#172E7F]" />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  {custodian.organizationName}
                  <Badge className={profileStatusColor(custodian.status)}>{custodian.status}</Badge>
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Custodian wallet must own its FID and be approved by admin as PlatformAuthority topic 4.
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 md:grid-cols-3">
            <InfoCell label="Wallet Address" value={custodian.walletAddress} mono />
            <InfoCell label="FID Address" value={custodian.fidAddress || derivedFid || 'Pending creation'} mono />
            <InfoCell label="Platform Authority" value={custodian.platformAuthorityAddress || 'Pending admin approval'} mono />
          </div>

          {!custodian.fidAddress ? (
            <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-25 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                  <Fingerprint className="h-4.5 w-4.5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-amber-900">Create Your Custodian FID</p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    A FRACKS Identity (FID) is required to accept custody mandates and submit attestations.
                  </p>
                  <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
                    <div className="w-full max-w-[220px] space-y-1.5">
                      <Label htmlFor="custodian-fid-country" className="text-xs text-amber-800">Country code</Label>
                      <CountryCodeSelect id="custodian-fid-country" value={fidCountryCode} onValueChange={setFidCountryCode} disabled={busyAction !== null} />
                    </div>
                    <Button
                      onClick={() => runAction('create-fid', handleCreateFid)}
                      disabled={busyAction !== null}
                      className="bg-[#172E7F] hover:bg-[#21439B]"
                    >
                      {busyAction === 'create-fid' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <IdCard className="mr-2 h-4 w-4" />}
                      Create Custodian FID
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : custodian.status !== 'APPROVED' ? (
            <Alert className="rounded-xl border-amber-200 bg-amber-50">
              <Clock className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                Your FID is recorded. The platform admin must approve this FID as PlatformAuthority topic 4 before custody mandates are enabled.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="rounded-xl border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-emerald-900">
                Approved and active. You can accept custody mandates and submit attestations for assigned assets.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Stats Row */}
      {custodian.status === 'APPROVED' && mandates.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard icon={FileCheck2} label="Total Mandates" value={String(totalMandates)} />
          <StatCard icon={CheckCircle2} label="Deployment Ready" value={String(readyMandates)} accent />
          <StatCard icon={Clock} label="Pending Actions" value={String(pendingMandates)} />
        </div>
      )}

      {/* Mandates Section */}
      {custodian.status !== 'APPROVED' ? null : (
        <div>
          <div className="mb-4 flex items-center gap-2">
            <FileCheck2 className="h-5 w-5 text-[#172E7F]" />
            <h2 className="text-lg font-bold text-slate-900">Custody Mandates</h2>
            <Badge variant="outline" className="ml-auto border-slate-200 text-slate-500 font-medium">
              {mandates.length} {mandates.length === 1 ? 'mandate' : 'mandates'}
            </Badge>
          </div>

          {mandates.length === 0 ? (
            <Card className="border-dashed border-slate-300 bg-white/60">
              <CardContent className="flex flex-col items-center justify-center py-20 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                  <Archive className="h-7 w-7 text-slate-400" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-slate-900">No Mandates Yet</h3>
                <p className="mt-1.5 max-w-sm text-sm text-slate-500">
                  No custody mandates are assigned to this wallet. Mandates will appear here when an issuer selects you as custodian for their asset.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-5">
              {mandates.map((mandate) => {
                const itemReadiness = readiness[mandate.assetRequestId];
                const assetInfo = assetInfoMap[mandate.assetRequestId];
                const expectedAttestation = mandate.mandateAddress ? deriveCustodyAttestation(mandate.mandateAddress).toBase58() : '';
                const step = statusStep(mandate.status);
                const isReady = mandate.status === 'READY';

                return (
                  <Card key={mandate.id} className="overflow-hidden border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                    {/* Mandate Header */}
                    <CardHeader className="border-b border-slate-100 bg-gradient-to-r from-slate-50/80 via-white to-slate-50/40 pb-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-3">
                          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isReady ? 'bg-emerald-100' : 'bg-[#172E7F]/10'}`}>
                            <FileCheck2 className={`h-5 w-5 ${isReady ? 'text-emerald-600' : 'text-[#172E7F]'}`} />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-lg font-bold text-slate-900">
                                {assetInfo?.name || `Asset #${mandate.factoryAssetId}`}
                              </h3>
                              <Badge variant="outline" className={`text-xs font-bold ${statusColor(mandate.status)}`}>
                                {mandate.status.replaceAll('_', ' ')}
                              </Badge>
                              {itemReadiness?.ready && (
                                <Badge className="bg-emerald-600 text-white shadow-sm shadow-emerald-200">
                                  <CheckCircle2 className="mr-1 h-3 w-3" /> Deployment Ready
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {assetInfo ? (
                                <>
                                  <span className="font-mono text-xs text-slate-400">#{mandate.factoryAssetId}</span>
                                  <span className="mx-1.5 text-slate-300">·</span>
                                  <span className="font-semibold text-slate-600">{assetInfo.symbol}</span>
                                  {assetInfo.assetType && (
                                    <>
                                      <span className="mx-1.5 text-slate-300">·</span>
                                      <span className="capitalize text-slate-500">{assetInfo.assetType.replace('-', ' ')}</span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <>Factory Asset ID: {mandate.factoryAssetId}</>
                              )}
                            </p>
                            <p className="mt-0.5 text-xs text-slate-400">
                              Issuer {shorten(mandate.issuerWallet)} → Custodian {shorten(mandate.custodianWallet)}
                            </p>
                          </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-wrap items-center gap-2">
                          {mandate.createTxHash && (
                            <Button variant="outline" size="sm" className="text-xs" onClick={() => window.open(txUrl(mandate.createTxHash), '_blank')}>
                              <ExternalLink className="mr-1.5 h-3 w-3" /> Create Tx
                            </Button>
                          )}
                          {mandate.acceptTxHash && (
                            <Button variant="outline" size="sm" className="text-xs" onClick={() => window.open(txUrl(mandate.acceptTxHash), '_blank')}>
                              <ExternalLink className="mr-1.5 h-3 w-3" /> Accept Tx
                            </Button>
                          )}
                        </div>
                      </div>

                      {/* Step Indicator */}
                      <div className="mt-4 flex justify-center lg:justify-start">
                        <StepIndicator currentStep={step} />
                      </div>
                    </CardHeader>

                    <CardContent className="space-y-5 pt-5">
                      {/* Info Grid */}
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <InfoCell label="Mandate PDA" value={mandate.mandateAddress || 'Not recorded yet'} mono />
                        <InfoCell label="Attestation PDA" value={expectedAttestation || 'Pending mandate creation'} mono />
                        <InfoCell label="Issuer FID" value={shorten(mandate.issuerFid)} mono />
                        <InfoCell label="Custodian FID" value={shorten(mandate.custodianFid)} mono />
                      </div>

                      {/* Readiness Warnings */}
                      {itemReadiness && !itemReadiness.ready && (
                        <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-amber-25 p-4">
                          <div className="flex items-start gap-3">
                            <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                            <div>
                              <p className="text-xs font-bold uppercase tracking-wider text-amber-700">Action Required</p>
                              <ul className="mt-1.5 space-y-1">
                                {itemReadiness.reasons.map((reason) => (
                                  <li key={reason.code} className="text-sm text-amber-900">
                                    • {reason.message}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Actions Panel */}
                      <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50/50 to-white p-5 space-y-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Custody Actions</p>

                        {/* Row 1: Accept + Upload */}
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#172E7F] text-[9px] font-bold text-white">1</span>
                              <span className="text-xs font-semibold text-slate-700">Accept Mandate</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mb-3">Accept the on-chain custody mandate assigned by the issuer.</p>
                            <Button
                              variant="outline"
                              className="w-full border-slate-200 bg-white"
                              onClick={() => runAction(`accept-${mandate.id}`, () => handleAccept(mandate))}
                              disabled={busyAction !== null || isReady}
                            >
                              {busyAction === `accept-${mandate.id}` ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldCheck className="mr-2 h-4 w-4" />
                              )}
                              Accept Mandate
                            </Button>
                          </div>

                          <div className="rounded-lg border border-slate-200 bg-white p-4">
                            <div className="flex items-center gap-2 mb-3">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#172E7F] text-[9px] font-bold text-white">2</span>
                              <span className="text-xs font-semibold text-slate-700">Custody Evidence</span>
                            </div>
                            <p className="text-[11px] text-slate-500 mb-3">Upload the document proving legal custody of the underlying asset.</p>
                            <input
                              id={`evidence-${mandate.id}`}
                              type="file"
                              className="hidden"
                              onChange={(event) => void handleFile(mandate.id, event)}
                            />
                            {documentHashes[mandate.id] ? (
                              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-emerald-800">
                                  {documentHashes[mandate.id].slice(0, 12)}…{documentHashes[mandate.id].slice(-8)}
                                </span>
                                <button
                                  type="button"
                                  className="shrink-0 text-[11px] font-semibold text-emerald-700 hover:text-emerald-900"
                                  onClick={() => document.getElementById(`evidence-${mandate.id}`)?.click()}
                                >
                                  Change
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => document.getElementById(`evidence-${mandate.id}`)?.click()}
                                className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#172E7F] hover:bg-blue-50/50 hover:text-[#172E7F]"
                              >
                                <Upload className="mr-2 h-4 w-4" />
                                Upload evidence file
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Row 2: Attest */}
                        <div className="rounded-lg border border-slate-200 bg-white p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#172E7F] text-[9px] font-bold text-white">3</span>
                              <div>
                                <span className="text-xs font-semibold text-slate-700">Submit Attestation</span>
                                <p className="text-[11px] text-slate-500">Attest custody on-chain with your evidence hash and validity period.</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="relative">
                                <Input
                                  className="w-24 bg-white text-center text-sm"
                                  value={validityDays}
                                  onChange={(event) => setValidityDays(event.target.value)}
                                  title="Validity days"
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">days</span>
                              </div>
                              <Button
                                onClick={() => runAction(`attest-${mandate.id}`, () => handleAttest(mandate))}
                                disabled={busyAction !== null || !documentHashes[mandate.id]}
                                className="bg-[#172E7F] hover:bg-[#21439B] shadow-sm shadow-blue-900/15 px-5"
                              >
                                {busyAction === `attest-${mandate.id}` ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Submit Attestation
                              </Button>
                            </div>
                          </div>
                        </div>

                        {/* Hash Preview */}
                        {documentHashes[mandate.id] && (
                          <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 space-y-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Evidence Hashes</p>
                            <div className="grid gap-1 md:grid-cols-2">
                              <p className="text-xs text-slate-600">
                                <span className="font-semibold text-slate-500">Document:</span>{' '}
                                <span className="font-mono text-[11px] text-slate-700">{documentHashes[mandate.id]}</span>
                              </p>
                              <p className="text-xs text-slate-600">
                                <span className="font-semibold text-slate-500">Attestation:</span>{' '}
                                <span className="font-mono text-[11px] text-slate-700">{attestationHashes[mandate.id]}</span>
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Timestamps Footer */}
                      <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-[11px] text-slate-400">
                        <span>Created {formatDate(mandate.createdAt)}</span>
                        {mandate.acceptedAt && <span>Accepted {formatDate(mandate.acceptedAt)}</span>}
                        <span>Updated {formatDate(mandate.updatedAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
