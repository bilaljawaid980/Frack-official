"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BarChart3, RefreshCw, ShieldCheck } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IssuanceForm,
  type IssuanceFormValues,
  type StoredLegalDocument,
  type UploadedLegalDocument,
} from "@/components/rwa/issuance-form";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import {
  listPlatformCustodians,
  type PlatformCustodian,
} from "@/lib/platform-custodians";
import { listPlatformValuers, type PlatformValuer } from "@/lib/valuations";

async function uploadLegalDocuments({
  issuerWallet,
  symbol,
  documents,
}: {
  issuerWallet: string;
  symbol: string;
  documents: UploadedLegalDocument[];
}) {
  if (documents.length === 0) return [];

  const formData = new FormData();
  formData.append("issuerWallet", issuerWallet);
  formData.append("symbol", symbol);
  for (const document of documents) {
    formData.append("files", document.file);
    formData.append("documentTypes", document.documentType);
  }

  const response = await fetch("/api/legal-docs/upload", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.error || "Document upload failed.");
  }

  return payload.data || [];
}

function shortAddress(value: string | null | undefined) {
  if (!value) return "Pending";
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
}

function isSelectableCustodian(custodian: PlatformCustodian) {
  return Boolean(custodian.fidAddress) && custodian.status === "APPROVED";
}
function isSelectableValuer(valuer: PlatformValuer) {
  return Boolean(valuer.fidAddress) && valuer.status === "APPROVED";
}

function CustodianSelectionPanel({
  custodiansLoading,
  eligibleCustodians,
  selectedCustodian,
  selectedCustodianId,
  onSelectCustodian,
  onRefresh,
}: {
  custodiansLoading: boolean;
  eligibleCustodians: PlatformCustodian[];
  selectedCustodian: PlatformCustodian | null;
  selectedCustodianId: string;
  onSelectCustodian: (custodianId: string) => void;
  onRefresh: () => void;
}) {
  const placeholder = custodiansLoading
    ? "Loading approved custodians..."
    : eligibleCustodians.length === 0
      ? "No approved custodians with FID available"
      : "Select approved custodian";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-[0_4px_14px_rgba(23,46,127,0.22)]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-950">Custody setup</h4>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#172E7F]">
                Required
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Choose the platform-approved custodian that will prepare custody before admin deployment.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={custodiansLoading}
          className="h-9 w-full shrink-0 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${custodiansLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <Select
            value={selectedCustodianId || undefined}
            onValueChange={onSelectCustodian}
            disabled={custodiansLoading || eligibleCustodians.length === 0}
          >
            <SelectTrigger className="h-11 border-slate-300 bg-slate-50/70 text-sm shadow-sm">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {eligibleCustodians.map((custodian) => (
                <SelectItem key={custodian.id} value={custodian.id}>
                  {custodian.organizationName} - {shortAddress(custodian.walletAddress)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedCustodian ? (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Wallet</p>
              <p className="mt-1 truncate font-mono text-slate-900" title={selectedCustodian.walletAddress}>
                {shortAddress(selectedCustodian.walletAddress)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">FID</p>
              <p className="mt-1 truncate font-mono text-slate-900" title={selectedCustodian.fidAddress || undefined}>
                {shortAddress(selectedCustodian.fidAddress)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <p className="mt-1 truncate font-semibold text-emerald-700">{selectedCustodian.status}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Ask the platform admin to register and approve a custodian after the custodian creates its FID.
          </div>
        )}
      </div>
    </section>
  );
}

function ValuerSelectionPanel({
  valuersLoading,
  eligibleValuers,
  selectedValuer,
  selectedValuerId,
  onSelectValuer,
  onRefresh,
}: {
  valuersLoading: boolean;
  eligibleValuers: PlatformValuer[];
  selectedValuer: PlatformValuer | null;
  selectedValuerId: string;
  onSelectValuer: (valuerId: string) => void;
  onRefresh: () => void;
}) {
  const placeholder = valuersLoading
    ? "Loading approved valuers..."
    : eligibleValuers.length === 0
      ? "No approved valuers with FID available"
      : "Select approved valuer";

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-[#172E7F] to-[#2A5FA6] text-white shadow-[0_4px_14px_rgba(23,46,127,0.22)]">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-slate-950">Valuation setup</h4>
              <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-[#172E7F]">
                Required
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Choose the FRACKS-approved valuer that will provide the public NAV attestation after deployment.
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={valuersLoading}
          className="h-9 w-full shrink-0 sm:w-auto"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${valuersLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div>
          <Select
            value={selectedValuerId || undefined}
            onValueChange={onSelectValuer}
            disabled={valuersLoading || eligibleValuers.length === 0}
          >
            <SelectTrigger className="h-11 border-slate-300 bg-slate-50/70 text-sm shadow-sm">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {eligibleValuers.map((valuer) => (
                <SelectItem key={valuer.id} value={valuer.id}>
                  {valuer.organizationName} - {shortAddress(valuer.walletAddress)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedValuer ? (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs">
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Wallet</p>
              <p className="mt-1 truncate font-mono text-slate-900" title={selectedValuer.walletAddress}>
                {shortAddress(selectedValuer.walletAddress)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">FID</p>
              <p className="mt-1 truncate font-mono text-slate-900" title={selectedValuer.fidAddress || undefined}>
                {shortAddress(selectedValuer.fidAddress)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <p className="mt-1 truncate font-semibold text-emerald-700">{selectedValuer.status}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Ask the platform admin to register and approve a valuer after the valuer creates its FID.
          </div>
        )}
      </div>
    </section>
  );
}
export default function SubmitAssetRequestPage() {
  const router = useRouter();
  const { address } = useWallet();
  const [custodians, setCustodians] = useState<PlatformCustodian[]>([]);
  const [selectedCustodianId, setSelectedCustodianId] = useState("");
  const [custodiansLoading, setCustodiansLoading] = useState(true);
  const [valuers, setValuers] = useState<PlatformValuer[]>([]);
  const [selectedValuerId, setSelectedValuerId] = useState("");
  const [valuersLoading, setValuersLoading] = useState(true);

  const eligibleCustodians = useMemo(
    () => custodians.filter(isSelectableCustodian),
    [custodians],
  );

  const selectedCustodian = useMemo(
    () => eligibleCustodians.find((custodian) => custodian.id === selectedCustodianId) || null,
    [eligibleCustodians, selectedCustodianId],
  );

  const eligibleValuers = useMemo(
    () => valuers.filter(isSelectableValuer),
    [valuers],
  );

  const selectedValuer = useMemo(
    () => eligibleValuers.find((valuer) => valuer.id === selectedValuerId) || null,
    [eligibleValuers, selectedValuerId],
  );

  const loadCustodians = useCallback(async () => {
    setCustodiansLoading(true);
    try {
      const rows = await listPlatformCustodians();
      const selectableRows = rows.filter(isSelectableCustodian);
      setCustodians(rows);
      setSelectedCustodianId((current) => {
        if (current && selectableRows.some((custodian) => custodian.id === current)) {
          return current;
        }

        return selectableRows[0]?.id || "";
      });
    } catch (error) {
      setCustodians([]);
      setSelectedCustodianId("");
      toast.error(error instanceof Error ? error.message : "Failed to load platform custodians.");
    } finally {
      setCustodiansLoading(false);
    }
  }, []);
  const loadValuers = useCallback(async () => {
    setValuersLoading(true);
    try {
      const rows = await listPlatformValuers({ status: "APPROVED" });
      const selectableRows = rows.filter(isSelectableValuer);
      setValuers(rows);
      setSelectedValuerId((current) => {
        if (current && selectableRows.some((valuer) => valuer.id === current)) {
          return current;
        }

        return selectableRows[0]?.id || "";
      });
    } catch (error) {
      setValuers([]);
      setSelectedValuerId("");
      toast.error(error instanceof Error ? error.message : "Failed to load platform valuers.");
    } finally {
      setValuersLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCustodians();
    void loadValuers();
  }, [loadCustodians, loadValuers]);

  const submitAssetRequest = async (
    data: IssuanceFormValues,
    _uploadedDocuments: UploadedLegalDocument[],
    documents: StoredLegalDocument[],
  ) => {
    const issuerWallet = data.assetDetails.issuerWallet || address;
    if (!issuerWallet) {
      toast.error("Connect a wallet before submitting an asset request");
      return;
    }

    if (documents.length === 0) {
      toast.error("Upload legal documents before submitting the request.");
      return;
    }

    if (custodiansLoading) {
      toast.error("Custodian registry is still loading.");
      return;
    }

    if (!selectedCustodian?.fidAddress) {
      toast.error("Select an approved platform custodian with an active FID before submitting.");
      return;
    }

    if (valuersLoading) {
      toast.error("Valuer registry is still loading.");
      return;
    }

    if (!selectedValuer?.fidAddress) {
      toast.error("Select an approved FRACKS valuer with an active FID before submitting.");
      return;
    }

    await apiFetch("/asset-requests", {
      method: "POST",
      body: JSON.stringify({
        issuerWallet,
        legalOwner: issuerWallet,
        referenceId: data.assetDetails.isin,
        name: data.assetDetails.name,
        symbol: data.assetDetails.symbol,
        description: data.assetDetails.description,
        assetType: data.assetDetails.assetType,
        currency: data.assetDetails.currency,
        location: data.assetDetails.location,
        underlyingValue: data.assetDetails.underlyingValue,
        totalSupply: data.assetDetails.totalSupply,
        decimals: data.tokenDetails.decimals,
        initialPrice: data.tokenDetails.initialPrice,
        claimTopics: [],
        trustedIssuers: [],
        complianceModules: data.complianceRequirements.selectedModules,
        documents,
        metadata: {
          submittedFrom: "issuer/submit-request",
          documentFolder: documents[0]?.path
            ? documents[0].path.split("/").slice(0, 2).join("/")
            : null,
          complianceModuleParams: data.complianceRequirements.moduleParams,
          custody: {
            proposedCustodian: {
              id: selectedCustodian.id,
              organizationName: selectedCustodian.organizationName,
              walletAddress: selectedCustodian.walletAddress,
              fidAddress: selectedCustodian.fidAddress,
              platformAuthorityAddress: selectedCustodian.platformAuthorityAddress,
              authorityTopic: selectedCustodian.authorityTopic,
              status: selectedCustodian.status,
            },
          },
          valuation: {
            proposedValuer: {
              id: selectedValuer.id,
              organizationName: selectedValuer.organizationName,
              walletAddress: selectedValuer.walletAddress,
              fidAddress: selectedValuer.fidAddress,
              status: selectedValuer.status,
            },
          },
        },
      }),
    });

    toast.success("Asset tokenization request submitted");
    router.push("/issuer");
  };

  const uploadAssetDocuments = async (
    data: IssuanceFormValues,
    uploadedDocuments: UploadedLegalDocument[],
  ) => {
    const issuerWallet = data.assetDetails.issuerWallet || address;
    if (!issuerWallet) {
      throw new Error("Connect a wallet before uploading legal documents.");
    }

    return uploadLegalDocuments({
      issuerWallet,
      symbol: data.assetDetails.symbol,
      documents: uploadedDocuments,
    });
  };

  return (
    <div className="space-y-6">
      <Card className="border border-slate-200/70 bg-white/80 shadow-sm">
        <CardHeader>
          <CardTitle>Tokenize Asset</CardTitle>
          <CardDescription>
            Submit an off-chain request for admin review. No Solana transaction
            is executed from this issuer flow.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IssuanceForm
            isApplicationMode
            assetDetailsFooter={
              <div className="space-y-4">
                <CustodianSelectionPanel
                  custodiansLoading={custodiansLoading}
                  eligibleCustodians={eligibleCustodians}
                  selectedCustodian={selectedCustodian}
                  selectedCustodianId={selectedCustodianId}
                  onSelectCustodian={setSelectedCustodianId}
                  onRefresh={() => void loadCustodians()}
                />
                <ValuerSelectionPanel
                  valuersLoading={valuersLoading}
                  eligibleValuers={eligibleValuers}
                  selectedValuer={selectedValuer}
                  selectedValuerId={selectedValuerId}
                  onSelectValuer={setSelectedValuerId}
                  onRefresh={() => void loadValuers()}
                />
              </div>
            }
            onUploadDocuments={uploadAssetDocuments}
            onSubmitOverride={submitAssetRequest}
            submitLabel="Submit Tokenization Request"
          />
        </CardContent>
      </Card>
    </div>
  );
}

