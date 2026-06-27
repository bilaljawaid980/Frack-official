"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Building2,
  CheckCircle,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IssuanceForm,
  type StoredLegalDocument,
  type IssuanceFormValues,
} from "@/components/rwa/issuance-form";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useWallet } from "@/hooks/use-wallet";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/backend";
import { buildAdminWalletHeaders } from "@/lib/admin-wallet-auth";
import { downloadDocuments } from "@/lib/document-download";
import {
  createCustodyMandateRecord,
  getDeploymentReadiness,
  recordCustodyMandateCreation,
  type DeploymentReadiness,
} from "@/lib/custody";
import { listPlatformCustodians, type PlatformCustodian } from "@/lib/platform-custodians";
import {
  assignValuerToAssetRequest,
  getValuationReadiness,
  listPlatformValuers,
  listValuerAssignments,
  recordValuerTirTrust,
  type AssetValuerAssignment,
  type PlatformValuer,
} from "@/lib/valuations";
import { CustodyChainService, deriveFidFromWallet } from "@/services/custody";
import { ValuationChainService } from "@/services/valuation";

type IndexedAsset = {
  id: string;
  factoryAssetId?: number | null;
  tokenContract: string;
  referenceId?: string | null;
  name: string;
  symbol: string;
  description?: string | null;
  issuerWallet?: string | null;
  legalOwner?: string | null;
  metadata?: Record<string, unknown> | string | null;
  deployedAt?: string | null;
  lifecycleState?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type IssuanceAsset = {
  id: string;
  dbId: string;
  name: string;
  symbol: string;
  description: string;
  issuer: string;
  referenceId: string;
  assetType: string;
  currency: string;
  location: string;
  underlyingValue: number;
  totalSupply: number;
  tokenContract: string;
  factoryAssetId?: number | null;
  lifecycleState: string;
};

type AssetRequest = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DEPLOYED" | "CANCELED";
  factoryAssetId?: number | null;
  deployedAssetId?: string | null;
  issuerWallet: string;
  legalOwner?: string | null;
  referenceId?: string | null;
  name: string;
  symbol: string;
  description?: string | null;
  assetType: string;
  currency: string;
  location?: string | null;
  underlyingValue?: number | null;
  totalSupply?: number | null;
  decimals?: number | null;
  initialPrice?: number | null;
  claimTopics?: string[] | null;
  trustedIssuers?: unknown;
  complianceModules?: string[] | null;
  documents?: unknown;
  metadata?: Record<string, unknown> | string | null;
  createdAt: string;
};

type RequestDocument = StoredLegalDocument;


type ProposedCustodian = {
  id?: string;
  organizationName?: string;
  walletAddress?: string;
  fidAddress?: string;
  platformAuthorityAddress?: string | null;
  authorityTopic?: number;
  status?: string;
};

function shortAddress(value?: string | null, head = 6, tail = 6) {
  if (!value) return "Pending";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function proposedCustodianFromRequest(request: AssetRequest | null): ProposedCustodian | null {
  if (!request) return null;
  const metadata = parseMetadata(request.metadata ?? null);
  const custody = metadata.custody && typeof metadata.custody === "object"
    ? (metadata.custody as Record<string, unknown>)
    : {};
  const proposed = custody.proposedCustodian && typeof custody.proposedCustodian === "object"
    ? (custody.proposedCustodian as Record<string, unknown>)
    : null;
  if (!proposed) return null;

  const walletAddress = stringValue(proposed.walletAddress);
  const fidAddress = stringValue(proposed.fidAddress);
  if (!walletAddress && !fidAddress) return null;

  return {
    id: stringValue(proposed.id),
    organizationName: stringValue(proposed.organizationName, "Proposed custodian"),
    walletAddress,
    fidAddress,
    platformAuthorityAddress: stringValue(proposed.platformAuthorityAddress) || null,
    authorityTopic: typeof proposed.authorityTopic === "number" ? proposed.authorityTopic : Number(proposed.authorityTopic || 4),
    status: stringValue(proposed.status, "UNKNOWN"),
  };
}

function deriveIssuerFidAddress(walletAddress?: string | null) {
  if (!walletAddress) return "";
  try {
    return deriveFidFromWallet(walletAddress).toBase58();
  } catch {
    return "";
  }
}

function isValidFinalCustodian(custodian: PlatformCustodian, issuerFid: string) {
  return (
    custodian.status === "APPROVED" &&
    Boolean(custodian.walletAddress) &&
    Boolean(custodian.fidAddress) &&
    Boolean(custodian.platformAuthorityAddress) &&
    custodian.authorityTopic === 4 &&
    (!issuerFid || custodian.fidAddress !== issuerFid)
  );
}

function nextCustodyAction(readiness: DeploymentReadiness | null) {
  const code = readiness?.reasons?.[0]?.code;
  if (!readiness) return "Load custody status";
  if (readiness.ready) return "Ready for deployment";
  if (code === "CUSTODY_MANDATE_NOT_ASSIGNED") return "Create & Send Custody Mandate";
  if (code === "CUSTODY_MANDATE_MISSING") return "Create & Send Custody Mandate";
  if (code === "CUSTODY_MANDATE_NOT_ACCEPTED") return "Waiting for Custodian";
  if (code === "CUSTODY_ATTESTATION_MISSING") return "Custodian Must Submit Attestation";
  if (code === "CUSTODY_ATTESTATION_EXPIRED") return "Request New Attestation";
  if (code === "CUSTODIAN_AUTHORITY_MISSING") return "Approve Custodian Authority";
  return "Resolve custody blockers";
}

function CustodyCheckRow({ done, label, detail }: { done: boolean; label: string; detail?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"}`}>
        {done ? <CheckCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-900">{label}</div>
        {detail ? <div className="mt-0.5 break-all text-xs text-slate-500">{detail}</div> : null}
      </div>
    </div>
  );
}


type ValuationReadiness = Awaited<ReturnType<typeof getValuationReadiness>>;

function AdminValuationPanel({
  asset,
  request,
  walletAddress,
  signMessage,
  chain,
  onRefresh,
}: {
  asset: IssuanceAsset;
  request: AssetRequest | null;
  walletAddress?: string | null;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  chain: ValuationChainService | null;
  onRefresh: () => Promise<void> | void;
}) {
  const [valuers, setValuers] = useState<PlatformValuer[]>([]);
  const [assignments, setAssignments] = useState<AssetValuerAssignment[]>([]);
  const [readiness, setReadiness] = useState<ValuationReadiness | null>(null);
  const [selectedValuerId, setSelectedValuerId] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeAssignment = useMemo(
    () => assignments.find((assignment) => ["ASSIGNED", "ACCEPTED", "ATTESTATION_PENDING", "CONFIRMED"].includes(assignment.status)) || assignments[0] || null,
    [assignments],
  );

  const load = useCallback(async () => {
    if (!request) return;
    setLoading(true);
    try {
      const [valuerRows, assignmentRows, readinessRow] = await Promise.all([
        listPlatformValuers({ status: "APPROVED" }),
        listValuerAssignments({ assetRequestId: request.id }),
        getValuationReadiness({ assetRequestId: request.id }).catch(() => null),
      ]);
      setValuers(valuerRows.filter((valuer) => Boolean(valuer.fidAddress)));
      setAssignments(assignmentRows);
      setReadiness(readinessRow);
      setSelectedValuerId((current) => current || assignmentRows[0]?.valuerProfileId || valuerRows.find((valuer) => valuer.fidAddress)?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load valuation status.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void load();
  }, [load]);

  const assignValuer = async () => {
    if (!request || !walletAddress) return;
    if (!selectedValuerId) {
      toast.error("Select an approved valuer first.");
      return;
    }
    setBusy(true);
    const toastId = toast.loading("Assigning valuer...");
    try {
      const body = JSON.stringify({
        valuerProfileId: selectedValuerId,
        assignedBy: walletAddress,
        tokenContract: asset.tokenContract,
        metadata: { source: "issuance-recent-tokens" },
      });
      const path = `/asset-requests/${request.id}/valuer-assignments`;
      const headers = await buildAdminWalletHeaders({ body, method: "POST", path, signMessage, walletAddress });
      await assignValuerToAssetRequest(request.id, JSON.parse(body), headers);
      await load();
      await onRefresh();
      toast.success("Valuer assigned.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign valuer.", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  const trustValuer = async () => {
    if (!activeAssignment || !walletAddress || !chain) {
      toast.error("Connect the platform admin wallet before trusting a valuer in TIR.");
      return;
    }
    if (!activeAssignment.tokenContract) {
      toast.error("Topic 5 trust can only be added after token deployment.");
      return;
    }
    setBusy(true);
    const toastId = toast.loading("Adding valuer topic 5 trust...");
    try {
      const valuer = valuers.find((row) => row.id === activeAssignment.valuerProfileId);
      const result = await chain.trustValuerInTokenTir({
        assignmentId: activeAssignment.id,
        tokenContract: activeAssignment.tokenContract,
        valuerFid: activeAssignment.valuerFid,
        label: valuer?.organizationName || "Valuer",
      });
      const body = JSON.stringify({
        txHash: result.signature,
        issuerEntryAddress: result.issuerEntry,
        actorWallet: walletAddress,
      });
      const path = `/asset-valuer-assignments/${activeAssignment.id}/tir-trust`;
      const headers = await buildAdminWalletHeaders({ body, method: "POST", path, signMessage, walletAddress });
      await recordValuerTirTrust(activeAssignment.id, JSON.parse(body), headers);
      await load();
      await onRefresh();
      toast.success("Valuer is trusted for topic 5 on this token.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add valuer TIR trust.", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  if (!request) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
        Valuation controls are unavailable because this token is not linked to a deployed issuer request.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#172E7F]" />
            <p className="text-sm font-semibold text-slate-900">Valuation readiness</p>
            <Badge className={readiness?.ready ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}>
              {readiness?.ready ? "Investment Ready" : "Pending"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            One approved valuer must be assigned and submit NAV/report before deployment. Token TIR topic 5 is only post-deployment housekeeping.
          </p>
          {readiness?.reasons?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {readiness.reasons.map((reason) => (
                <Badge key={reason.code} variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                  {reason.message}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading || busy}>
          <Loader2 className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : "hidden"}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Assigned valuer</p>
          <Select value={selectedValuerId} onValueChange={setSelectedValuerId} disabled={busy || valuers.length === 0 || Boolean(activeAssignment)}>
            <SelectTrigger>
              <SelectValue placeholder={valuers.length ? "Select approved valuer" : "No approved valuers with FID"} />
            </SelectTrigger>
            <SelectContent>
              {valuers.map((valuer) => (
                <SelectItem key={valuer.id} value={valuer.id}>
                  {valuer.organizationName} - {shortAddress(valuer.fidAddress)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" onClick={() => void assignValuer()} disabled={busy || loading || Boolean(activeAssignment) || !selectedValuerId}>
          Assign Valuer
        </Button>
        <Button className="bg-[#172E7F] hover:bg-[#21439B]" onClick={() => void trustValuer()} disabled={busy || loading || !activeAssignment || !activeAssignment.tokenContract || Boolean(activeAssignment.tirTrustTxHash)}>
          Trust Topic 5
        </Button>
      </div>

      {activeAssignment ? (
        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 p-2"><span className="font-semibold">Status:</span> {activeAssignment.status}</div>
          <div className="rounded-md bg-slate-50 p-2"><span className="font-semibold">Valuer:</span> {shortAddress(activeAssignment.valuerWallet)}</div>
          <div className="rounded-md bg-slate-50 p-2"><span className="font-semibold">Topic 5:</span> {activeAssignment.tirTrustTxHash ? "Recorded" : "Pending"}</div>
        </div>
      ) : null}
    </div>
  );
}
function AdminCustodyPanel({
  proposedCustodian,
  approvedCustodians,
  selectedCustodian,
  selectedCustodianId,
  issuerFid,
  readiness,
  loading,
  busy,
  onSelectCustodian,
  onCreateMandate,
  onRefresh,
}: {
  proposedCustodian: ProposedCustodian | null;
  approvedCustodians: PlatformCustodian[];
  selectedCustodian: PlatformCustodian | null;
  selectedCustodianId: string;
  issuerFid: string;
  readiness: DeploymentReadiness | null;
  loading: boolean;
  busy: boolean;
  onSelectCustodian: (custodianId: string) => void;
  onCreateMandate: () => void;
  onRefresh: () => void;
}) {
  const checks = readiness?.blockchainChecks;
  const mandate = readiness?.mandate ?? null;
  const attestation = readiness?.attestation ?? null;
  const mandateCreated = Boolean(checks?.mandateExists || mandate?.createTxHash);
  const mandateLocked = Boolean(mandateCreated || mandate?.acceptTxHash || attestation);
  const finalCustodianMatchesProposal =
    Boolean(selectedCustodian?.walletAddress && proposedCustodian?.walletAddress) &&
    selectedCustodian?.walletAddress === proposedCustodian?.walletAddress;
  const canCreateMandate = Boolean(selectedCustodian && issuerFid && !mandateCreated && !busy && !loading);
  const blockerText = readiness?.reasons?.map((reason) => reason.message).join(" ") || "Custody readiness has not been checked yet.";

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-sm">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-slate-950">Custody Setup</h4>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Confirm the asset custodian and send the mandate before deployment. Custody is separate from token trusted issuers.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className={readiness?.ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>
            {readiness?.ready ? "Ready for Deployment" : nextCustodyAction(readiness)}
          </Badge>
          <Button type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading || busy}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Refresh
          </Button>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Issuer proposed</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {proposedCustodian?.organizationName || "No custodian proposed"}
              </p>
            </div>
            {finalCustodianMatchesProposal ? <Badge variant="secondary">Kept</Badge> : <Badge variant="outline">Changed</Badge>}
          </div>
          <div className="grid gap-2 text-xs text-slate-600">
            <div><span className="font-semibold text-slate-800">Wallet:</span> <span className="font-mono">{shortAddress(proposedCustodian?.walletAddress)}</span></div>
            <div><span className="font-semibold text-slate-800">FID:</span> <span className="font-mono">{shortAddress(proposedCustodian?.fidAddress)}</span></div>
            <div><span className="font-semibold text-slate-800">PlatformAuthority:</span> <span className="font-mono">{shortAddress(proposedCustodian?.platformAuthorityAddress)}</span></div>
            <div><span className="font-semibold text-slate-800">Topic:</span> {proposedCustodian?.authorityTopic ?? 4}</div>
            <div><span className="font-semibold text-slate-800">Backend status:</span> {proposedCustodian?.status || "Unknown"}</div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Final custodian</p>
            <p className="mt-1 text-xs text-slate-500">
              {mandateLocked ? "Mandate already exists. Use a formal replacement flow to change custody." : "Select an approved platform custodian."}
            </p>
          </div>
          <Select
            value={selectedCustodianId || undefined}
            onValueChange={onSelectCustodian}
            disabled={loading || busy || mandateLocked || approvedCustodians.length === 0}
          >
            <SelectTrigger className="h-11 bg-slate-50">
              <SelectValue placeholder={loading ? "Loading custodians..." : "Select approved custodian"} />
            </SelectTrigger>
            <SelectContent>
              {approvedCustodians.map((custodian) => (
                <SelectItem key={custodian.id} value={custodian.id}>
                  {custodian.organizationName} - {shortAddress(custodian.walletAddress)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedCustodian ? (
            <div className="mt-3 grid gap-1 text-xs text-slate-600">
              <div><span className="font-semibold text-slate-800">Wallet:</span> <span className="font-mono">{shortAddress(selectedCustodian.walletAddress)}</span></div>
              <div><span className="font-semibold text-slate-800">FID:</span> <span className="font-mono">{shortAddress(selectedCustodian.fidAddress)}</span></div>
              <div><span className="font-semibold text-slate-800">PlatformAuthority:</span> <span className="font-mono">{shortAddress(selectedCustodian.platformAuthorityAddress)}</span></div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-amber-700">No approved custodian is available for this issuer FID.</p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <CustodyCheckRow done={Boolean(selectedCustodian)} label="Custodian selected" detail={selectedCustodian?.organizationName} />
        <CustodyCheckRow done={Boolean(selectedCustodian?.fidAddress && selectedCustodian?.fidAddress !== issuerFid)} label="FID verified" detail={selectedCustodian?.fidAddress || undefined} />
        <CustodyCheckRow done={Boolean(selectedCustodian?.platformAuthorityAddress && selectedCustodian.authorityTopic === 4)} label="PlatformAuthority topic 4" detail={selectedCustodian?.platformAuthorityAddress || undefined} />
        <CustodyCheckRow done={Boolean(mandate)} label={`Current mandate status: ${mandate?.status || "Not created"}`} detail={mandate?.mandateAddress || readiness?.expectedMandate} />
        <CustodyCheckRow done={Boolean(checks?.mandateAccepted)} label={checks?.mandateAccepted ? "Mandate accepted" : mandateCreated ? "Awaiting custodian acceptance" : "Mandate not sent"} />
        <CustodyCheckRow done={Boolean(checks?.custodyAttestationValid)} label={checks?.custodyAttestationValid ? "Custody attestation confirmed" : "Custody attestation pending"} detail={attestation?.expiresAt ? `Expires ${new Date(attestation.expiresAt).toLocaleString()}` : undefined} />
      </div>

      {!readiness?.ready ? (
        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <div className="font-semibold">Deployment blocked</div>
            <div className="mt-1 text-xs leading-5">{blockerText}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-slate-500">
          Attestation status: <span className="font-semibold text-slate-800">{attestation?.status || "Pending"}</span>
          {attestation?.expiresAt ? <span> | Expires {new Date(attestation.expiresAt).toLocaleString()}</span> : null}
        </div>
        <Button
          type="button"
          onClick={onCreateMandate}
          disabled={!canCreateMandate}
          className="bg-linear-to-r from-[#172E7F] to-[#2A5FA6] text-white"
        >
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {mandateCreated ? "Custody Mandate Sent" : "Create & Send Custody Mandate"}
        </Button>
      </div>
    </div>
  );
}
function parseMetadata(metadata: IndexedAsset["metadata"]) {
  if (!metadata) return {};
  if (typeof metadata !== "string") return metadata;
  try {
    return JSON.parse(metadata) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatDocumentType(value?: string) {
  if (!value) return "Document";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatFileSize(size?: number) {
  if (!size || !Number.isFinite(size)) return "";
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function parseRequestDocuments(value: unknown): RequestDocument[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const record = entry as Record<string, unknown>;
      return {
        name: String(record.name || "Document"),
        size:
          typeof record.size === "number" && Number.isFinite(record.size)
            ? record.size
            : undefined,
        type: typeof record.type === "string" ? record.type : undefined,
        documentType:
          typeof record.documentType === "string"
            ? record.documentType
            : undefined,
        bucket: typeof record.bucket === "string" ? record.bucket : undefined,
        path: typeof record.path === "string" ? record.path : undefined,
        publicUrl:
          typeof record.publicUrl === "string" ? record.publicUrl : undefined,
      };
    })
    .filter(Boolean) as RequestDocument[];
}

function mapAsset(asset: IndexedAsset): IssuanceAsset {
  const metadata = parseMetadata(asset.metadata);
  return {
    id: asset.factoryAssetId != null ? String(asset.factoryAssetId) : asset.id,
    dbId: asset.id,
    name: stringValue(metadata.name, asset.name),
    symbol: asset.symbol,
    description: asset.description || stringValue(metadata.description),
    issuer: asset.issuerWallet || asset.legalOwner || "",
    referenceId: asset.referenceId || stringValue(metadata.isin, asset.symbol),
    assetType: stringValue(metadata.assetType, stringValue(metadata.type, "real-estate")),
    currency: stringValue(metadata.currency, "USD"),
    location: stringValue(metadata.location),
    underlyingValue: numberValue(metadata.underlyingValue),
    totalSupply: numberValue(metadata.totalSupply),
    tokenContract: asset.tokenContract,
    factoryAssetId: asset.factoryAssetId ?? null,
    lifecycleState: asset.lifecycleState || "ISSUED",
  };
}

async function parseApiResponse<T>(response: Response, fallback: string): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || fallback);
  }
  return payload?.data as T;
}

export default function IssuancePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { address, connectWallet, isConnecting } = useWallet();
  const solanaWallet = useSolanaWallet();
  const provider = useAnchorProvider();
  const custodyChain = useMemo(() => {
    if (!provider || !solanaWallet.sendTransaction) return null;
    return new CustodyChainService(provider, solanaWallet.sendTransaction);
  }, [provider, solanaWallet.sendTransaction]);
  const valuationChain = useMemo(() => {
    if (!provider || !solanaWallet.sendTransaction) return null;
    return new ValuationChainService(provider, solanaWallet.sendTransaction);
  }, [provider, solanaWallet.sendTransaction]);
  const [assets, setAssets] = useState<IssuanceAsset[]>([]);
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<AssetRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("new");
  const [platformCustodians, setPlatformCustodians] = useState<PlatformCustodian[]>([]);
  const [selectedCustodianId, setSelectedCustodianId] = useState("");
  const [custodyReadiness, setCustodyReadiness] = useState<DeploymentReadiness | null>(null);
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [custodyBusy, setCustodyBusy] = useState(false);

  const loadAssets = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/rwa", { cache: "no-store" });
      const records = await parseApiResponse<IndexedAsset[]>(
        response,
        "Failed to load issued assets.",
      );
      setAssets(records.map(mapAsset));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load assets";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAssetRequests = useCallback(async () => {
    try {
      const requests = await apiFetch<AssetRequest[]>("/asset-requests");
      setAssetRequests(requests);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load asset requests";
      toast.error(message);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadAssets();
      void loadAssetRequests();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadAssetRequests, loadAssets]);

  useEffect(() => {
    const requestId = searchParams.get("requestId");
    if (!requestId) {
      const timeout = window.setTimeout(() => setSelectedRequest(null), 0);
      return () => window.clearTimeout(timeout);
    }

    const timeout = window.setTimeout(async () => {
      try {
        const request = await apiFetch<AssetRequest>(`/asset-requests/${requestId}`);
        setSelectedRequest(request);
        setActiveTab("new");
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to load asset request";
        toast.error(message);
      }
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [searchParams]);

  const pendingRequests = useMemo(
    () => assetRequests.filter((request) => request.status === "PENDING_REVIEW"),
    [assetRequests],
  );

  const recentIssuances = useMemo(
    () =>
      assets
        .filter((asset) => asset.lifecycleState !== "PENDING_APPROVAL")
        .slice(0, 5),
    [assets],
  );

  const stats = useMemo(
    () => ({
      totalIssued: assets.filter((asset) => asset.lifecycleState !== "PENDING_APPROVAL").length,
      totalValue: assets.reduce((sum, asset) => sum + asset.underlyingValue, 0),
      pendingReview: pendingRequests.length,
    }),
    [assets, pendingRequests.length],
  );

  const handleApprove = (request: AssetRequest) => {
    toast.success("Deployment form is ready. The request stays pending until the token is deployed.");
    router.push(`/issuance?requestId=${request.id}`);
  };

  const handleReject = async (request: AssetRequest) => {
    if (!window.confirm("Are you sure you want to reject this request?")) return;

    try {
      await apiFetch(`/asset-requests/${request.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "REJECTED",
          reviewedBy: address,
        }),
      });
      await loadAssetRequests();
      toast.success("Request rejected.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Failed to reject: ${message}`);
    }
  };

  const handleDownloadDocuments = async (request: AssetRequest) => {
    const documents = parseRequestDocuments(request.documents);
    const toastId = toast.loading(
      documents.length > 1 ? "Preparing legal documents ZIP..." : "Downloading legal document...",
    );

    try {
      await downloadDocuments(documents, `${request.symbol}-legal-docs`);
      toast.success("Document download started.", { id: toastId });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to download documents";
      toast.error(message, { id: toastId });
    }
  };

  const selectedRequestDocuments = useMemo(
    () => (selectedRequest ? parseRequestDocuments(selectedRequest.documents) : []),
    [selectedRequest],
  );

  const proposedCustodian = useMemo(
    () => proposedCustodianFromRequest(selectedRequest),
    [selectedRequest],
  );

  const issuerFid = useMemo(
    () => deriveIssuerFidAddress(selectedRequest?.issuerWallet),
    [selectedRequest?.issuerWallet],
  );

  const approvedCustodians = useMemo(
    () => platformCustodians.filter((custodian) => isValidFinalCustodian(custodian, issuerFid)),
    [issuerFid, platformCustodians],
  );

  const selectedCustodian = useMemo(
    () => approvedCustodians.find((custodian) => custodian.id === selectedCustodianId) || null,
    [approvedCustodians, selectedCustodianId],
  );

  const loadCustodyState = useCallback(async () => {
    if (!selectedRequest) {
      setPlatformCustodians([]);
      setSelectedCustodianId("");
      setCustodyReadiness(null);
      return;
    }

    setCustodyLoading(true);
    try {
      const [custodianRows, readiness] = await Promise.all([
        listPlatformCustodians({ status: "APPROVED" }),
        getDeploymentReadiness(selectedRequest.id),
      ]);
      const selectableRows = custodianRows.filter((custodian) => isValidFinalCustodian(custodian, issuerFid));
      setPlatformCustodians(custodianRows);
      setCustodyReadiness(readiness);
      setSelectedCustodianId((current) => {
        if (current && selectableRows.some((custodian) => custodian.id === current)) return current;

        const mandateWallet = readiness.mandate?.custodianWallet;
        const proposedWallet = proposedCustodian?.walletAddress;
        return (
          selectableRows.find((custodian) => custodian.walletAddress === mandateWallet)?.id ||
          selectableRows.find((custodian) => custodian.walletAddress === proposedWallet)?.id ||
          selectableRows[0]?.id ||
          ""
        );
      });
    } catch (error) {
      setCustodyReadiness(null);
      toast.error(error instanceof Error ? error.message : "Failed to load custody status.");
    } finally {
      setCustodyLoading(false);
    }
  }, [issuerFid, proposedCustodian?.walletAddress, selectedRequest]);

  useEffect(() => {
    void loadCustodyState();
  }, [loadCustodyState]);

  const handleCreateCustodyMandate = useCallback(async () => {
    if (!selectedRequest) return;
    if (!address || !custodyChain) {
      toast.error("Connect the platform admin wallet before creating the custody mandate.");
      return;
    }
    if (!issuerFid) {
      toast.error("Issuer FID could not be derived for this request.");
      return;
    }
    if (!selectedCustodian?.fidAddress) {
      toast.error("Select an approved custodian with an FID before creating the mandate.");
      return;
    }

    const existingMandate = custodyReadiness?.mandate ?? null;
    if (existingMandate?.createTxHash || custodyReadiness?.blockchainChecks?.mandateExists) {
      toast.info("Custody mandate already exists for this request.");
      return;
    }
    if (existingMandate && existingMandate.custodianWallet !== selectedCustodian.walletAddress) {
      toast.error("A different custodian assignment already exists. Use a formal replacement flow before changing it.");
      return;
    }

    setCustodyBusy(true);
    const toastId = toast.loading("Creating custody mandate...");
    try {
      const mandate = await createCustodyMandateRecord(selectedRequest.id, {
        issuerFid,
        custodianWallet: selectedCustodian.walletAddress,
        custodianFid: selectedCustodian.fidAddress,
        metadata: {
          selectedBy: address,
          selectedAt: new Date().toISOString(),
          custodianOrganization: selectedCustodian.organizationName,
          proposedCustodian,
        },
      });

      const { signature, mandateAddress } = await custodyChain.createCustodyMandate({
        mandateId: mandate.id,
        assetId: mandate.factoryAssetId,
        issuerWallet: mandate.issuerWallet,
        issuerFid: mandate.issuerFid,
        custodianWallet: mandate.custodianWallet,
        custodianFid: mandate.custodianFid,
      });

      try {
        await recordCustodyMandateCreation(mandate.id, {
          txHash: signature,
          mandateAddress,
          actorWallet: address,
        });
      } catch (recordError) {
        toast.warning("Mandate was created on-chain, but backend recording failed. Use Refresh, then retry backend sync if needed.", {
          id: toastId,
          description: recordError instanceof Error ? recordError.message : undefined,
        });
        await loadCustodyState();
        return;
      }

      await loadCustodyState();
      toast.success("Custody mandate sent. Awaiting custodian acceptance.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create custody mandate.", { id: toastId });
    } finally {
      setCustodyBusy(false);
    }
  }, [address, custodyChain, custodyReadiness, issuerFid, loadCustodyState, proposedCustodian, selectedCustodian, selectedRequest]);
  const selectedRequestValues = useMemo<Partial<IssuanceFormValues> | undefined>(() => {
    if (!selectedRequest) return undefined;
    const requestMetadata = parseMetadata(selectedRequest.metadata ?? null);
    const complianceModuleParams =
      requestMetadata.complianceModuleParams &&
      typeof requestMetadata.complianceModuleParams === "object"
        ? (requestMetadata.complianceModuleParams as Record<string, Record<string, unknown>>)
        : {};
    const trustedIssuers = Array.isArray(selectedRequest.trustedIssuers)
      ? selectedRequest.trustedIssuers.map((issuer: unknown) => {
          const record =
            issuer && typeof issuer === "object"
              ? (issuer as Record<string, unknown>)
              : {};
          return {
            walletAddress: String(record.walletAddress || ""),
            issuerFid: String(record.issuerFid || ""),
            label: String(record.label || ""),
            topics: Array.isArray(record.topics)
              ? record.topics.map((topic: unknown) => BigInt(String(topic)))
            : [1n],
          };
        })
      : [];

    return {
      assetDetails: {
        name: selectedRequest.name,
        symbol: selectedRequest.symbol,
        description: selectedRequest.description || "",
        assetType: selectedRequest.assetType as IssuanceFormValues["assetDetails"]["assetType"],
        underlyingValue: selectedRequest.underlyingValue ?? 100000,
        totalSupply: selectedRequest.totalSupply ?? 1000000,
        location: selectedRequest.location || "",
        currency: selectedRequest.currency,
        issuerWallet: selectedRequest.issuerWallet,
        isin: selectedRequest.referenceId || selectedRequest.symbol,
      },
      complianceRequirements: {
        claimTopics:
          selectedRequest.claimTopics && selectedRequest.claimTopics.length > 0
            ? selectedRequest.claimTopics
            : ["1"],
        trustedIssuers,
        selectedModules: selectedRequest.complianceModules || [],
        moduleParams: complianceModuleParams,
      },
      tokenDetails: {
        decimals: selectedRequest.decimals ?? 6,
        initialPrice: selectedRequest.initialPrice ?? 1,
      },
      documents: parseRequestDocuments(selectedRequest.documents),
    };
  }, [selectedRequest]);

  if (!address) {
    return (
      <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />
    );
  }

  return (
    <div className="space-y-8 p-8 glass-panel rounded-[22px]">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Asset Issuance</h1>
          <p className="text-muted-foreground">
            Review applications from issuers and deploy new tokenized assets.
          </p>
        </div>
        <div className="flex gap-4">
          <Card className="px-6 py-3 bg-primary/5 border-primary/10">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Total Assets
            </p>
            <p className="text-2xl font-bold">{stats.totalIssued}</p>
          </Card>
          <Card className="px-6 py-3 bg-yellow-500/5 border-yellow-500/10">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
              Pending Review
            </p>
            <p className="text-2xl font-bold text-yellow-600">{stats.pendingReview}</p>
          </Card>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted/50 border p-1">
          <TabsTrigger value="new">New Token</TabsTrigger>
          <TabsTrigger value="pending" className="relative">
            Pending Applications
            {stats.pendingReview > 0 && (
              <Badge className="ml-2 bg-yellow-500 hover:bg-yellow-600 px-1.5 h-5 min-w-5 justify-center">
                {stats.pendingReview}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="recent">Recent Tokens</TabsTrigger>
        </TabsList>

        <TabsContent value="new" className="space-y-6">
          {selectedRequest && (
            <Card className="border-amber-200 bg-amber-50/70">
              <CardHeader>
                <CardTitle className="text-base">Deploying Issuer Request</CardTitle>
                <CardDescription>
                  Deploying {selectedRequest.name} for issuer{" "}
                  {selectedRequest.issuerWallet.slice(0, 6)}...
                  {selectedRequest.issuerWallet.slice(-4)}. This request stays in
                  Pending Applications until the token is deployed.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          <IssuanceForm
            onDeployed={async () => {
              await loadAssets();
              await loadAssetRequests();
              if (selectedRequest?.id) {
                const refreshed = await apiFetch<AssetRequest>(`/asset-requests/${selectedRequest.id}`);
                setSelectedRequest(refreshed);
              }
            }}
            initialValues={selectedRequestValues}
            deploymentRequestId={selectedRequest?.id}
            existingDocuments={selectedRequestDocuments}
            documentsReadOnly={!!selectedRequest}
            requireDocumentApproval={!!selectedRequest}
            deploymentReadiness={selectedRequest ? custodyReadiness : null}
            deploymentReadinessLoading={selectedRequest ? custodyLoading : false}
            complianceFooter={
              selectedRequest ? (
                <AdminCustodyPanel
                  proposedCustodian={proposedCustodian}
                  approvedCustodians={approvedCustodians}
                  selectedCustodian={selectedCustodian}
                  selectedCustodianId={selectedCustodianId}
                  issuerFid={issuerFid}
                  readiness={custodyReadiness}
                  loading={custodyLoading}
                  busy={custodyBusy}
                  onSelectCustodian={setSelectedCustodianId}
                  onCreateMandate={() => void handleCreateCustodyMandate()}
                  onRefresh={() => void loadCustodyState()}
                />
              ) : undefined
            }
          />
        </TabsContent>

        <TabsContent value="pending" className="space-y-6">
          <Card className="bg-white rounded-2xl shadow-sm border-slate-200">
            <CardHeader className="border-b bg-slate-50/50">
              <CardTitle className="flex items-center gap-2 text-xl">
                <Clock className="h-5 w-5 text-yellow-500" />
                Issuer Applications
              </CardTitle>
              <CardDescription>
                Applications submitted by issuers awaiting your final approval and deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading applications...
                </div>
              ) : pendingRequests.length === 0 ? (
                <div className="text-center py-16">
                  <div className="h-16 w-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                    <CheckCircle className="h-8 w-8 text-emerald-500" />
                  </div>
                  <h3 className="text-lg font-semibold">Queue Empty</h3>
                  <p className="text-muted-foreground max-w-xs mx-auto">
                    All submitted asset tokenization requests have been reviewed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingRequests.map((request) => {
                    const documents = parseRequestDocuments(request.documents);
                    return (
                    <motion.div
                      key={request.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-6 rounded-xl border border-slate-200 hover:border-primary/20 transition-all bg-white shadow-sm"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                        <div className="flex items-start gap-4">
                          <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                            <Building2 className="h-6 w-6 text-yellow-600" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-bold text-lg">{request.name}</h4>
                              <Badge variant="secondary">{request.symbol}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-3.5 w-3.5" />
                                {request.underlyingValue != null
                                  ? formatCurrency(request.underlyingValue)
                                  : "Admin valuation pending"}
                              </span>
                              <span>
                                Issuer: {request.issuerWallet.slice(0, 6)}...
                                {request.issuerWallet.slice(-4)}
                              </span>
                              <span className="capitalize">
                                {request.assetType.replace("-", " ")}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button
                            className="bg-primary hover:bg-primary/90 text-white font-semibold px-6"
                            onClick={() => handleApprove(request)}
                          >
                            Approve & Prepare Deploy
                          </Button>
                          <Button
                            variant="outline"
                            className="text-slate-600"
                            onClick={() => handleReject(request)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                      {request.description && (
                        <div className="mt-4 pt-4 border-t text-sm text-muted-foreground italic">
                          &quot;{request.description}&quot;
                        </div>
                      )}
                      <div className="mt-4 border-t pt-4">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <FileText className="h-4 w-4 text-[#172E7F]" />
                            Uploaded Documents
                          </div>
                          {documents.length > 0 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                              onClick={() => void handleDownloadDocuments(request)}
                            >
                              <Download className="h-3.5 w-3.5" />
                              {documents.length > 1 ? "Download ZIP" : "Download"}
                            </Button>
                          ) : null}
                        </div>
                        {documents.length === 0 ? (
                          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                            No documents uploaded with this request.
                          </div>
                        ) : (
                          <div className="grid gap-2 md:grid-cols-2">
                            {documents.map((document) => (
                              <div
                                key={document.path || document.name}
                                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"
                              >
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-slate-900">
                                    {document.name}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {formatDocumentType(document.documentType)}
                                    {document.size
                                      ? ` - ${formatFileSize(document.size)}`
                                      : ""}
                                  </div>
                                </div>
                                {document.publicUrl ? (
                                  <a
                                    href={document.publicUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-[#172E7F] hover:bg-slate-100"
                                    title="Open document"
                                  >
                                    <ExternalLink className="h-4 w-4" />
                                  </a>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recent" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Successfully Issued Tokens</CardTitle>
              <CardDescription>
                Tokens currently live on the Solana blockchain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading tokens...
                </div>
              ) : recentIssuances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No active tokens found.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {recentIssuances.map((asset) => {
                    const request = assetRequests.find(
                      (row) =>
                        row.deployedAssetId === asset.tokenContract ||
                        (asset.factoryAssetId != null && row.factoryAssetId === asset.factoryAssetId),
                    ) || null;
                    return (
                      <div key={asset.dbId} className="space-y-3 rounded-xl border bg-slate-50/30 p-4">
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-4">
                            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                              <CheckCircle className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="font-bold">{asset.name}</p>
                              <p className="text-xs text-muted-foreground mono">
                                {asset.tokenContract.slice(0, 8)}...
                                {asset.tokenContract.slice(-8)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold">{formatCurrency(asset.underlyingValue)}</p>
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">
                              Active
                            </Badge>
                          </div>
                        </div>
                        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
                          Valuer assignment and topic 5 trust are managed by the token issuer in the issuer portal after deployment.
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
















