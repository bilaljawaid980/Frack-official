"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Building2, CheckCircle, Clock, TrendingUp } from "lucide-react";
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
  IssuanceForm,
  type IssuanceFormValues,
} from "@/components/rwa/issuance-form";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useWallet } from "@/hooks/use-wallet";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/backend";

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
  lifecycleState: string;
};

type AssetRequest = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DEPLOYED";
  issuerWallet: string;
  legalOwner?: string | null;
  referenceId?: string | null;
  name: string;
  symbol: string;
  description?: string | null;
  assetType: string;
  currency: string;
  location?: string | null;
  underlyingValue: number;
  totalSupply: number;
  decimals: number;
  initialPrice: number;
  claimTopics: string[];
  trustedIssuers?: unknown;
  complianceModules: string[];
  documents?: unknown;
  createdAt: string;
};

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
  const [assets, setAssets] = useState<IssuanceAsset[]>([]);
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<AssetRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("new");

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

  const handleApprove = async (request: AssetRequest) => {
    try {
      await apiFetch(`/asset-requests/${request.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "APPROVED",
          reviewedBy: address,
        }),
      });
      toast.success("Request approved. Deployment form is ready.");
      router.push(`/issuance?requestId=${request.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.error(`Approval failed: ${message}`);
    }
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

  const selectedRequestValues = useMemo<Partial<IssuanceFormValues> | undefined>(() => {
    if (!selectedRequest) return undefined;
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
        underlyingValue: selectedRequest.underlyingValue,
        totalSupply: selectedRequest.totalSupply,
        location: selectedRequest.location || "",
        currency: selectedRequest.currency,
        issuerWallet: selectedRequest.issuerWallet,
        isin: selectedRequest.referenceId || selectedRequest.symbol,
      },
      complianceRequirements: {
        claimTopics: selectedRequest.claimTopics,
        trustedIssuers,
        selectedModules: selectedRequest.complianceModules || [],
      },
      tokenDetails: {
        decimals: selectedRequest.decimals,
        initialPrice: selectedRequest.initialPrice,
      },
      documents: [],
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
              <Badge className="ml-2 bg-yellow-500 hover:bg-yellow-600 px-1.5 h-5 min-w-[20px] justify-center">
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
                <CardTitle className="text-base">Approved Request Loaded</CardTitle>
                <CardDescription>
                  Deploying {selectedRequest.name} for issuer{" "}
                  {selectedRequest.issuerWallet.slice(0, 6)}...
                  {selectedRequest.issuerWallet.slice(-4)}.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
          <IssuanceForm
            onDeployed={async () => {
              await loadAssets();
              await loadAssetRequests();
            }}
            initialValues={selectedRequestValues}
            deploymentRequestId={selectedRequest?.id}
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
                  {pendingRequests.map((request) => (
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
                                {formatCurrency(request.underlyingValue)}
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
                    </motion.div>
                  ))}
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
                  {recentIssuances.map((asset) => (
                    <div
                      key={asset.dbId}
                      className="flex items-center justify-between p-4 rounded-lg border bg-slate-50/30"
                    >
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
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
