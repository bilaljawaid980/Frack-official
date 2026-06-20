'use client';

import { ChangeEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { Archive, CheckCircle2, ExternalLink, FileCheck2, IdCard, RefreshCcw, ShieldCheck } from 'lucide-react';
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

function shorten(value?: string | null) {
  if (!value) return '-';
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function txUrl(signature?: string | null) {
  if (!signature) return '#';
  const cluster = EXPLORER_CLUSTER === 'mainnet-beta' ? '' : `?cluster=${EXPLORER_CLUSTER}`;
  return `${EXPLORER_URL}/tx/${signature}${cluster}`;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'READY') return 'default';
  if (status.includes('EXPIRED') || status === 'REJECTED') return 'destructive';
  if (status === 'ASSIGNED' || status === 'ONCHAIN_CREATED') return 'secondary';
  return 'outline';
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function custodianBadgeClass(status: string) {
  if (status === 'APPROVED') return 'bg-emerald-600 text-white';
  if (status === 'FID_CREATED') return 'bg-amber-500 text-white';
  if (status === 'SUSPENDED') return 'bg-red-600 text-white';
  return 'bg-slate-100 text-slate-700';
}

export default function CustodianPage() {
  const { address, connectWallet, isConnecting } = useWallet();
  const solanaWallet = useSolanaWallet();
  const provider = useAnchorProvider();
  const [custodian, setCustodian] = useState<PlatformCustodian | null>(null);
  const [mandates, setMandates] = useState<CustodyMandate[]>([]);
  const [readiness, setReadiness] = useState<Record<string, DeploymentReadiness>>({});
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
        return;
      }

      const mandateRows = await listCustodyMandates({ custodianWallet: address });
      setMandates(mandateRows);
      const readinessPairs = await Promise.all(
        Array.from(new Set(mandateRows.map((mandate) => mandate.assetRequestId))).map(async (assetRequestId) => {
          try {
            return [assetRequestId, await getDeploymentReadiness(assetRequestId)] as const;
          } catch {
            return null;
          }
        }),
      );
      setReadiness(Object.fromEntries(readinessPairs.filter(Boolean) as Array<readonly [string, DeploymentReadiness]>));
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

  if (!address) {
    return <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />;
  }

  if (loading && !custodian) {
    return <div className="p-8 text-sm text-muted-foreground">Loading custodian profile...</div>;
  }

  if (!custodian) {
    return (
      <div className="space-y-6 p-8">
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            This wallet is not registered as a platform custodian. Ask the platform admin to register your custodian wallet in Personnel.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Custodian Portal</h1>
          <p className="text-muted-foreground">
            Accept custody mandates and submit custody attestations with your registered custodian wallet.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={busyAction !== null || loading}>
          <RefreshCcw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IdCard className="h-5 w-5 text-primary" /> {custodian.organizationName}
            <Badge className={custodianBadgeClass(custodian.status)}>{custodian.status}</Badge>
          </CardTitle>
          <CardDescription>
            Custodian wallet {shorten(custodian.walletAddress)} must own its FID and be approved by admin as PlatformAuthority topic 4.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">Wallet</p>
              <p className="mt-1 break-all font-mono text-xs">{custodian.walletAddress}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">FID</p>
              <p className="mt-1 break-all font-mono text-xs">{custodian.fidAddress || derivedFid || 'Pending'}</p>
            </div>
            <div className="rounded-md border p-3">
              <p className="text-xs text-muted-foreground">PlatformAuthority topic 4</p>
              <p className="mt-1 break-all font-mono text-xs">{custodian.platformAuthorityAddress || 'Pending admin approval'}</p>
            </div>
          </div>

          {!custodian.fidAddress ? (
            <div className="grid gap-3 rounded-md border bg-slate-50 p-4 md:grid-cols-[1fr_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="custodian-fid-country">Custodian FID country code</Label>
                <CountryCodeSelect id="custodian-fid-country" value={fidCountryCode} onValueChange={setFidCountryCode} disabled={busyAction !== null} />
              </div>
              <Button onClick={() => runAction('create-fid', handleCreateFid)} disabled={busyAction !== null}>
                <IdCard className="mr-2 h-4 w-4" /> Create Custodian FID
              </Button>
            </div>
          ) : custodian.status !== 'APPROVED' ? (
            <Alert className="border-amber-200 bg-amber-50">
              <ShieldCheck className="h-4 w-4 text-amber-700" />
              <AlertDescription className="text-amber-900">
                Your FID is recorded. The platform admin must approve this FID as PlatformAuthority topic 4 before custody mandates are enabled.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="border-emerald-200 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              <AlertDescription className="text-emerald-900">
                This wallet is approved as a platform custodian and can accept/attest assigned mandates.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {custodian.status !== 'APPROVED' ? null : (
        <div className="grid gap-4">
          {mandates.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <Archive className="mb-3 h-10 w-10" />
                No custody mandates are assigned to this wallet yet.
              </CardContent>
            </Card>
          ) : (
            mandates.map((mandate) => {
              const itemReadiness = readiness[mandate.assetRequestId];
              const expectedAttestation = mandate.mandateAddress ? deriveCustodyAttestation(mandate.mandateAddress).toBase58() : '';
              return (
                <Card key={mandate.id} className="overflow-hidden">
                  <CardHeader className="border-b bg-slate-50/60">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <FileCheck2 className="h-5 w-5 text-primary" /> Asset #{mandate.factoryAssetId}
                          <Badge variant={statusVariant(mandate.status)}>{mandate.status}</Badge>
                          {itemReadiness?.ready ? <Badge className="bg-emerald-600">Deployment Ready</Badge> : null}
                        </CardTitle>
                        <CardDescription>
                          Issuer {shorten(mandate.issuerWallet)} {'->'} Custodian {shorten(mandate.custodianWallet)}
                        </CardDescription>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {mandate.createTxHash ? (
                          <Button variant="outline" size="sm" onClick={() => window.open(txUrl(mandate.createTxHash), '_blank')}>
                            <ExternalLink className="mr-2 h-4 w-4" /> Create Tx
                          </Button>
                        ) : null}
                        {mandate.acceptTxHash ? (
                          <Button variant="outline" size="sm" onClick={() => window.open(txUrl(mandate.acceptTxHash), '_blank')}>
                            <ExternalLink className="mr-2 h-4 w-4" /> Accept Tx
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5 pt-5">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Mandate PDA</p>
                        <p className="mt-1 break-all font-mono text-xs">{mandate.mandateAddress || 'Not recorded yet'}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Attestation PDA</p>
                        <p className="mt-1 break-all font-mono text-xs">{expectedAttestation || 'Pending mandate'}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Issuer FID</p>
                        <p className="mt-1 break-all font-mono text-xs">{mandate.issuerFid}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Custodian FID</p>
                        <p className="mt-1 break-all font-mono text-xs">{mandate.custodianFid}</p>
                      </div>
                    </div>

                    {itemReadiness && !itemReadiness.ready ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {itemReadiness.reasons.map((reason) => reason.message).join(' ')}
                      </div>
                    ) : null}

                    <div className="grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
                      <Button variant="outline" onClick={() => runAction(`accept-${mandate.id}`, () => handleAccept(mandate))} disabled={busyAction !== null || mandate.status === 'READY'}>
                        Accept Mandate
                      </Button>
                      <div className="space-y-2">
                        <Label>Custody evidence</Label>
                        <Input type="file" onChange={(event) => void handleFile(mandate.id, event)} />
                      </div>
                      <div className="flex gap-2">
                        <Input className="w-24" value={validityDays} onChange={(event) => setValidityDays(event.target.value)} />
                        <Button onClick={() => runAction(`attest-${mandate.id}`, () => handleAttest(mandate))} disabled={busyAction !== null || !documentHashes[mandate.id]}>
                          <CheckCircle2 className="mr-2 h-4 w-4" /> Attest
                        </Button>
                      </div>
                    </div>

                    {documentHashes[mandate.id] ? (
                      <div className="rounded-md border bg-muted/30 p-3 text-xs">
                        <p>Document hash: <span className="font-mono">{documentHashes[mandate.id]}</span></p>
                        <p>Attestation hash: <span className="font-mono">{attestationHashes[mandate.id]}</span></p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}


