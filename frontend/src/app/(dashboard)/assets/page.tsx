"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Search,
  Filter,
  Grid3x3,
  List,
  TrendingUp,
  Building2,
  DollarSign,
  MapPin,
  Calendar,
  Users,
  MoreVertical,
  Shield,
  Loader2,
  Star,
  Sparkles,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AssetCard } from "@/components/rwa/asset-card";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import {
  formatTokenizedPercentage,
  getTokenizedPercentage,
} from "@/lib/asset-tokenization";
import { RWAAsset } from "@/types/rwa";

function assetRenderKey(asset: RWAAsset) {
  return `${asset.id}-${asset.contractAddress}`;
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

export default function AssetsPage() {
  const { address, connectWallet, isConnecting } = useWallet();
  const { assets, loading, selectedAsset, setSelectedAsset } =
    useAssetsContext();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("value-desc");

  // Filter and sort assets
  const filteredAssets = useMemo(() => {
    let result = [...assets];

    // Apply search filter
    if (searchQuery) {
      result = result.filter(
        (asset) =>
          asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          asset.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          asset.location.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    // Apply type filter
    if (filterType !== "all") {
      result = result.filter((asset) => asset.assetType === filterType);
    }

    // Apply status filter
    if (filterStatus !== "all") {
      result = result.filter(
        (asset) => asset.complianceStatus === filterStatus,
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case "value-desc":
          return b.underlyingValue - a.underlyingValue;
        case "value-asc":
          return a.underlyingValue - b.underlyingValue;
        case "tokenized-desc":
          return getTokenizedPercentage(b) - getTokenizedPercentage(a);
        case "tokenized-asc":
          return getTokenizedPercentage(a) - getTokenizedPercentage(b);
        case "name-asc":
          return a.name.localeCompare(b.name);
        case "name-desc":
          return b.name.localeCompare(a.name);
        default:
          return 0;
      }
    });

    return result;
  }, [assets, searchQuery, filterType, filterStatus, sortBy]);

  // Calculate stats
  const stats = useMemo(() => {
    const totalValue = assets.reduce(
      (sum, asset) => sum + asset.underlyingValue,
      0,
    );
    const avgTokenization =
      assets.length > 0
        ? assets.reduce((sum, asset) => {
            return sum + getTokenizedPercentage(asset);
          }, 0) / assets.length
        : 0;
    const compliantCount = assets.filter(
      (a) => a.complianceStatus === "compliant",
    ).length;

    return {
      totalAssets: assets.length,
      totalValue,
      avgTokenization,
      compliantPercentage:
        assets.length > 0 ? (compliantCount / assets.length) * 100 : 0,
      byType: assets.reduce(
        (acc, asset) => {
          acc[asset.assetType] = (acc[asset.assetType] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
    };
  }, [assets]);

  const assetTypes = [
    {
      value: "real-estate",
      label: "Real Estate",
      icon: Building2,
      color: "bg-blue-500",
    },
    {
      value: "commodity",
      label: "Commodities",
      icon: TrendingUp,
      color: "bg-yellow-500",
    },
    { value: "equity", label: "Equity", icon: Users, color: "bg-green-500" },
    { value: "debt", label: "Debt", icon: DollarSign, color: "bg-purple-500" },
    { value: "art", label: "Fine Art", icon: Building2, color: "bg-pink-500" },
    {
      value: "intellectual-property",
      label: "IP",
      icon: Building2,
      color: "bg-indigo-500",
    },
  ];

  // Show connect wallet prompt if not connected
  if (!address) {
    return (
      <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />
    );
  }

  return (
    <div className="w-full space-y-6 p-8 glass-panel rounded-[22px]">
      {/* Hero Banner */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
        <div className="flex flex-col gap-6 rounded-2xl border border-slate-200 bg-linear-to-br from-[#172E7F] to-[#2A5FA6] p-6 sm:pr-10 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <Shield className="h-7 w-7" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                FRACKS Multi-Token Architecture
              </p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
                Tokenized Assets
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-white/80">
                Browse and invest in tokenized real-world assets. Each asset has
                its own dedicated token contract with independent balances and
                supply, sharing the same compliance infrastructure - Identity
                Registry, Trusted Issuers, and Claim Topics.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <Button
              variant={viewMode === "grid" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("grid")}
              className={
                viewMode === "grid"
                  ? "border-white/30 bg-white/20 text-white hover:bg-white/30"
                  : "border-white/30 bg-white/10 text-white hover:bg-white/20"
              }
            >
              <Grid3x3 className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "outline"}
              size="icon"
              onClick={() => setViewMode("list")}
              className={
                viewMode === "list"
                  ? "border-white/30 bg-white/20 text-white hover:bg-white/30"
                  : "border-white/30 bg-white/10 text-white hover:bg-white/20"
              }
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="space-y-4"
      >
        <Alert className="border-slate-200/70 bg-white/90">
          <AlertDescription className="text-slate-600">
            Investors can browse assets and open details. Token admins manage
            issuance and compliance on the Issuance and Compliance pages.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={Building2}
            label="Total Assets"
            value={stats.totalAssets.toString()}
            hint="Tokenized assets"
            iconClassName="text-[#172E7F]"
          />
          <StatCard
            icon={DollarSign}
            label="Total Value"
            value={formatCurrency(stats.totalValue)}
            hint="Combined value"
            iconClassName="text-emerald-600"
          />
          <StatCard
            icon={TrendingUp}
            label="Avg. Tokenization"
            value={formatPercentage(stats.avgTokenization)}
            hint="Of total supply"
            iconClassName="text-[#CAA141]"
          />
          <StatCard
            icon={Shield}
            label="Compliant"
            value={formatPercentage(stats.compliantPercentage)}
            hint="Compliance rate"
            iconClassName="text-emerald-600"
          />
        </div>
      </motion.div>

      {/* Filters and Search */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <Card className="bg-white/90 border-slate-200/70 shadow-sm">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Filter className="h-4 w-4 text-[#172E7F]" />
              Filter &amp; Sort
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div className="relative lg:col-span-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search assets by name, location, or description..."
                  className="pl-10"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue placeholder="Asset Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {assetTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="compliant">Compliant</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="non-compliant">Non-Compliant</SelectItem>
                </SelectContent>
              </Select>

              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger>
                  <SelectValue placeholder="Sort By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="value-desc">Value: High to Low</SelectItem>
                  <SelectItem value="value-asc">Value: Low to High</SelectItem>
                  <SelectItem value="tokenized-desc">
                    Tokenization: High to Low
                  </SelectItem>
                  <SelectItem value="tokenized-asc">
                    Tokenization: Low to High
                  </SelectItem>
                  <SelectItem value="name-asc">Name: A to Z</SelectItem>
                  <SelectItem value="name-desc">Name: Z to A</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="all" className="space-y-6">
        <TabsList className="inline-flex h-auto w-full max-w-fit items-center gap-1 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          <TabsTrigger value="all" className="gap-2 rounded-xl px-4 py-2 text-slate-600 transition-all data-[state=active]:bg-linear-to-br data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white data-[state=active]:shadow-md">
            <Grid3x3 className="h-3.5 w-3.5" />
            All Assets
          </TabsTrigger>
          <TabsTrigger value="featured" className="gap-2 rounded-xl px-4 py-2 text-slate-600 transition-all data-[state=active]:bg-linear-to-br data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white data-[state=active]:shadow-md">
            <Star className="h-3.5 w-3.5" />
            Featured
          </TabsTrigger>
          <TabsTrigger value="compliant" className="gap-2 rounded-xl px-4 py-2 text-slate-600 transition-all data-[state=active]:bg-linear-to-br data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white data-[state=active]:shadow-md">
            <Shield className="h-3.5 w-3.5" />
            Compliant Only
          </TabsTrigger>
          <TabsTrigger value="new" className="gap-2 rounded-xl px-4 py-2 text-slate-600 transition-all data-[state=active]:bg-linear-to-br data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white data-[state=active]:shadow-md">
            <Sparkles className="h-3.5 w-3.5" />
            New Listings
          </TabsTrigger>
        </TabsList>

        {/* All Assets Tab */}
        <TabsContent value="all" className="space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Loader2 className="h-8 w-8 animate-spin text-[#2A5FA6]" />
              <p className="text-sm text-slate-500">Loading assets...</p>
            </div>
          ) : filteredAssets.length === 0 ? (
            <Card className="bg-white/90 border-slate-200/70 shadow-sm">
              <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100">
                  <Search className="h-6 w-6 text-slate-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">No assets found</h3>
                <p className="text-sm text-slate-500">
                  Try adjusting your search or filters
                </p>
              </CardContent>
            </Card>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredAssets.map((asset, index) => (
                <motion.div
                  key={assetRenderKey(asset)}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: index * 0.05 }}
                >
                  <AssetCard asset={asset} />
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAssets.map((asset, index) => (
                <motion.div
                  key={assetRenderKey(asset)}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.05 }}
                  whileHover={{ x: 4 }}
                  className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-white cursor-pointer sm:flex-row sm:items-center sm:justify-between"
                  onClick={() => setSelectedAsset(asset)}
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] shadow-md">
                      <Building2 className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-bold text-slate-900">{asset.name}</h3>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary" className="capitalize">
                          {asset.assetType.replace("-", " ")}
                        </Badge>
                        <span className="flex items-center gap-1 text-sm text-slate-500">
                          <MapPin className="h-3 w-3" />
                          {asset.location}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="font-bold text-slate-900">
                        {formatCurrency(asset.underlyingValue)}
                      </p>
                      <p className="text-xs text-slate-500">Value</p>
                    </div>

                    <div className="text-right">
                      <p className="font-bold text-slate-900">
                        {formatTokenizedPercentage(asset)}
                      </p>
                      <p className="text-xs text-slate-500">Tokenized</p>
                    </div>

                    <div className="text-right">
                      <Badge
                        variant={
                          asset.complianceStatus === "compliant"
                            ? "success"
                            : asset.complianceStatus === "pending"
                              ? "outline"
                              : "destructive"
                        }
                      >
                        {asset.complianceStatus}
                      </Badge>
                      <p className="mt-1 flex items-center justify-end gap-1 text-xs text-slate-500">
                        <Calendar className="h-3 w-3" />
                        {new Date(asset.issuanceDate).toLocaleDateString()}
                      </p>
                    </div>

                    <Button variant="ghost" size="icon">
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {filteredAssets.length > 0 && (
            <div className="flex items-center justify-between pt-2">
              <p className="text-sm text-slate-500">
                Showing{" "}
                <span className="font-semibold text-slate-700">
                  {filteredAssets.length}
                </span>{" "}
                of {assets.length} assets
              </p>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" disabled>
                  Previous
                </Button>
                <Button size="sm" className="h-9 w-9 p-0">
                  1
                </Button>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                  2
                </Button>
                <Button variant="outline" size="sm" className="h-9 w-9 p-0">
                  3
                </Button>
                <Button variant="outline" size="sm">
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Featured Tab */}
        <TabsContent value="featured">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Featured Assets</CardTitle>
              <CardDescription>
                Top performing and recently listed assets
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#2A5FA6]" />
                  <p className="text-sm text-slate-500">Loading...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {assets
                    .filter((asset) => asset.complianceStatus === "compliant")
                    .slice(0, 6)
                    .map((asset, index) => (
                      <motion.div
                        key={assetRenderKey(asset)}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <AssetCard asset={asset} />
                      </motion.div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Compliant Only Tab */}
        <TabsContent value="compliant">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Fully Compliant Assets</CardTitle>
              <CardDescription>
                Assets that meet all regulatory requirements
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#2A5FA6]" />
                  <p className="text-sm text-slate-500">Loading...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assets
                    .filter((asset) => asset.complianceStatus === "compliant")
                    .map((asset, index) => (
                      <motion.div
                        key={assetRenderKey(asset)}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: index * 0.05 }}
                        className="rounded-xl border border-slate-200 bg-white/90 p-4 shadow-sm transition-colors hover:border-slate-300 hover:bg-white"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 border-2 border-emerald-100">
                              <Building2 className="h-5 w-5 text-emerald-600" />
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-900">{asset.name}</h3>
                              <p className="text-sm text-slate-500">
                                {asset.location} - {asset.assetType}
                              </p>
                            </div>
                          </div>
                          <Badge variant="success">Compliant</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-4">
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-xs text-slate-500">Value</p>
                            <p className="font-bold text-slate-900">
                              {formatCurrency(asset.underlyingValue)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-xs text-slate-500">Tokenized</p>
                            <p className="font-bold text-slate-900">
                              {formatTokenizedPercentage(asset)}
                            </p>
                          </div>
                          <div className="rounded-lg bg-slate-50 px-3 py-2">
                            <p className="text-xs text-slate-500">Issuer</p>
                            <p className="truncate font-bold text-slate-900" title={asset.issuer}>
                              {asset.issuer}
                            </p>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* New Listings Tab */}
        <TabsContent value="new">
          <Card className="bg-white/90 border-slate-200/70 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">New Asset Listings</CardTitle>
              <CardDescription>Recently tokenized assets</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                  <Loader2 className="h-8 w-8 animate-spin text-[#2A5FA6]" />
                  <p className="text-sm text-slate-500">Loading...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {assets
                    .sort(
                      (a, b) =>
                        new Date(b.issuanceDate).getTime() -
                        new Date(a.issuanceDate).getTime(),
                    )
                    .slice(0, 6)
                    .map((asset, index) => (
                      <motion.div
                        key={assetRenderKey(asset)}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: index * 0.05 }}
                      >
                        <AssetCard asset={asset} />
                      </motion.div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Asset Detail Modal (if selected) */}
      {selectedAsset && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setSelectedAsset(null)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-card max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl"
          >
            <div className="flex items-center justify-between gap-4 rounded-t-2xl bg-linear-to-br from-[#172E7F] to-[#2A5FA6] p-6 text-white">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/70">
                  Asset Details
                </p>
                <h2 className="mt-1 text-2xl font-bold">{selectedAsset.name}</h2>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSelectedAsset(null)}
                className="border-white/30 bg-white/10 text-white hover:bg-white/20"
              >
                X
              </Button>
            </div>

            <div className="space-y-6 p-6">
              <p className="text-slate-600">{selectedAsset.description}</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
