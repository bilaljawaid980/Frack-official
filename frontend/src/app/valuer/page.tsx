"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { FileText, IdCard, Loader2, RefreshCw, ShieldCheck, Upload, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CountryCodeSelect } from "@/components/identity/country-code-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import {
  acceptValuerAssignment,
  listPlatformValuers,
  listValuerAssignments,
  recordAssetValuation,
  recordPlatformValuerFid,
  uploadValuationReport,
  type AssetValuerAssignment,
  type PlatformValuer,
  type UploadedValuationReport,
} from "@/lib/valuations";
import { buildAdminWalletHeaders } from "@/lib/admin-wallet-auth";
import { IdentityService } from "@/services/identity";
import { ValuationChainService, deriveValuerFid } from "@/services/valuation";

function shortAddress(value?: string | null) {
  if (!value) return "-";
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}


function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatHash(value?: string | null) {
  if (!value) return "-";
  return value.length > 36 ? `${value.slice(0, 16)}...${value.slice(-16)}` : value;
}
function statusClass(status: string) {
  if (status === "CONFIRMED" || status === "APPROVED") return "bg-emerald-600 text-white";
  if (status === "ATTESTATION_PENDING" || status === "ACCEPTED" || status === "FID_CREATED") return "bg-amber-500 text-white";
  if (status === "REPLACED" || status === "CANCELLED") return "bg-slate-200 text-slate-700";
  if (status === "SUSPENDED") return "bg-red-600 text-white";
  return "bg-[#172E7F] text-white";
}

type FormState = {
  navRaw: string;
  methodologyHash: string;
  navValidityDays: string;
  uploadedDoc: UploadedValuationReport | null;
  busy: boolean;
  uploadBusy: boolean;
};

function defaultFormState(): FormState {
  return { navRaw: "", methodologyHash: "", navValidityDays: "365", uploadedDoc: null, busy: false, uploadBusy: false };
}

export default function ValuerPortalPage() {
  const wallet = useSolanaWallet();
  const provider = useAnchorProvider();
  const [profile, setProfile] = useState<PlatformValuer | null>(null);
  const [assignments, setAssignments] = useState<AssetValuerAssignment[]>([]);
  const [loading, setLoading] = useState(false);
  const [fidCountryCode, setFidCountryCode] = useState("586");
  const [fidBusy, setFidBusy] = useState(false);
  const [forms, setForms] = useState<Record<string, FormState>>({});

  const chain = useMemo(() => {
    if (!provider || !wallet.sendTransaction) return null;
    return new ValuationChainService(provider, wallet.sendTransaction);
  }, [provider, wallet.sendTransaction]);

  const identityService = useMemo(() => {
    if (!provider) return null;
    return new IdentityService(provider);
  }, [provider]);

  const walletAddress = wallet.publicKey?.toBase58() || "";
  const expectedFid = useMemo(() => {
    if (!walletAddress) return "";
    try {
      return deriveValuerFid(walletAddress).toBase58();
    } catch {
      return "";
    }
  }, [walletAddress]);

  const loadAssignments = useCallback(async () => {
    if (!walletAddress) return;
    setLoading(true);
    try {
      const profiles = await listPlatformValuers({ walletAddress });
      const currentProfile = profiles[0] || null;
      setProfile(currentProfile);

      if (!currentProfile || currentProfile.status !== "APPROVED") {
        setAssignments([]);
        return;
      }

      const rows = await listValuerAssignments({ valuerWallet: walletAddress });
      setAssignments(rows);
      setForms((current) => {
        const next = { ...current };
        for (const row of rows) {
          next[row.id] ||= defaultFormState();
        }
        return next;
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load valuer portal.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

  const updateForm = (assignmentId: string, patch: Partial<FormState>) => {
    setForms((current) => ({
      ...current,
      [assignmentId]: { ...(current[assignmentId] || defaultFormState()), ...patch },
    }));
  };

  const createOrRecordFid = async () => {
    if (!profile || !identityService || !walletAddress || !expectedFid) {
      toast.error("Registered valuer wallet is not ready.");
      return;
    }
    const country = Number(fidCountryCode);
    if (!Number.isInteger(country) || country <= 0 || country > 999) {
      toast.error("Valuer FID country must be between 1 and 999.");
      return;
    }

    setFidBusy(true);
    const toastId = toast.loading("Creating or recording valuer FID...");
    try {
      const txHash = await identityService.ensureOwnFid(country, true, "valuer");
      const fid = await identityService.fetchFid(new PublicKey(walletAddress));
      if (!fid) throw new Error("FID transaction confirmed, but the FID account could not be fetched yet. Refresh and try again.");
      await recordPlatformValuerFid(profile.id, {
        fidAddress: expectedFid,
        ...(txHash ? { txHash } : {}),
      });
      await loadAssignments();
      toast.success(txHash ? "Valuer FID created." : "Existing valuer FID recorded.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create valuer FID.", { id: toastId });
    } finally {
      setFidBusy(false);
    }
  };

  const acceptAssignment = async (assignment: AssetValuerAssignment) => {
    if (!walletAddress) return;
    updateForm(assignment.id, { busy: true });
    const toastId = toast.loading("Accepting valuation assignment...");
    try {
      await acceptValuerAssignment(assignment.id, { actorWallet: walletAddress });
      await loadAssignments();
      toast.success("Assignment accepted.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to accept assignment.", { id: toastId });
    } finally {
      updateForm(assignment.id, { busy: false });
    }
  };


  const uploadReport = async (assignment: AssetValuerAssignment, file: File | null | undefined) => {
    if (!walletAddress || !wallet.signMessage) {
      toast.error("Connect a valuer wallet that supports message signing.");
      return;
    }
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Upload a PDF valuation report.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Valuation report must be 10MB or smaller.");
      return;
    }

    updateForm(assignment.id, { uploadBusy: true });
    const toastId = toast.loading("Uploading valuation report...");
    try {
      const path = `/asset-valuer-assignments/${assignment.id}/valuation-report`;
      const headers = await buildAdminWalletHeaders({
        body: "{}",
        method: "POST",
        path,
        signMessage: wallet.signMessage,
        walletAddress,
      });
      const uploaded = await uploadValuationReport(assignment.id, file, headers);
      updateForm(assignment.id, {
        methodologyHash: uploaded.hash,
        uploadedDoc: uploaded,
        uploadBusy: false,
      });
      toast.success("Valuation report uploaded and hashed.", { id: toastId });
    } catch (error) {
      updateForm(assignment.id, { uploadBusy: false });
      toast.error(error instanceof Error ? error.message : "Failed to upload valuation report.", { id: toastId });
    }
  };
  const submitValuation = async (assignment: AssetValuerAssignment) => {
    if (!chain || !walletAddress) {
      toast.error("Connect the assigned valuer wallet first.");
      return;
    }
    const form = forms[assignment.id] || defaultFormState();
    const validity = Number(form.navValidityDays);
    if (!/^\d+$/.test(form.navRaw) || BigInt(form.navRaw || "0") <= 0n) {
      toast.error("Enter NAV as raw PKR minor units. Example: PKR 100.00 = 10000.");
      return;
    }
    if (!form.uploadedDoc || !/^[0-9a-fA-F]{64}$/.test(form.uploadedDoc.hash.trim())) {
      toast.error("Upload a valuation report PDF before attesting.");
      return;
    }
    if (!Number.isInteger(validity) || validity <= 0) {
      toast.error("Validity days must be a positive whole number.");
      return;
    }

    updateForm(assignment.id, { busy: true });
    const toastId = toast.loading("Submitting valuation attestation...");
    try {
      const { signature } = await chain.attestValuation({
        assignmentId: assignment.id,
        factoryAssetId: assignment.factoryAssetId,
        tokenContract: assignment.tokenContract,
        valuerFid: assignment.valuerFid,
        assetRegistryAddress: assignment.assetRegistryAddress,
        navRaw: form.navRaw,
        methodologyHash: form.uploadedDoc.hash,
        navValidityDays: validity,
      });
      await recordAssetValuation(assignment.id, {
        txHash: signature,
        navRaw: form.navRaw,
        navValidityDays: validity,
        methodologyHash: form.uploadedDoc.hash,
        reportDocumentId: form.uploadedDoc.documentId,
        actorWallet: walletAddress,
      });
      await loadAssignments();
      toast.success("Valuation confirmed and recorded.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit valuation.", { id: toastId });
    } finally {
      updateForm(assignment.id, { busy: false });
    }
  };

  if (!wallet.connected) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-xl bg-[#172E7F] p-3 text-white">
            <Wallet className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-slate-950">Valuer Portal</h1>
          <p className="mt-2 text-sm text-slate-600">Connect your registered valuer wallet to manage valuation assignments.</p>
          <Button className="mt-6 bg-[#172E7F] hover:bg-[#21439B]" onClick={() => void wallet.connect()}>
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 rounded-[22px] p-8 glass-panel">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-[#CBA135]/40 text-[#172E7F]">Topic 5 Valuation Authority</Badge>
          <h1 className="text-3xl font-semibold text-slate-950">Valuer Portal</h1>
          <p className="mt-2 text-sm text-slate-600">Connected wallet: <span className="font-mono">{shortAddress(walletAddress)}</span></p>
        </div>
        <Button variant="outline" onClick={() => void loadAssignments()} disabled={loading || fidBusy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {!profile ? (
        <Alert className="border-amber-200 bg-amber-50">
          <ShieldCheck className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            This wallet is not registered as a platform valuer. Ask the platform admin to register it in Personnel.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="border-slate-200 bg-white">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <IdCard className="h-5 w-5 text-[#172E7F]" /> {profile.organizationName}
              <Badge className={statusClass(profile.status)}>{profile.status}</Badge>
            </CardTitle>
            <CardDescription>
              Valuer FID is used for token-specific TIR topic 5 trust. It does not make this wallet a global platform custodian.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Wallet</div>
                <div className="mt-1 break-all font-mono text-xs text-slate-700">{profile.walletAddress}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">FID</div>
                <div className="mt-1 break-all font-mono text-xs text-slate-700">{profile.fidAddress || expectedFid || "Pending"}</div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase text-slate-500">Authority Model</div>
                <div className="mt-1 text-sm font-semibold text-slate-900">Token TIR topic 5</div>
              </div>
            </div>

            {!profile.fidAddress ? (
              <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 md:grid-cols-[220px_auto] md:items-end">
                <div className="space-y-2">
                  <Label htmlFor="valuer-fid-country">Valuer FID country code</Label>
                  <CountryCodeSelect id="valuer-fid-country" value={fidCountryCode} onValueChange={setFidCountryCode} disabled={fidBusy} />
                </div>
                <Button onClick={() => void createOrRecordFid()} disabled={fidBusy} className="bg-[#172E7F] hover:bg-[#21439B] md:w-fit">
                  {fidBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <IdCard className="mr-2 h-4 w-4" />}
                  Create Valuer FID
                </Button>
              </div>
            ) : profile.status !== "APPROVED" ? (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertDescription className="text-amber-900">
                  Your FID is recorded. The platform admin must approve this valuer profile before assignments are enabled.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert className="border-emerald-200 bg-emerald-50">
                <AlertDescription className="text-emerald-900">
                  This valuer profile is approved. Admin must still trust this FID with topic 5 in each token TIR before valuation attestation works.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="rounded-xl border border-slate-200 bg-white py-16 text-center text-sm text-slate-500">Loading assignments...</div>
      ) : !profile || profile.status !== "APPROVED" ? null : assignments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/70 py-16 text-center text-sm text-slate-500">No valuation assignments are registered for this wallet.</div>
      ) : (
        <div className="grid gap-5">
          {assignments.map((assignment) => {
            const form = forms[assignment.id] || defaultFormState();
            const canAttest = assignment.status === "ACCEPTED" || assignment.status === "ATTESTATION_PENDING" || assignment.status === "CONFIRMED";
            return (
              <Card key={assignment.id} className="border-slate-200 bg-white">
                <CardHeader className="border-b bg-slate-50/60">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <CardTitle>Asset #{assignment.factoryAssetId}</CardTitle>
                      <CardDescription>
                        Token {shortAddress(assignment.tokenContract)} | Asset registry {shortAddress(assignment.assetRegistryAddress)}
                      </CardDescription>
                    </div>
                    <Badge className={statusClass(assignment.status)}>{assignment.status}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5 pt-5">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Valuer FID</div>
                      <div className="mt-1 break-all font-mono text-xs text-slate-700">{assignment.valuerFid}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">TIR State</div>
                      <div className="mt-1 break-all font-mono text-xs text-slate-700">{assignment.tirStateAddress}</div>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase text-slate-500">Topic 5 Trust</div>
                      <div className="mt-1 text-sm font-semibold text-slate-900">{assignment.tirTrustTxHash ? "Recorded" : "Pending admin"}</div>
                    </div>
                  </div>

                  {assignment.status === "ASSIGNED" ? (
                    <Button variant="outline" disabled={form.busy} onClick={() => void acceptAssignment(assignment)}>
                      {form.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                      Accept Assignment
                    </Button>
                  ) : null}

                  <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr_140px_auto] lg:items-end">
                    <div className="space-y-2">
                      <Label>NAV raw</Label>
                      <Input value={form.navRaw} onChange={(event) => updateForm(assignment.id, { navRaw: event.target.value })} placeholder="PKR minor units" />
                    </div>
                    <div className="space-y-2">
                      <Label>Valuation report PDF</Label>
                      <input
                        id={`valuation-report-${assignment.id}`}
                        type="file"
                        accept="application/pdf"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          event.target.value = "";
                          void uploadReport(assignment, file);
                        }}
                      />
                      {form.uploadedDoc ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                                <FileText className="h-4 w-4 shrink-0" />
                                <span className="truncate">{form.uploadedDoc.fileName}</span>
                              </div>
                              <div className="mt-1 text-xs text-emerald-800">{formatFileSize(form.uploadedDoc.sizeBytes)}</div>
                              <div className="mt-2 break-all font-mono text-xs text-emerald-900">SHA-256 {formatHash(form.uploadedDoc.hash)}</div>
                            </div>
                            <Button type="button" variant="outline" size="sm" disabled={form.uploadBusy || form.busy} onClick={() => document.getElementById(`valuation-report-${assignment.id}`)?.click()}>
                              Change
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={form.uploadBusy || form.busy}
                          onClick={() => document.getElementById(`valuation-report-${assignment.id}`)?.click()}
                          className="flex min-h-11 w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-[#172E7F] hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {form.uploadBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                          Upload PDF report
                        </button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Validity days</Label>
                      <Input value={form.navValidityDays} onChange={(event) => updateForm(assignment.id, { navValidityDays: event.target.value })} />
                    </div>
                    <Button disabled={!canAttest || form.busy || form.uploadBusy || !assignment.tirTrustTxHash || !form.uploadedDoc || !form.navRaw || !form.navValidityDays} onClick={() => void submitValuation(assignment)} className="bg-[#172E7F] hover:bg-[#21439B]">
                      {form.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                      Attest
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">NAV convention: total asset NAV in PKR minor units, scale 2. Example: PKR 100.00 is submitted as 10000.</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}


