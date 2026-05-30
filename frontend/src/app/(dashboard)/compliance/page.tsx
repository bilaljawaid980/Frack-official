"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import { motion } from "framer-motion";
import {
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileCheck,
  Users,
  Globe,
  Filter,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ComplianceBadge } from "@/components/rwa/compliance-badge";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { formatCurrency, formatDate } from "@/lib/utils";
import { toast } from "sonner";
import { usePermissionsContext } from "@/contexts/permissions-context";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { ComplianceService } from "@/services/compliance";
import type { RWAAsset } from "@/types/rwa";
import {
  getComplianceRuleRows,
  getModuleParams,
  getRequiredClaimTopics,
} from "@/lib/asset-compliance";
import { MOD_SUPPLY_CAP } from "@/lib/constants";

type SupplyCapSnapshot = {
  currentSupply?: string;
  currentCap?: string;
  source?: "on-chain" | "indexed";
};

function formatRawTokenAmount(value: bigint | string | number | undefined, decimals: number) {
  if (value === undefined || value === null || value === "") return "Not set";
  const raw = typeof value === "bigint" ? value : BigInt(String(value));
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = raw / scale;
  const fraction = raw % scale;
  if (decimals === 0 || fraction === BigInt(0)) return whole.toLocaleString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fractionText}`;
}

function claimTopicLabel(topic: string) {
  if (topic === "1") return "KYC Required";
  if (topic === "2") return "AML Required";
  return `Claim Topic ${topic}`;
}

export default function CompliancePage() {
  const { address, connectWallet, isConnecting } = useWallet();
  const { connection } = useConnection();
  const anchorProvider = useAnchorProvider();
  const {
    permissions,
    canSeeCompliance,
    loading: permissionsLoading,
  } = usePermissionsContext();
  const { assets, updateCompliance, loading } = useAssetsContext();
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedJurisdiction, setSelectedJurisdiction] =
    useState<string>("all");
  const [supplyCapInputs, setSupplyCapInputs] = useState<Record<string, string>>({});
  const [updatingSupplyCap, setUpdatingSupplyCap] = useState<string | null>(null);
  const [supplySnapshots, setSupplySnapshots] = useState<
    Record<string, SupplyCapSnapshot>
  >({});

  const complianceStats = {
    total: assets.length,
    compliant: assets.filter((a) => a.complianceStatus === "compliant").length,
    pending: assets.filter((a) => a.complianceStatus === "pending").length,
    nonCompliant: assets.filter((a) => a.complianceStatus === "non-compliant")
      .length,
    underReview: assets.filter((a) => a.complianceStatus === "under-review")
      .length,
  };

  const filteredAssets = assets.filter((asset) => {
    if (filterStatus !== "all" && asset.complianceStatus !== filterStatus)
      return false;
    if (selectedJurisdiction !== "all") {
      // In real implementation, check asset jurisdiction
      return true;
    }
    return true;
  });

  useEffect(() => {
    let cancelled = false;
    const loadLiveSupplyData = async () => {
      const service = anchorProvider ? new ComplianceService(anchorProvider) : null;
      const entries = await Promise.all(
        assets.map(async (asset) => {
          const decimals = Number(asset.metadata?.decimals ?? 6);
          const snapshot: SupplyCapSnapshot = {};
          try {
            const mint = new PublicKey(asset.tokenContractAddress);
            const supply = await connection.getTokenSupply(mint, "confirmed");
            snapshot.currentSupply = formatRawTokenAmount(
              supply.value.amount,
              supply.value.decimals,
            );

            if (service) {
              try {
                const state = (await service.fetchModuleState(
                  "supply_cap",
                  MOD_SUPPLY_CAP,
                  mint,
                )) as { maxSupply?: bigint; totalSupply?: bigint };
                if (state.maxSupply !== undefined) {
                  snapshot.currentCap = formatRawTokenAmount(state.maxSupply, decimals);
                  snapshot.source = "on-chain";
                }
                if (state.totalSupply !== undefined) {
                  snapshot.currentSupply = formatRawTokenAmount(
                    state.totalSupply,
                    decimals,
                  );
                }
              } catch {
                const indexedCap = getModuleParams(
                  asset,
                  MOD_SUPPLY_CAP.toBase58(),
                ).max_supply;
                if (indexedCap !== undefined) {
                  snapshot.currentCap = String(indexedCap);
                  snapshot.source = "indexed";
                }
              }
            } else {
              const indexedCap = getModuleParams(asset, MOD_SUPPLY_CAP.toBase58()).max_supply;
              if (indexedCap !== undefined) {
                snapshot.currentCap = String(indexedCap);
                snapshot.source = "indexed";
              }
            }
          } catch {
            const indexedCap = getModuleParams(asset, MOD_SUPPLY_CAP.toBase58()).max_supply;
            if (indexedCap !== undefined) {
              snapshot.currentCap = String(indexedCap);
              snapshot.source = "indexed";
            }
          }
          return [asset.id, snapshot] as const;
        }),
      );

      if (!cancelled) {
        setSupplySnapshots(Object.fromEntries(entries));
      }
    };

    void loadLiveSupplyData();
    return () => {
      cancelled = true;
    };
  }, [anchorProvider, assets, connection]);

  const handleComplianceUpdate = async (
    assetId: string,
    status: RWAAsset["complianceStatus"],
  ) => {
    try {
      await updateCompliance(assetId, status, {
        updatedAt: new Date().toISOString(),
        updatedBy: "compliance_officer",
        notes: "Manual compliance update",
      });
      toast.success(`Compliance status updated to ${status}`);
    } catch (error) {
      toast.error("Failed to update compliance status");
    }
  };

  const handleSupplyCapUpdate = async (asset: RWAAsset) => {
    const value = supplyCapInputs[asset.id]?.trim();
    if (!value) {
      toast.error("Enter a readable supply cap amount first.");
      return;
    }
    if (!anchorProvider) {
      toast.error("Connect the compliance module owner wallet first.");
      return;
    }

    setUpdatingSupplyCap(asset.id);
    const loadingToast = toast.loading("Updating Supply Cap...");
    try {
      const decimals = Number(asset.metadata?.decimals ?? 6);
      const service = new ComplianceService(anchorProvider);
      const sig = await service.setSupplyCap(
        new PublicKey(asset.tokenContractAddress),
        value,
        decimals,
      );
      setSupplySnapshots((current) => ({
        ...current,
        [asset.id]: {
          ...(current[asset.id] ?? {}),
          currentCap: value,
          source: "on-chain",
        },
      }));
      toast.success(`Supply Cap updated. Tx: ${sig.slice(0, 10)}...`, {
        id: loadingToast,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed";
      toast.error(message, { id: loadingToast });
    } finally {
      setUpdatingSupplyCap(null);
    }
  };

  const jurisdictionOptions = [
    "United States",
    "European Union",
    "United Kingdom",
    "Singapore",
    "Switzerland",
    "United Arab Emirates",
  ];

  // Show connect wallet prompt if not connected
  if (!address) {
    return (
      <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />
    );
  }

  if (!permissionsLoading && !canSeeCompliance) {
    return (
      <div className="space-y-6 p-8 glass-panel rounded-[22px]">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Access Restricted</AlertTitle>
          <AlertDescription>
            Only the compliance contract owner can access this dashboard.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-8 glass-panel rounded-[22px]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              Compliance Dashboard
            </h1>
            <p className="text-muted-foreground">
              Monitor and manage regulatory compliance for all tokenized assets
            </p>
          </div>
          <Button className="gap-2 bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6]">
            <FileCheck className="h-4 w-4" />
            Export Report
          </Button>
        </div>

        <Alert>
          <AlertDescription>
            Compliance owner configures transfer restrictions and reviews asset
            compliance. Other roles should use the KYC Provider and Identity
            Management pages.
          </AlertDescription>
        </Alert>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-white rounded-2xl">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Total Assets
                  </p>
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <p className="text-2xl font-bold">{complianceStats.total}</p>
                <p className="text-xs text-muted-foreground">
                  Under management
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-white rounded-2xl">
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Compliant
                  </p>
                  <CheckCircle className="h-4 w-4 text-green-500" />
                </div>
                <p className="text-2xl font-bold">
                  {complianceStats.compliant}
                </p>
                <p className="text-xs text-muted-foreground">
                  {complianceStats.total > 0
                    ? `${(
                        (complianceStats.compliant / complianceStats.total) *
                        100
                      ).toFixed(1)}%`
                    : "0%"}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Pending Review
                  </p>
                  <Clock className="h-4 w-4 text-yellow-500" />
                </div>
                <p className="text-2xl font-bold">{complianceStats.pending}</p>
                <p className="text-xs text-muted-foreground">
                  Awaiting approval
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-muted-foreground">
                    Non-Compliant
                  </p>
                  <XCircle className="h-4 w-4 text-red-500" />
                </div>
                <p className="text-2xl font-bold">
                  {complianceStats.nonCompliant}
                </p>
                <p className="text-xs text-muted-foreground">
                  Requires attention
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>

      {/* Main Content */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="rounded-xl p-1">
          <TabsTrigger
            value="overview"
            className="data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="assets"
            className="data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Asset Compliance
          </TabsTrigger>
          <TabsTrigger
            value="jurisdictions"
            className="data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Jurisdictions
          </TabsTrigger>
          <TabsTrigger
            value="reports"
            className="data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Reports
          </TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Compliance Overview */}
            <Card className="lg:col-span-2 bg-white rounded-2xl">
              <CardHeader>
                <CardTitle>Compliance Overview</CardTitle>
                <CardDescription>
                  Current compliance status across all assets
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {[
                    "compliant",
                    "pending",
                    "non-compliant",
                    "under-review",
                  ].map((status) => {
                    const count =
                      complianceStats[status as keyof typeof complianceStats];
                    const percentage =
                      complianceStats.total > 0
                        ? (count / complianceStats.total) * 100
                        : 0;

                    return (
                      <div key={status} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <ComplianceBadge status={status as any} size="sm" />
                            <span className="text-sm text-muted-foreground">
                              {count} assets
                            </span>
                          </div>
                          <span className="text-sm font-medium">
                            {percentage.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${percentage}%` }}
                            transition={{ duration: 1, delay: 0.2 }}
                            className={`h-full ${
                              status === "compliant"
                                ? "bg-green-500"
                                : status === "pending"
                                  ? "bg-yellow-500"
                                  : status === "non-compliant"
                                    ? "bg-red-500"
                                    : "bg-blue-500"
                            }`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Quick Actions */}
            <Card className="bg-white rounded-2xl">
              <CardHeader>
                <CardTitle>Quick Actions</CardTitle>
                <CardDescription>Common compliance tasks</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <Button className="w-full justify-start gap-2 bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6]">
                    <FileCheck className="h-4 w-4" />
                    Run Compliance Check
                  </Button>
                  <Link href="/kyc-provider">
                    <Button
                      variant="outline"
                      className="w-full justify-start gap-2"
                    >
                      <Users className="h-4 w-4" />
                      Review KYC Applications
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                  >
                    <Globe className="h-4 w-4" />
                    Update Jurisdiction Rules
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    View Compliance Alerts
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Recent Activity */}
            <Card className="lg:col-span-3 bg-white rounded-2xl">
              <CardHeader>
                <CardTitle>Recent Compliance Activity</CardTitle>
                <CardDescription>
                  Latest compliance updates and checks
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {assets.slice(0, 5).map((asset, index) => (
                    <motion.div
                      key={asset.id}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50"
                    >
                      <div className="flex items-center gap-3">
                        <ComplianceBadge status={asset.complianceStatus} />
                        <div>
                          <p className="font-medium">{asset.name}</p>
                          <p className="text-sm text-muted-foreground">
                            Last updated: {formatDate(asset.lastUpdated)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedAsset(asset.id)}
                        >
                          View Details
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Assets Tab */}
        <TabsContent value="assets" className="space-y-6">
          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Asset Compliance Status</CardTitle>
                  <CardDescription>
                    Manage compliance for individual assets
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[180px]">
                      <Filter className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="compliant">Compliant</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="non-compliant">
                        Non-Compliant
                      </SelectItem>
                      <SelectItem value="under-review">Under Review</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={selectedJurisdiction}
                    onValueChange={setSelectedJurisdiction}
                  >
                    <SelectTrigger className="w-[180px]">
                      <Globe className="h-4 w-4 mr-2" />
                      <SelectValue placeholder="Filter by jurisdiction" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Jurisdictions</SelectItem>
                      {jurisdictionOptions.map((jurisdiction) => (
                        <SelectItem
                          key={jurisdiction}
                          value={jurisdiction.toLowerCase()}
                        >
                          {jurisdiction}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="text-center py-8">Loading assets...</div>
              ) : filteredAssets.length === 0 ? (
                <div className="text-center py-8">
                  <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">
                    No assets found with the selected filters
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {filteredAssets.map((asset, index) => (
                    (() => {
                      const requiredTopics = getRequiredClaimTopics(asset);
                      const ruleRows = getComplianceRuleRows(asset);
                      const supplySnapshot = supplySnapshots[asset.id] ?? {};
                      return (
                    <motion.div
                      key={asset.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="p-4 rounded-lg border space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="p-2 rounded-md bg-primary/10">
                            <Shield className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <h3 className="font-medium">{asset.name}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="outline">{asset.assetType}</Badge>
                              <span className="text-sm text-muted-foreground">
                                {asset.location} •{" "}
                                {formatCurrency(asset.underlyingValue)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <ComplianceBadge status={asset.complianceStatus} />
                          <div className="text-right">
                            <p className="text-sm font-medium">
                              {supplySnapshot.currentSupply ??
                                (typeof asset.tokenizedAmount === "number" &&
                                Number.isFinite(asset.tokenizedAmount)
                                  ? asset.tokenizedAmount.toLocaleString()
                                  : "Pending review")}{" "}
                              tokens
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Cap: {supplySnapshot.currentCap ?? "Not set"}
                              {supplySnapshot.source === "indexed"
                                ? " (indexed)"
                                : ""}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Compliance Actions */}
                      <div className="grid gap-4 border-t pt-4 lg:grid-cols-[1fr_auto]">
                        <div className="space-y-1">
                          <p className="text-sm font-medium">
                            Compliance Requirements
                          </p>
                          <div className="flex flex-wrap items-center gap-2">
                            {requiredTopics.length === 0 ? (
                              <Badge variant="outline" className="text-xs">
                                No claim topics indexed
                              </Badge>
                            ) : (
                              requiredTopics.map((topic) => (
                                <Badge
                                  key={topic}
                                  variant="secondary"
                                  className="text-xs"
                                >
                                  {claimTopicLabel(topic)}
                                </Badge>
                              ))
                            )}
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            {ruleRows.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No compliance modules indexed for this asset.
                              </p>
                            ) : (
                              ruleRows.map((row) => (
                                <div
                                  key={`${asset.id}-${row.id}`}
                                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                                >
                                  <div className="text-xs font-semibold text-slate-700">
                                    {row.label}
                                  </div>
                                  <div className="text-xs text-slate-500">
                                    {row.value}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min="0"
                              step="any"
                              placeholder="Supply cap"
                              value={supplyCapInputs[asset.id] ?? ""}
                              onChange={(event) =>
                                setSupplyCapInputs((current) => ({
                                  ...current,
                                  [asset.id]: event.target.value,
                                }))
                              }
                              className="h-9 w-32 bg-white"
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatingSupplyCap === asset.id}
                              onClick={() => handleSupplyCapUpdate(asset)}
                            >
                              Update Supply Cap
                            </Button>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleComplianceUpdate(asset.id, "compliant")
                            }
                          >
                            Mark Compliant
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              handleComplianceUpdate(asset.id, "non-compliant")
                            }
                          >
                            Flag Issue
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => setSelectedAsset(asset.id)}
                          >
                            View Details
                          </Button>
                        </div>
                      </div>
                    </motion.div>
                      );
                    })()
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Jurisdictions Tab */}
        <TabsContent value="jurisdictions">
          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle>Jurisdiction Rules</CardTitle>
              <CardDescription>
                Configure compliance rules for different jurisdictions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {jurisdictionOptions.map((jurisdiction, index) => (
                  <motion.div
                    key={jurisdiction}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: index * 0.1 }}
                    className="p-4 rounded-lg border space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Globe className="h-5 w-5 text-primary" />
                        <h3 className="font-medium">{jurisdiction}</h3>
                        <Badge variant="outline">Active</Badge>
                      </div>
                      <Button size="sm" variant="outline">
                        Edit Rules
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <p className="text-sm font-medium">KYC Requirements</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Identity verification required</li>
                          <li>• Address proof required</li>
                          <li>• Source of funds declaration</li>
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">AML Rules</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Transaction monitoring</li>
                          <li>• Sanctions screening</li>
                          <li>• PEP screening required</li>
                        </ul>
                      </div>
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Investment Limits</p>
                        <ul className="text-sm text-muted-foreground space-y-1">
                          <li>• Max investment: $100,000</li>
                          <li>• Min holding period: 90 days</li>
                          <li>• Accredited investors only</li>
                        </ul>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports">
          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle>Compliance Reports</CardTitle>
              <CardDescription>
                Generate and download compliance reports
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    {
                      title: "Monthly Compliance Report",
                      description:
                        "Full compliance overview for the current month",
                      date: "2024-01-31",
                      type: "monthly",
                    },
                    {
                      title: "KYC Verification Report",
                      description: "Status of all KYC verifications",
                      date: "2024-01-30",
                      type: "verification",
                    },
                    {
                      title: "AML Screening Log",
                      description: "Complete AML screening activity log",
                      date: "2024-01-29",
                      type: "aml",
                    },
                    {
                      title: "Jurisdiction Compliance",
                      description: "Compliance status by jurisdiction",
                      date: "2024-01-28",
                      type: "jurisdiction",
                    },
                    {
                      title: "Asset Compliance Status",
                      description: "Detailed compliance status for all assets",
                      date: "2024-01-27",
                      type: "assets",
                    },
                    {
                      title: "Regulatory Changes",
                      description: "Summary of recent regulatory changes",
                      date: "2024-01-26",
                      type: "regulatory",
                    },
                  ].map((report, index) => (
                    <motion.div
                      key={report.title}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: index * 0.1 }}
                      whileHover={{ y: -4 }}
                      className="p-4 rounded-lg border space-y-3 hover:bg-accent/50 cursor-pointer"
                      onClick={() =>
                        toast.info(`Generating ${report.title}...`)
                      }
                    >
                      <div className="flex items-center justify-between">
                        <div className="p-2 rounded-md bg-primary/10">
                          <FileCheck className="h-5 w-5 text-primary" />
                        </div>
                        <Badge variant="outline">{report.type}</Badge>
                      </div>
                      <div>
                        <h3 className="font-medium mb-1">{report.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {report.description}
                        </p>
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-xs text-muted-foreground">
                          Generated: {report.date}
                        </span>
                        <Button size="sm" variant="ghost">
                          Download
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </div>

                {/* Report Generation */}
                <div className="p-4 rounded-lg border bg-muted/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium">Generate New Report</h3>
                      <p className="text-sm text-muted-foreground">
                        Create a custom compliance report
                      </p>
                    </div>
                    <Button className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6]">
                      <FileCheck className="h-4 w-4 mr-2" />
                      Generate Report
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Compliance Standards Notice */}
      <Card className="bg-white rounded-2xl">
        <CardContent className="pt-6">
          <div className="flex items-start gap-4">
            <div className="p-2 rounded-md bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-2">
              <h3 className="font-medium">Compliance Standards</h3>
              <p className="text-sm text-muted-foreground">
                This platform enforces FRACKS compliance controls for tokenized
                real-world assets across onboarding, claims, and transfer
                validation.
              </p>
              <div className="flex items-center gap-4">
                <Badge variant="outline">FRACKS Compliant</Badge>
                <Badge variant="outline">KYC/AML Integrated</Badge>
                <Badge variant="outline">Regulatory Reporting</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
