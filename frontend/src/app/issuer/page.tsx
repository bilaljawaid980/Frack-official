"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { useWallet } from "@/hooks/use-wallet";
import { useConnection, useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { createAnchorProvider } from "@/lib/anchor";
import { IdentityService } from "@/services/identity";
import { useActiveTokenHolders } from "@/hooks/useBalance";
import {
  useBurnTokens,
  useFreezeWallet,
  useMintTokens,
  useUnfreezeWallet,
} from "@/hooks/useTokenActions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  LayoutDashboard,
  FileText,
  Coins,
  ArrowLeftRight,
  Building2,
  Wallet,
  ChevronDown,
  Plus,
  Gem,
  Briefcase,
  Landmark,
  Palette,
  Lightbulb,
  Loader2,
  Info,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { apiFetch } from "@/lib/backend";
import { buildAdminWalletHeaders } from "@/lib/admin-wallet-auth";
import { listAssetDocuments, type AssetDocument } from "@/lib/asset-documents";
import { listCustodyMandates, type CustodyMandate } from "@/lib/custody";
import {
  assignValuerToAssetRequest,
  getValuationReadiness,
  listPlatformValuers,
  listValuerAssignments,
  recordValuerTirTrust,
  type AssetValuerAssignment,
  type PlatformValuer,
} from "@/lib/valuations";
import { TransactionToastLink } from "@/lib/solscan";
import {
  recordBlockchainTransaction,
  recordBlockchainTransactionWithSolBalanceImpact,
  recordBlockchainTransactionSafely,
} from "@/lib/blockchain-transactions";
import { cn } from "@/lib/utils";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";
import { ValuationChainService } from "@/services/valuation";

type IndexedAsset = {
  id: string;
  factoryAssetId?: number | null;
  tokenContract: string;
  name: string;
  symbol: string;
  issuerWallet?: string | null;
  legalOwner?: string | null;
};

type IndexedBalance = {
  tokenContract: string;
  walletAddress: string;
  balance: string;
  updatedAt: string;
};

type AssetRequest = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DEPLOYED" | "CANCELED";
  issuerWallet: string;
  factoryAssetId?: number | null;
  deployedAssetId?: string | null;
  name: string;
  symbol: string;
  assetType: string;
  underlyingValue: number | null;
  createdAt: string;
};

type TokenTransferRequest = {
  id: string;
  listingId?: string;
  assetId?: string | null;
  tokenContract: string;
  fromWallet: string;
  sellerWallet?: string;
  toWallet?: string;
  buyerWallet?: string;
  amount?: number;
  amountBaseUnits?: string;
  status: string;
  issuerWallet?: string | null;
  requiredClaimTopics: string[];
  source?: "direct" | "listing";
};

type WalletIdentityQueueState = {
  exists: boolean;
  isActive: boolean;
  loading: boolean;
  canRegister: boolean;
  canActivate: boolean;
  canRepairRegistry: boolean;
  irsOwner?: string | null;
  irpOwner?: string | null;
  agents?: string[];
};

const RECOVERY_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_RECOVERY_TOOLS === "true";

function transferRequestStatusEndpoint(request: TokenTransferRequest) {
  return request.source === "listing"
    ? `/token-listings/buy-intents/${request.id}/status`
    : `/token-transfer-requests/${request.id}/status`;
}

function transferRecipientWallet(request: TokenTransferRequest) {
  const wallet = request.toWallet || request.buyerWallet;
  if (!wallet) throw new Error("Recipient wallet is missing.");
  return wallet;
}

function hasNonZeroBalance(balance: string) {
  try {
    return BigInt(balance) > BigInt(0);
  } catch {
    return Number(balance) > 0;
  }
}

function formatHolderAmount(amount: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (decimals === 0 || fraction === BigInt(0)) return whole.toLocaleString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fractionText}`;
}

function parseTokenAmountInput(value: string, decimals: number) {
  const raw = value.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error("Enter a valid burn amount.");
  }

  const [wholePart, fractionPart = ""] = raw.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`This token supports up to ${decimals} decimal places.`);
  }

  const scale = BigInt(10) ** BigInt(decimals);
  const whole = BigInt(wholePart || "0") * scale;
  const fractionText = fractionPart.padEnd(decimals, "0");
  const fraction = fractionText ? BigInt(fractionText) : BigInt(0);
  const amount = whole + fraction;

  if (amount <= BigInt(0)) {
    throw new Error("Burn amount must be greater than zero.");
  }

  return amount;
}

function formatOptionalCurrency(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toLocaleString()}`
    : "Pending admin review";
}

function shortAddress(value?: string | null) {
  if (!value) return "Not set";
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-6)}` : value;
}
const ASSET_TYPE_ICONS: Record<string, typeof Building2> = {
  "real-estate": Building2,
  commodity: Gem,
  equity: Briefcase,
  debt: Landmark,
  art: Palette,
  "intellectual-property": Lightbulb,
};

function AssetTypeIcon({
  assetType,
  className,
}: {
  assetType: string;
  className?: string;
}) {
  const Icon = ASSET_TYPE_ICONS[assetType] || Building2;
  return <Icon className={className} />;
}

const STATUS_STYLES: Record<string, string> = {
  PENDING_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_KYC: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_AML: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_ISSUER_REVIEW: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_ISSUER_WHITELIST: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING_ISSUER_ACTIVATION: "border-amber-200 bg-amber-50 text-amber-700",
  ACTION_REQUIRED_INVESTOR_IDENTITY: "border-orange-200 bg-orange-50 text-orange-700",
  APPROVED: "border-blue-200 bg-blue-50 text-blue-700",
  APPROVED_FOR_MINT: "border-blue-200 bg-blue-50 text-blue-700",
  READY_TO_TRANSFER: "border-blue-200 bg-blue-50 text-blue-700",
  READY_FOR_SELLER_ACCEPTANCE: "border-blue-200 bg-blue-50 text-blue-700",
  DEPLOYED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MINTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
  CANCELED: "border-slate-200 bg-slate-100 text-slate-600",
  CANCELLED: "border-slate-200 bg-slate-100 text-slate-600",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-bold capitalize",
        STATUS_STYLES[status] || "border-slate-200 bg-slate-100 text-slate-600",
      )}
    >
      {status.replaceAll("_", " ").toLowerCase()}
    </Badge>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  iconClassName,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  hint: string;
  iconClassName?: string;
}) {
  return (
    <Card className="bg-white/90 border-slate-200/70 shadow-sm">
      <CardContent className="p-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-linear-to-br from-slate-50 to-slate-100 border border-slate-200">
          <Icon className={cn("h-5 w-5", iconClassName)} />
        </div>
        <p className="mt-4 text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
        <Icon className="h-6 w-6 text-slate-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
    </div>
  );
}


type ValuationReadiness = Awaited<ReturnType<typeof getValuationReadiness>>;

function registryDocument(documents: AssetDocument[], type: string) {
  return documents.find((document) => document.type === type && /^[0-9a-fA-F]{64}$/.test(document.fileHash));
}

function registryRef(document: AssetDocument | undefined, fallback: string) {
  const value = (document?.fileName || fallback).trim() || fallback;
  return value.length > 64 ? value.slice(0, 64) : value;
}

function IssuerValuationPanel({
  asset,
  request,
  walletAddress,
  signMessage,
  chain,
  onRefresh,
}: {
  asset: IndexedAsset;
  request: AssetRequest | null;
  walletAddress?: string | null;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  chain: ValuationChainService | null;
  onRefresh: () => Promise<void> | void;
}) {
  const [valuers, setValuers] = useState<PlatformValuer[]>([]);
  const [assignments, setAssignments] = useState<AssetValuerAssignment[]>([]);
  const [readiness, setReadiness] = useState<ValuationReadiness | null>(null);
  const [custodyMandate, setCustodyMandate] = useState<CustodyMandate | null>(null);
  const [assetDocuments, setAssetDocuments] = useState<AssetDocument[]>([]);
  const [registryInitialized, setRegistryInitialized] = useState<boolean | null>(null);
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
      const [valuerRows, assignmentRows, readinessRow, mandateRows, documentRows] = await Promise.all([
        listPlatformValuers({ status: "APPROVED" }),
        listValuerAssignments({ assetRequestId: request.id }),
        getValuationReadiness({ assetRequestId: request.id }).catch(() => null),
        listCustodyMandates({ assetRequestId: request.id }).catch(() => []),
        listAssetDocuments(request.id, true).catch(() => []),
      ]);
      const readyValuers = valuerRows.filter((valuer) => Boolean(valuer.fidAddress));
      const currentAssignment = assignmentRows.find((assignment) => ["ASSIGNED", "ACCEPTED", "ATTESTATION_PENDING", "CONFIRMED"].includes(assignment.status)) || assignmentRows[0] || null;
      setValuers(readyValuers);
      setAssignments(assignmentRows);
      setReadiness(readinessRow);
      setCustodyMandate(mandateRows[0] || null);
      setAssetDocuments(documentRows);
      if (chain && currentAssignment) {
        const registry = await chain.isAssetRegistryInitialized({
          factoryAssetId: currentAssignment.factoryAssetId,
          assetRegistryAddress: currentAssignment.assetRegistryAddress,
        }).catch(() => null);
        setRegistryInitialized(registry?.initialized ?? null);
      } else {
        setRegistryInitialized(null);
      }
      setSelectedValuerId((current) => current || assignmentRows[0]?.valuerProfileId || readyValuers[0]?.id || "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load valuation readiness.");
    } finally {
      setLoading(false);
    }
  }, [chain, request]);

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
        metadata: { source: "issuer-assets-tab" },
      });
      const path = `/asset-requests/${request.id}/valuer-assignments`;
      const headers = await buildAdminWalletHeaders({ body, method: "POST", path, signMessage, walletAddress });
      await assignValuerToAssetRequest(request.id, JSON.parse(body), headers);
      await load();
      await onRefresh();
      toast.success("Valuer assigned to this token.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign valuer.", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  const initializeAssetRegistry = async () => {
    if (!activeAssignment || !walletAddress || !chain || !request) {
      toast.error("Assign a valuer and connect the issuer wallet first.");
      return;
    }
    if (request.issuerWallet.toLowerCase() !== walletAddress.toLowerCase()) {
      toast.error(`Connect the issuer wallet ${shortAddress(request.issuerWallet)} to initialize the asset registry.`);
      return;
    }
    if (!custodyMandate) {
      toast.error("Custody mandate data is required before initializing the asset registry.");
      return;
    }
    const fard = registryDocument(assetDocuments, "FARD");
    const whitepaper = registryDocument(assetDocuments, "WHITEPAPER");
    const legalOpinion = registryDocument(assetDocuments, "LEGAL_OPINION");
    const insurancePolicy = registryDocument(assetDocuments, "INSURANCE_POLICY");
    const missing = [
      !fard ? "FARD" : null,
      !whitepaper ? "Whitepaper" : null,
      !legalOpinion ? "Legal opinion" : null,
    ].filter(Boolean);
    if (missing.length) {
      toast.error(`Upload required deployment documents before registry initialization: ${missing.join(", ")}.`);
      return;
    }

    setBusy(true);
    const toastId = toast.loading("Initializing asset registry...");
    try {
      const result = await chain.initializeAssetRegistry({
        assignmentId: activeAssignment.id,
        factoryAssetId: activeAssignment.factoryAssetId,
        assetRegistryAddress: activeAssignment.assetRegistryAddress,
        tokenContract: activeAssignment.tokenContract,
        issuerFid: custodyMandate.issuerFid,
        custodianFid: custodyMandate.custodianFid,
        fardRef: registryRef(fard, String(activeAssignment.factoryAssetId)),
        spvSecpReg: registryRef(registryDocument(assetDocuments, "SPV_REGISTRATION"), request.id),
        province: 0,
        whitepaperHash: whitepaper?.fileHash,
        legalOpinionHash: legalOpinion?.fileHash,
        insurancePolicyHash: insurancePolicy?.fileHash,
        navValidityDays: 365,
        encumbranceFlag: false,
      });
      await load();
      await onRefresh();
      toast.success(result.alreadyInitialized ? "Asset registry is already initialized." : "Asset registry initialized for valuation attestations.", { id: toastId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to initialize asset registry.", { id: toastId });
    } finally {
      setBusy(false);
    }
  };
  const trustValuer = async () => {
    if (!activeAssignment || !walletAddress || !chain) {
      toast.error("Connect the issuer wallet that owns this token TIR.");
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
      toast.error(error instanceof Error ? error.message : "Failed to trust valuer for topic 5.", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  if (!request) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
        Valuation controls will appear once this token is linked to a deployed issuer request.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#172E7F]" />
            <p className="text-sm font-semibold text-slate-900">Valuation readiness</p>
            <Badge className={readiness?.ready ? "bg-emerald-600 text-white" : "bg-amber-500 text-white"}>
              {readiness?.ready ? "Investment Ready" : "Pending"}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Assign a platform-approved valuer, initialize the asset registry, trust the valuer FID in this token TIR for topic 5, then wait for NAV attestation.
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
          <Loader2 className={cn("mr-2 h-3.5 w-3.5", loading ? "animate-spin" : "hidden")} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_auto_auto] lg:items-end">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase text-slate-500">Assigned valuer</p>
          <Select value={selectedValuerId} onValueChange={setSelectedValuerId} disabled={busy || valuers.length === 0 || Boolean(activeAssignment)}>
            <SelectTrigger className="bg-white">
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
        <Button variant="outline" onClick={() => void initializeAssetRegistry()} disabled={busy || loading || !activeAssignment || registryInitialized === true}>
          Init Registry
        </Button>
        <Button className="bg-[#172E7F] hover:bg-[#21439B]" onClick={() => void trustValuer()} disabled={busy || loading || !activeAssignment || Boolean(activeAssignment.tirTrustTxHash)}>
          Trust Topic 5
        </Button>
      </div>

      {activeAssignment ? (
        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-4">
          <div className="rounded-md bg-white p-2"><span className="font-semibold">Status:</span> {activeAssignment.status}</div>
          <div className="rounded-md bg-white p-2"><span className="font-semibold">Registry:</span> {registryInitialized ? "Initialized" : "Pending"}</div>
          <div className="rounded-md bg-white p-2"><span className="font-semibold">Valuer:</span> {shortAddress(activeAssignment.valuerWallet)}</div>
          <div className="rounded-md bg-white p-2"><span className="font-semibold">Topic 5:</span> {activeAssignment.tirTrustTxHash ? "Recorded" : "Pending"}</div>
        </div>
      ) : null}
    </div>
  );
}
function IssuerAssetHoldersTable({
  tokenContract,
  assetId,
  issuerWallet,
  tokenSymbol,
  fallbackBalances,
  loadingFallback,
}: {
  tokenContract: string;
  assetId?: string | number | null;
  issuerWallet?: string | null;
  tokenSymbol?: string;
  fallbackBalances: IndexedBalance[];
  loadingFallback: boolean;
}) {
  const burnTokens = useBurnTokens();
  const freezeWallet = useFreezeWallet();
  const unfreezeWallet = useUnfreezeWallet();
  const [burnAmounts, setBurnAmounts] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { connection } = useConnection();
  const mint = useMemo(() => {
    try {
      return new PublicKey(tokenContract);
    } catch {
      return null;
    }
  }, [tokenContract]);
  const holdersQuery = useActiveTokenHolders(mint, null);
  const liveHolders = useMemo(
    () => holdersQuery.data ?? [],
    [holdersQuery.data],
  );
  const fallbackHolders = useMemo(
    () =>
      fallbackBalances.filter((entry) => hasNonZeroBalance(entry.balance)),
    [fallbackBalances],
  );
  const isLoading = holdersQuery.isLoading || loadingFallback;
  const fallbackDecimals = liveHolders[0]?.decimals ?? 0;

  const holderRows = useMemo(() => {
    if (liveHolders.length > 0) {
      return liveHolders.map((holder) => ({
        wallet: holder.wallet,
        investorLabel:
          holder.identityStatus === "active" ? "Active investor" : "Investor",
        balanceText: formatHolderAmount(holder.amount, holder.decimals),
        balanceBaseUnits: holder.amount,
        decimals: holder.decimals,
      }));
    }

    return fallbackHolders.map((holder) => {
      let balanceBaseUnits: bigint | null = null;
      try {
        balanceBaseUnits = BigInt(holder.balance);
      } catch {
        balanceBaseUnits = null;
      }

      return {
        wallet: holder.walletAddress,
        investorLabel: "Indexed investor",
        balanceText:
          balanceBaseUnits !== null
            ? formatHolderAmount(balanceBaseUnits, fallbackDecimals)
            : holder.balance,
        balanceBaseUnits,
        decimals: fallbackDecimals,
      };
    });
  }, [fallbackDecimals, fallbackHolders, liveHolders]);

  const recordHolderAction = async ({
    signature,
    actionType,
    wallet,
    amount,
    displayAmount,
  }: {
    signature: string;
    actionType: string;
    wallet: string;
    amount?: bigint;
    displayAmount?: string;
  }) => {
    const input = {
      txHash: signature,
      actionType,
      actorWallet: issuerWallet ?? undefined,
      entityType: "token_holder",
      entityId: wallet,
      assetId:
        assetId === null || assetId === undefined ? undefined : String(assetId),
      tokenContract,
      metadata: {
        holderWallet: wallet,
        tokenSymbol,
        amount: amount?.toString(),
        displayAmount,
      },
    };

    if (issuerWallet) {
      await recordBlockchainTransactionWithSolBalanceImpact(
        input,
        connection,
        issuerWallet,
      );
      return;
    }

    await recordBlockchainTransaction(input);
  };

  const handleBurn = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    const displayAmount = burnAmounts[holder.wallet]?.trim() ?? "";
    try {
      const amount = parseTokenAmountInput(displayAmount, holder.decimals);
      if (
        holder.balanceBaseUnits !== null &&
        amount > holder.balanceBaseUnits
      ) {
        toast.error("Burn amount exceeds the holder balance.");
        return;
      }

      setBusyAction(`burn:${holder.wallet}`);
      const signature = await burnTokens.mutateAsync({
        mint,
        from: new PublicKey(holder.wallet),
        amount,
      });

      try {
        await recordHolderAction({
          signature,
          actionType: "TOKENS_BURNED",
          wallet: holder.wallet,
          amount,
          displayAmount,
        });
      } catch {
        toast.error("Burn succeeded, but failed to save the transaction hash.");
      }
      setBurnAmounts((current) => ({ ...current, [holder.wallet]: "" }));
      await holdersQuery.refetch();
      toast.success("Tokens burned", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to burn tokens");
    } finally {
      setBusyAction(null);
    }
  };

  const handleFreeze = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    try {
      setBusyAction(`freeze:${holder.wallet}`);
      const signature = await freezeWallet.mutateAsync({
        mint,
        wallet: new PublicKey(holder.wallet),
      });
      try {
        await recordHolderAction({
          signature,
          actionType: "WALLET_FROZEN",
          wallet: holder.wallet,
        });
      } catch {
        toast.error("Freeze succeeded, but failed to save the transaction hash.");
      }
      await holdersQuery.refetch();
      toast.success("Wallet frozen", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to freeze wallet");
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnfreeze = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    try {
      setBusyAction(`unfreeze:${holder.wallet}`);
      const signature = await unfreezeWallet.mutateAsync({
        mint,
        wallet: new PublicKey(holder.wallet),
      });
      try {
        await recordHolderAction({
          signature,
          actionType: "WALLET_UNFROZEN",
          wallet: holder.wallet,
        });
      } catch {
        toast.error(
          "Unfreeze succeeded, but failed to save the transaction hash.",
        );
      }
      await holdersQuery.refetch();
      toast.success("Wallet unfrozen", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to unfreeze wallet",
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Burn, Freeze, and Unfreeze are issuer wallet transactions. Freeze creates
        a refundable freeze-state account, Unfreeze closes it and returns the
        rent, and Burn normally only pays the network fee.
      </div>
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Investor</TableHead>
          <TableHead>Wallet</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead className="text-right">Controls</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holderRows.length > 0 ? (
          holderRows.map((holder) => (
            <TableRow key={holder.wallet}>
              <TableCell>{holder.investorLabel}</TableCell>
              <TableCell className="font-mono text-xs">
                {holder.wallet}
              </TableCell>
              <TableCell className="text-right font-medium">
                {holder.balanceText}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Input
                    className="h-9 w-28"
                    inputMode="decimal"
                    min="0"
                    placeholder="Amount"
                    value={burnAmounts[holder.wallet] ?? ""}
                    onChange={(event) =>
                      setBurnAmounts((current) => ({
                        ...current,
                        [holder.wallet]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      busyAction !== null || burnTokens.isPending || !mint
                    }
                    onClick={() => handleBurn(holder)}
                  >
                    Burn
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyAction !== null || freezeWallet.isPending || !mint
                    }
                    onClick={() => handleFreeze(holder)}
                  >
                    Freeze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyAction !== null || unfreezeWallet.isPending || !mint
                    }
                    onClick={() => handleUnfreeze(holder)}
                  >
                    Unfreeze
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={4} className="text-sm text-slate-500">
              {isLoading
                ? "Loading holders..."
                : "No current token holders found for this asset."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      </Table>
    </div>
  );
}

export default function IssuerPage() {
  const { address: walletAddress } = useWallet();
  const mintTokens = useMintTokens();
  const solanaWallet = useSolanaWallet();
  const { publicKey, signTransaction, signAllTransactions, signMessage, sendTransaction } = solanaWallet;
  const { connection } = useConnection();
  const [assets, setAssets] = useState<IndexedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, IndexedBalance[]>>(
    {},
  );
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<TokenPurchaseRequest[]>([]);
  const [transferRequests, setTransferRequests] = useState<TokenTransferRequest[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [walletIdentityMap, setWalletIdentityMap] = useState<
    Record<string, WalletIdentityQueueState>
  >({});
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());

  const toggleAssetExpanded = (tokenContract: string) => {
    setExpandedAssets((current) => {
      const next = new Set(current);
      if (next.has(tokenContract)) {
        next.delete(tokenContract);
      } else {
        next.add(tokenContract);
      }
      return next;
    });
  };

  const identityService = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    try {
      const provider = createAnchorProvider(connection, {
        publicKey,
        signTransaction,
        signAllTransactions,
      });
      return new IdentityService(provider);
    } catch {
      return null;
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);

  const valuationChain = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions || !sendTransaction) return null;
    try {
      const provider = createAnchorProvider(connection, {
        publicKey,
        signTransaction,
        signAllTransactions,
      });
      return new ValuationChainService(provider, sendTransaction);
    } catch {
      return null;
    }
  }, [connection, publicKey, sendTransaction, signAllTransactions, signTransaction]);

  const refreshAssetRequests = useCallback(async () => {
    const requests = await apiFetch<AssetRequest[]>("/asset-requests");
    setAssetRequests(requests);
  }, []);

  const filteredAssets = useMemo(() => {
    if (!walletAddress) return [];
    const target = walletAddress.toLowerCase();
    return assets.filter((asset) => {
      const issuer = asset.issuerWallet || asset.legalOwner;
      return issuer?.toLowerCase() === target;
    });
  }, [assets, walletAddress]);

  useEffect(() => {
    let cancelled = false;
    const loadAssets = async () => {
      setLoading(true);
      setError(null);
      try {
        const indexedAssets = await apiFetch<IndexedAsset[]>("/indexed/assets");
        if (!cancelled) setAssets(indexedAssets);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load indexed assets",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      const timeout = window.setTimeout(() => setPurchaseRequests([]), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const configuredPlatformOwner =
          process.env.NEXT_PUBLIC_PLATFORM_OWNER?.toLowerCase();
        const isPlatformOwner =
          RECOVERY_TOOLS_ENABLED &&
          configuredPlatformOwner &&
          walletAddress.toLowerCase() === configuredPlatformOwner;
        const params = new URLSearchParams(
          isPlatformOwner ? {} : { issuerWallet: walletAddress },
        );
        const requests = await apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests${params.size ? `?${params.toString()}` : ""}`,
        );
        if (!cancelled) setPurchaseRequests(requests);
      } catch {
        if (!cancelled) setPurchaseRequests([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      const timeout = window.setTimeout(() => setTransferRequests([]), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const [whitelist, activation, listingWhitelist, listingActivation] = await Promise.all([
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_WHITELIST",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_ACTIVATION",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_WHITELIST",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_ACTIVATION",
            }).toString()}`,
          ),
        ]);
        if (!cancelled) {
          setTransferRequests([
            ...whitelist.map((request) => ({ ...request, source: "direct" as const })),
            ...activation.map((request) => ({ ...request, source: "direct" as const })),
            ...listingWhitelist.map((request) => ({
              ...request,
              source: "listing" as const,
              fromWallet: request.fromWallet || request.sellerWallet || "",
              toWallet: request.toWallet || request.buyerWallet,
            })),
            ...listingActivation.map((request) => ({
              ...request,
              source: "listing" as const,
              fromWallet: request.fromWallet || request.sellerWallet || "",
              toWallet: request.toWallet || request.buyerWallet,
            })),
          ]);
        }
      } catch {
        if (!cancelled) setTransferRequests([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const requests = await apiFetch<AssetRequest[]>("/asset-requests");
        if (!cancelled) setAssetRequests(requests);
      } catch {
        if (!cancelled) setAssetRequests([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (filteredAssets.length === 0) {
      const timeout = window.setTimeout(() => setBalances({}), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const loadBalances = async () => {
      setLoadingBalances(true);
      try {
        const results = await Promise.all(
          filteredAssets.map(async (asset) => {
            const tokenBalances = await apiFetch<IndexedBalance[]>(
              `/indexed/tokens/${asset.tokenContract}/balances`,
            );
            return [asset.tokenContract, tokenBalances] as const;
          }),
        );

        if (!cancelled) {
          const next: Record<string, IndexedBalance[]> = {};
          results.forEach(([contract, tokenBalances]) => {
            next[contract] = tokenBalances;
          });
          setBalances(next);
        }
      } finally {
        if (!cancelled) setLoadingBalances(false);
      }
    };

    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [filteredAssets]);

  const issuerPurchaseQueue = useMemo(
    () =>
      purchaseRequests.filter((request) =>
        ["PENDING_ISSUER_REVIEW", "APPROVED_FOR_MINT"].includes(request.status),
      ),
    [purchaseRequests],
  );

  // Load wallet identity status for queued purchase requests
  useEffect(() => {
    let cancelled = false;
    if (!identityService) return;
    const load = async () => {
      const next: Record<string, WalletIdentityQueueState> = {};
      await Promise.all(
        issuerPurchaseQueue.map(async (request) => {
          const key = `${request.tokenContract}:${request.investorWallet}`;
          next[key] = {
            loading: true,
            exists: false,
            isActive: false,
            canRegister: false,
            canActivate: false,
            canRepairRegistry: false,
          };
          try {
            const mint = new PublicKey(request.tokenContract);
            const wallet = new PublicKey(request.investorWallet);
            const identity = await identityService.fetchWalletIdentity(mint, wallet);
            const irpState = await identityService.fetchIrpState(mint);
            const irsOwner = await identityService.fetchIrsOwner(mint);
            const targetIssuerLc = request.issuerWallet?.toLowerCase() ?? null;
            const providerKey = identityService['provider'].wallet.publicKey.toBase58();
            // Normalize to lower-case base58 strings for reliable comparison
            const providerKeyLc = providerKey.toLowerCase();
            const agentsLc = (irpState.agents || []).map((a: string) => a.toLowerCase());
            const irpOwnerLc = irpState.owner.toLowerCase();
            const irsOwnerLc = irsOwner ? irsOwner.toLowerCase() : null;
            const isAgent = agentsLc.includes(providerKeyLc);
            const isIrsOwner = irsOwnerLc ? irsOwnerLc === providerKeyLc : false;
            const canRepairRegistry =
              RECOVERY_TOOLS_ENABLED &&
              providerKeyLc === irpOwnerLc &&
              Boolean(targetIssuerLc) &&
              irpOwnerLc !== targetIssuerLc &&
              irsOwnerLc === targetIssuerLc;
            next[key] = {
              loading: false,
              exists: Boolean(identity),
              isActive: Boolean(identity?.isActive),
              canRegister: Boolean(isAgent || isIrsOwner),
              canActivate: Boolean(isIrsOwner),
              canRepairRegistry,
              irsOwner: irsOwnerLc,
              irpOwner: irpOwnerLc,
              agents: agentsLc,
            };
          } catch {
            next[key] = {
              loading: false,
              exists: false,
              isActive: false,
              canRegister: false,
              canActivate: false,
              canRepairRegistry: false,
            };
          }
        }),
      );
      if (!cancelled) setWalletIdentityMap((cur) => ({ ...cur, ...next }));
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [issuerPurchaseQueue, identityService]);

  const visibleRequests = useMemo(() => {
    if (!walletAddress) return [];
    return assetRequests.filter(
      (request) =>
        request.issuerWallet.toLowerCase() === walletAddress.toLowerCase(),
    );
  }, [assetRequests, walletAddress]);

  const assetsByToken = useMemo(() => {
    const map = new Map<string, IndexedAsset>();
    assets.forEach((asset) => {
      map.set(asset.tokenContract, asset);
      if (asset.id) map.set(asset.id, asset);
    });
    return map;
  }, [assets]);

  const updatePurchaseRequestStatus = async (
    request: TokenPurchaseRequest,
    status: TokenPurchaseRequest["status"],
    extra: Record<string, string | undefined> = {},
  ) => {
    await apiFetch(`/token-purchase-requests/${request.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        reviewerWallet: walletAddress,
        ...extra,
      }),
    });
    setPurchaseRequests((current) =>
      current.map((item) =>
        item.id === request.id ? { ...item, status, ...extra } : item,
      ),
    );
  };

  const handleCancelAssetRequest = async (request: AssetRequest) => {
    try {
      await apiFetch(`/asset-requests/${request.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "CANCELED",
          reviewedBy: walletAddress,
        }),
      });
      setAssetRequests((current) =>
        current.map((item) =>
          item.id === request.id ? { ...item, status: "CANCELED" } : item,
        ),
      );
      toast.success("Tokenization request canceled. You can submit a corrected request now.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel request.");
    }
  };

  const handleCancelOnChainOnboarding = async (request: TokenPurchaseRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const sig = await identityService.cancelOnboardingApplication(
        new PublicKey(request.tokenContract),
        new PublicKey(request.investorWallet),
      );
      toast.success("On-chain onboarding application canceled.", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel onboarding application.");
    }
  };

  const handleRemoveInvestorRegistryIdentity = async (request: TokenPurchaseRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const mint = new PublicKey(request.tokenContract);
      const wallet = new PublicKey(request.investorWallet);
      const sig = await identityService.removeIdentity(mint, wallet);
      const key = `${request.tokenContract}:${request.investorWallet}`;
      setWalletIdentityMap((current) => ({
        ...current,
        [key]: {
          ...current[key],
          exists: false,
          isActive: false,
        },
      }));
      toast.success("Investor token registry identity removed.", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove investor identity.");
    }
  };

  const handleMintPurchaseRequest = async (request: TokenPurchaseRequest) => {
    try {
      const key = `${request.tokenContract}:${request.investorWallet}`;
      const ident = walletIdentityMap[key];
      if (!ident || !ident.exists) {
        toast.error("Investor wallet is not whitelisted for this token's IRS. Register before minting.");
        return;
      }
      if (!ident.isActive) {
        toast.error("Investor identity is pending activation. Activate before minting.");
        return;
      }
      const baseAmount = BigInt(Math.round(Number(request.amount) * 1_000_000));
      const sig = await mintTokens.mutateAsync({
        mint: new PublicKey(request.tokenContract),
        recipient: new PublicKey(request.investorWallet),
        amount: baseAmount,
      });
      await updatePurchaseRequestStatus(request, "MINTED", { mintTxHash: sig });
      toast.success("Tokens minted to investor wallet", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mint failed";
      if (
        message.includes("invalid issuer FID profile or signer key mismatch") ||
        message.includes("old issuer FID signer key")
      ) {
        try {
          await updatePurchaseRequestStatus(request, "PENDING_KYC");
          toast.error(
            "The existing KYC claim was signed with an old provider signer key. Request sent back to KYC so the provider can revoke and reissue the claim.",
          );
          return;
        } catch {
          toast.error(
            `${message}

Send this request back to KYC, then have the KYC provider approve it again so the stale claim is revoked and reissued.`,
          );
          return;
        }
      }
      toast.error(message);
    }
  };

  const handleRepairRegistryOwnership = async (request: TokenPurchaseRequest) => {
    try {
      if (!identityService) {
        toast.error("Connect the current IRP owner wallet to repair registry ownership.");
        return;
      }

      const mint = new PublicKey(request.tokenContract);
      if (!request.issuerWallet) {
        throw new Error("Cannot repair registry ownership because this request has no issuer wallet.");
      }
      const issuerWallet = request.issuerWallet;
      const issuer = new PublicKey(issuerWallet);
      const sig = await identityService.transferIrpOwnership(mint, issuer);
      recordBlockchainTransactionSafely({
        txHash: sig,
        actionType: "IRP_OWNERSHIP_REPAIRED",
        actorWallet: walletAddress,
        entityType: "token_purchase_request",
        entityId: request.id,
        assetId: request.assetId,
        tokenContract: request.tokenContract,
      });
      const key = `${request.tokenContract}:${request.investorWallet}`;
      setWalletIdentityMap((current) => ({
        ...current,
        [key]: {
          ...current[key],
          irpOwner: issuerWallet.toLowerCase(),
          canRepairRegistry: false,
          canRegister: true,
          canActivate: true,
        },
      }));
      toast.success("IRP ownership repaired.", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registry repair failed");
    }
  };

  const handleWhitelistTransferRecipient = async (request: TokenTransferRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const mint = new PublicKey(request.tokenContract);
      const wallet = new PublicKey(transferRecipientWallet(request));
      const existingIdentity = await identityService.fetchWalletIdentity(mint, wallet);
      let whitelistTxHash: string | undefined;
      if (!existingIdentity) {
        const investorFid = identityService.findFidPda(wallet)[0];
        const fidAccount = await identityService.fetchFid(wallet);
        if (!fidAccount) throw new Error("Recipient must register a FID before whitelisting.");
        if (fidAccount.isIssuer) throw new Error("Recipient FID is marked as issuer. Use an investor FID wallet.");
        if (fidAccount.country < 1 || fidAccount.country > 999) {
          throw new Error(`Recipient FID has invalid country code ${fidAccount.country}.`);
        }
        whitelistTxHash = await identityService.registerIdentity(
          mint,
          wallet,
          investorFid,
          fidAccount.country,
        );
      }
      await apiFetch(transferRequestStatusEndpoint(request), {
        method: "PATCH",
        body: JSON.stringify({
          status: "PENDING_ISSUER_ACTIVATION",
          reviewerWallet: walletAddress,
          whitelistTxHash,
        }),
      });
      setTransferRequests((current) =>
        current.map((item) =>
          item.id === request.id ? { ...item, status: "PENDING_ISSUER_ACTIVATION" } : item,
        ),
      );
      toast.success("Transfer recipient whitelisted. Activate next.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recipient whitelist failed.";
      if (message.includes("WalletAlreadyRegistered") || message.includes("Wallet is already registered")) {
        await apiFetch(transferRequestStatusEndpoint(request), {
          method: "PATCH",
          body: JSON.stringify({
            status: "PENDING_ISSUER_ACTIVATION",
            reviewerWallet: walletAddress,
          }),
        });
        setTransferRequests((current) =>
          current.map((item) =>
            item.id === request.id ? { ...item, status: "PENDING_ISSUER_ACTIVATION" } : item,
          ),
        );
        toast.success("Transfer recipient already whitelisted. Activate next.");
        return;
      }
      toast.error(message);
    }
  };

  const handleActivateTransferRecipient = async (request: TokenTransferRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const activationTxHash = await identityService.setIdentityActivation(
        new PublicKey(request.tokenContract),
        new PublicKey(transferRecipientWallet(request)),
        true,
      );
      await apiFetch(transferRequestStatusEndpoint(request), {
        method: "PATCH",
        body: JSON.stringify({
          status: request.source === "listing" ? "READY_FOR_SELLER_ACCEPTANCE" : "READY_TO_TRANSFER",
          reviewerWallet: walletAddress,
          activationTxHash,
        }),
      });
      setTransferRequests((current) => current.filter((item) => item.id !== request.id));
      toast.success(
        request.source === "listing"
          ? "Buyer activated. Seller can now accept the listing request."
          : "Transfer recipient activated. Investor A can now send the transfer.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recipient activation failed.");
    }
  };

  return (
    <div className="w-full space-y-6 p-8 glass-panel rounded-[22px]">
      {/* Hero Banner */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-linear-to-br from-[#172E7F] to-[#2A5FA6] p-6 sm:pr-10 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <LayoutDashboard className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                FRACKS Issuer Console
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Issuer Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/80">
                Review tokenization requests, settle investor purchase
                orders, whitelist secondary transfer recipients, and manage
                holders for every asset linked to this wallet.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <Link href="/issuer/submit-request">
              <Button
                variant="outline"
                className="border-white/30 bg-white/20 text-white hover:bg-white/30"
              >
                <Plus className="h-4 w-4" />
                Tokenize Asset
              </Button>
            </Link>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={FileText}
            label="Tokenization Requests"
            value={visibleRequests.length.toString()}
            hint="Submitted by you"
            iconClassName="text-[#172E7F]"
          />
          <StatCard
            icon={Coins}
            label="Purchase Queue"
            value={issuerPurchaseQueue.length.toString()}
            hint="Awaiting your action"
            iconClassName="text-[#CAA141]"
          />
          <StatCard
            icon={ArrowLeftRight}
            label="Transfer Whitelist"
            value={transferRequests.length.toString()}
            hint="Pending whitelist/activation"
            iconClassName="text-blue-600"
          />
          <StatCard
            icon={Building2}
            label="Issued Assets"
            value={filteredAssets.length.toString()}
            hint="Live on-chain contracts"
            iconClassName="text-emerald-600"
          />
        </div>
      </motion.div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="requests" className="space-y-6">
        <TabsList className="h-auto w-fit flex-wrap gap-1.5">
          <TabsTrigger value="requests" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Tokenization Requests
          </TabsTrigger>
          <TabsTrigger value="purchases" className="gap-1.5">
            <Coins className="h-3.5 w-3.5" />
            Purchase Queue
          </TabsTrigger>
          <TabsTrigger value="transfers" className="gap-1.5">
            <ArrowLeftRight className="h-3.5 w-3.5" />
            Transfer Whitelist
          </TabsTrigger>
          <TabsTrigger value="assets" className="gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            Issued Assets
          </TabsTrigger>
        </TabsList>

        {/* Tokenization Requests */}
        <TabsContent value="requests">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#172E7F]" />
                Tokenization Requests
              </CardTitle>
              <CardDescription>
                Off-chain asset requests submitted by the connected issuer
                wallet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!walletAddress ? (
                <EmptyState
                  icon={Wallet}
                  title="Connect your issuer wallet"
                  description="Connect an issuer wallet to view submitted tokenization requests."
                />
              ) : visibleRequests.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No tokenization requests yet"
                  description="Requests you submit for tokenization will appear here for tracking."
                />
              ) : (
                <div className="space-y-3">
                  {visibleRequests.map((request) => (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] shadow-md">
                          <AssetTypeIcon
                            assetType={request.assetType}
                            className="h-5 w-5 text-white"
                          />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {request.name}{" "}
                            <span className="font-normal text-slate-400">
                              ({request.symbol})
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                            <Badge variant="secondary" className="capitalize">
                              {request.assetType.replace("-", " ")}
                            </Badge>
                            <span>
                              {formatOptionalCurrency(request.underlyingValue)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 sm:flex-col sm:items-end">
                        <StatusBadge status={request.status} />
                        {["PENDING_REVIEW", "APPROVED"].includes(
                          request.status,
                        ) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => void handleCancelAssetRequest(request)}
                          >
                            Cancel Request
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Investor Purchase Queue */}
        <TabsContent value="purchases">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-4 w-4 text-[#CAA141]" />
                Investor Purchase Queue
              </CardTitle>
              <CardDescription>
                Requests that passed required provider checks and are waiting
                for issuer settlement review and minting.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {issuerPurchaseQueue.length === 0 ? (
                <EmptyState
                  icon={Coins}
                  title="Queue is empty"
                  description="No investor purchase requests are awaiting issuer action."
                />
              ) : (
                <div className="space-y-4">
                  {issuerPurchaseQueue.map((request) => {
                  const asset =
                    assetsByToken.get(request.tokenContract) ||
                    (request.assetId ? assetsByToken.get(request.assetId) : undefined);

                  return (
                    <div
                      key={request.id}
                      className="rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] shadow-md">
                          <Building2 className="h-5 w-5 text-white" />
                        </div>
                        <div className="space-y-1.5">
                        <div className="font-semibold text-slate-900">
                          {asset
                            ? `${asset.name} (${asset.symbol})`
                            : "Unknown token"}
                        </div>
                        <div className="text-sm text-slate-700">
                          {request.amount} tokens requested
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono">
                            <Wallet className="h-3 w-3" />
                            {request.investorWallet.slice(0, 6)}...
                            {request.investorWallet.slice(-4)}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono">
                            <Coins className="h-3 w-3" />
                            {request.tokenContract.slice(0, 8)}...
                            {request.tokenContract.slice(-6)}
                          </span>
                        </div>
                        {RECOVERY_TOOLS_ENABLED && (() => {
                          const key = `${request.tokenContract}:${request.investorWallet}`;
                          const info = walletIdentityMap[key];
                          if (!info) return null;
                          return (
                            <div className="space-y-0.5 rounded-lg border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] text-slate-500">
                              <div>IRS Owner: {info.irsOwner ?? "(unknown)"}</div>
                              <div>IRP Owner: {info.irpOwner ?? "(unknown)"}</div>
                              <div>IRP Agents: {info.agents && info.agents.length ? info.agents.join(", ") : "(none)"}</div>
                              <div>Whitelisted: {info.exists ? "yes" : "no"} - Active: {info.isActive ? "yes" : "no"}</div>
                              <div>Can Register: {info.canRegister ? "yes" : "no"} - Can Activate: {info.canActivate ? "yes" : "no"}</div>
                            </div>
                          );
                        })()}
                        </div>
                      </div>
                      <StatusBadge status={request.status} />
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
                        {request.status === "PENDING_ISSUER_REVIEW" && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              updatePurchaseRequestStatus(
                                request,
                                "APPROVED_FOR_MINT",
                              )
                            }
                          >
                            Mark Settlement Approved
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void handleCancelOnChainOnboarding(request)}
                        >
                          Cancel On-chain App
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => void handleRemoveInvestorRegistryIdentity(request)}
                        >
                          Delete Registry Identity
                        </Button>

                        {/* Identity state/key for this request */}
                        {(() => {
                          const key = `${request.tokenContract}:${request.investorWallet}`;
                          const info = walletIdentityMap[key];

                          if (!info) {
                            return (
                              <Button disabled>
                                Checking identity...
                              </Button>
                            );
                          }

                          if (
                            info.irpOwner &&
                            info.irsOwner &&
                            info.irpOwner !== info.irsOwner
                          ) {
                            return (
                              <>
                                <Badge variant="destructive">
                                  Legacy registry mismatch
                                </Badge>
                                {RECOVERY_TOOLS_ENABLED && info.canRepairRegistry ? (
                                  <Button
                                    onClick={() => handleRepairRegistryOwnership(request)}
                                  >
                                    Repair IRP Owner
                                  </Button>
                                ) : (
                                  <Button disabled>
                                    Admin repair required
                                  </Button>
                                )}
                              </>
                            );
                          }

                          if (!info.exists) {
                            // Not registered yet
                            if (info.canRegister) {
                              return (
                                <Button
                                  onClick={async () => {
                                    try {
                                      if (!identityService) throw new Error("Connect wallet to register identity");
                                      const mint = new PublicKey(request.tokenContract);
                                      const wallet = new PublicKey(request.investorWallet);
                                      const existingIdentity = await identityService.fetchWalletIdentity(mint, wallet);
                                      if (existingIdentity) {
                                        setWalletIdentityMap((cur) => ({
                                          ...cur,
                                          [key]: {
                                            ...cur[key],
                                            exists: true,
                                            isActive: Boolean(existingIdentity.isActive),
                                          },
                                        }));
                                        toast.success(
                                          existingIdentity.isActive
                                            ? "Investor is already whitelisted and active."
                                            : "Investor is already whitelisted. Activate before minting.",
                                        );
                                        return;
                                      }
                                      const investorFid = identityService.findFidPda(wallet)[0];
                                      const fidAccount = await identityService.fetchFid(wallet);
                                      if (!fidAccount) {
                                        throw new Error("Investor must register a FID before they can be whitelisted.");
                                      }
                                      if (fidAccount.isIssuer) {
                                        throw new Error("Investor FID is marked as an issuer FID. Register a non-issuer investor FID for this wallet.");
                                      }
                                      if (fidAccount.country < 1 || fidAccount.country > 999) {
                                        throw new Error(
                                          `Investor FID has invalid country code ${fidAccount.country}. Ask the investor to update their FID country before whitelisting.`,
                                        );
                                      }
                                      const whitelistTxHash = await identityService.registerIdentity(
                                        mint,
                                        wallet,
                                        investorFid,
                                        fidAccount.country,
                                      );
                                      await updatePurchaseRequestStatus(
                                        request,
                                        request.status,
                                        { whitelistTxHash },
                                      );
                                      setWalletIdentityMap((cur) => ({
                                        ...cur,
                                        [key]: { ...cur[key], exists: true, isActive: false },
                                      }));
                                      toast.success("Investor whitelisted (pending activation)");
                                    } catch (err: unknown) {
                                      const message =
                                        err instanceof Error
                                          ? err.message
                                          : "Failed to register identity";
                                      if (message.includes("WalletAlreadyRegistered") || message.includes("Wallet is already registered")) {
                                        try {
                                          const mint = new PublicKey(request.tokenContract);
                                          const wallet = new PublicKey(request.investorWallet);
                                          const existingIdentity = await identityService?.fetchWalletIdentity(mint, wallet);
                                          setWalletIdentityMap((cur) => ({
                                            ...cur,
                                            [key]: {
                                              ...cur[key],
                                              exists: true,
                                              isActive: Boolean(existingIdentity?.isActive),
                                            },
                                          }));
                                          toast.success(
                                            existingIdentity?.isActive
                                              ? "Investor is already whitelisted and active."
                                              : "Investor is already whitelisted. Activate before minting.",
                                          );
                                          return;
                                        } catch {
                                          // Fall through to original error if the follow-up read fails.
                                        }
                                      }
                                      toast.error(message);
                                    }
                                  }}
                                >
                                  Whitelist / Register Investor
                                </Button>
                              );
                            }

                            return (
                              <Button disabled>
                                Connect IRS owner or identity agent to whitelist
                              </Button>
                            );
                          }

                          // Exists but not active
                          if (!info.isActive) {
                            return (
                              <>
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                  Pending Activation
                                </Badge>
                                {info.canActivate ? (
                                  <Button
                                    onClick={async () => {
                                      try {
                                        if (!identityService) throw new Error("Connect IRS owner to activate identity");
                                        const mint = new PublicKey(request.tokenContract);
                                        const wallet = new PublicKey(request.investorWallet);
                                        const activationTxHash =
                                          await identityService.setIdentityActivation(mint, wallet, true);
                                        await updatePurchaseRequestStatus(
                                          request,
                                          request.status,
                                          { activationTxHash },
                                        );
                                        setWalletIdentityMap((cur) => ({
                                          ...cur,
                                          [key]: { ...cur[key], isActive: true },
                                        }));
                                        toast.success("Identity activated");
                                      } catch (err: unknown) {
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : "Failed to activate identity",
                                        );
                                      }
                                    }}
                                  >
                                    Activate Identity
                                  </Button>
                                ) : null}
                              </>
                            );
                          }

                          // Exists and active: show mint button
                          return (
                            <Button
                              disabled={
                                request.status !== "APPROVED_FOR_MINT" ||
                                mintTokens.isPending
                              }
                              onClick={() => handleMintPurchaseRequest(request)}
                            >
                              Mint to Investor
                            </Button>
                          );
                        })()}
                      </div>
                    </div>
                  );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transfer Whitelist Queue */}
        <TabsContent value="transfers">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ArrowLeftRight className="h-4 w-4 text-blue-600" />
                Transfer Whitelist Queue
              </CardTitle>
              <CardDescription>
                Secondary transfer recipients that need this issuer to
                register or activate token-specific IRS identity.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transferRequests.length === 0 ? (
                <EmptyState
                  icon={ArrowLeftRight}
                  title="Nothing to whitelist"
                  description="No transfer recipient onboarding requests are awaiting issuer action."
                />
              ) : (
                <div className="space-y-3">
                  {transferRequests.map((request) => {
                const asset =
                  assetsByToken.get(request.tokenContract) ||
                  (request.assetId ? assetsByToken.get(request.assetId) : undefined);
                return (
                  <div
                    key={request.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] shadow-md">
                        <ArrowLeftRight className="h-5 w-5 text-white" />
                      </div>
                      <div className="space-y-1.5">
                      <div className="font-semibold text-slate-900">
                        {asset ? `${asset.name} (${asset.symbol})` : "Unknown token"}
                      </div>
                      <Badge variant="secondary">
                        {request.source === "listing" ? "Marketplace buyer" : "Direct transfer recipient"}
                      </Badge>
                      <div className="text-sm text-slate-700">
                        {request.amountBaseUnits ?? request.amount ?? "-"} base units requested for secondary transfer
                      </div>
                      <div className="text-xs text-slate-500">
                        Sender{" "}
                        <span className="font-mono">
                          {request.fromWallet.slice(0, 6)}...{request.fromWallet.slice(-4)}
                        </span>
                        {" "}to recipient{" "}
                        <span className="font-mono">
                          {transferRecipientWallet(request).slice(0, 6)}...{transferRecipientWallet(request).slice(-4)}
                        </span>
                      </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={request.status} />
                      {request.status === "PENDING_ISSUER_WHITELIST" ? (
                        <Button size="sm" onClick={() => void handleWhitelistTransferRecipient(request)}>
                          Whitelist Recipient
                        </Button>
                      ) : request.status === "PENDING_ISSUER_ACTIVATION" ? (
                        <Button size="sm" onClick={() => void handleActivateTransferRecipient(request)}>
                          Activate Recipient
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Issued Assets */}
        <TabsContent value="assets">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-emerald-600" />
                Issued Assets
              </CardTitle>
              <CardDescription>
                Assets linked to the connected wallet. Expand an asset to
                review and manage its token holders.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#2A5FA6]" />
                  <p className="text-sm text-slate-500">Loading assets...</p>
                </div>
              ) : error ? (
                <EmptyState
                  icon={Building2}
                  title="Failed to load assets"
                  description={error}
                />
              ) : filteredAssets.length === 0 ? (
                <EmptyState
                  icon={Building2}
                  title="No assets issued yet"
                  description="Assets you issue will appear here once they are linked to this wallet."
                />
              ) : (
                <div className="space-y-3">
                  {filteredAssets.map((asset) => {
                const tokenBalances = balances[asset.tokenContract] || [];
                const isExpanded = expandedAssets.has(asset.tokenContract);

                const request = visibleRequests.find((row) =>
                  row.status === "DEPLOYED" &&
                  ((row.deployedAssetId && row.deployedAssetId === asset.tokenContract) ||
                    (row.factoryAssetId != null && asset.factoryAssetId != null && row.factoryAssetId === asset.factoryAssetId) ||
                    (row.name === asset.name && row.symbol === asset.symbol))
                ) || null;
                return (
                  <div
                    key={asset.tokenContract}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleAssetExpanded(asset.tokenContract)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          toggleAssetExpanded(asset.tokenContract);
                        }
                      }}
                      className="flex cursor-pointer flex-col gap-3 p-4 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] shadow-md">
                          <Building2 className="h-5 w-5 text-white" />
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900">
                            {asset.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            {asset.symbol} - Asset ID{" "}
                            {asset.factoryAssetId ?? asset.id}
                          </div>
                          <div
                            className="mt-0.5 max-w-xs truncate font-mono text-[11px] text-slate-400"
                            title={asset.tokenContract}
                          >
                            {asset.tokenContract}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <Link
                          href={`/assets/${asset.factoryAssetId ?? asset.id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="inline-flex items-center gap-1 text-sm font-semibold text-[#172E7F] hover:underline"
                        >
                          View Asset
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-slate-400 transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                    </div>
                    {isExpanded ? (
                      <div className="space-y-4 border-t border-slate-100 p-4">
                        <IssuerValuationPanel
                          asset={asset}
                          request={request}
                          walletAddress={walletAddress}
                          signMessage={signMessage}
                          chain={valuationChain}
                          onRefresh={refreshAssetRequests}
                        />
                        <IssuerAssetHoldersTable
                          tokenContract={asset.tokenContract}
                          assetId={asset.factoryAssetId ?? asset.id}
                          issuerWallet={walletAddress}
                          tokenSymbol={asset.symbol}
                          fallbackBalances={tokenBalances}
                          loadingFallback={loadingBalances}
                        />
                      </div>
                    ) : null}
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









