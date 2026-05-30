"use client";

import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { PublicKey } from "@solana/web3.js";
import { useConnection } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  Building2,
  MapPin,
  Calendar,
  DollarSign,
  TrendingUp,
  Shield,
  FileText,
  Users,
  ExternalLink,
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAssetsContext } from "@/contexts/assets-context";
import { formatCurrency, getCountryName } from "@/lib/utils";
import {
  getBlockedCountries,
  getComplianceRuleRows,
  getRequiredClaimTopics,
  getTrustedIssuers,
} from "@/lib/asset-compliance";

function optionalNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formatOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString()
    : "Pending review";
}

export default function AssetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const router = useRouter();
  const { connection } = useConnection();
  const { assets, loading } = useAssetsContext();
  const [onchainTokenizedAmount, setOnchainTokenizedAmount] = useState<number | null>(null);

  const asset = useMemo(
    () => assets.find((a) => a.id === resolvedParams.id) || null,
    [assets, resolvedParams.id],
  );

  useEffect(() => {
    let isActive = true;

    const loadOnchainSupply = async () => {
      if (!asset?.tokenContractAddress) {
        setOnchainTokenizedAmount(null);
        return;
      }

      try {
        const mint = new PublicKey(asset.tokenContractAddress);
        const supply = await connection.getTokenSupply(mint, "confirmed");
        const decimals = supply.value.decimals;
        const raw = Number(supply.value.amount);
        const uiAmount = Number.isFinite(raw) ? raw / 10 ** decimals : 0;
        if (isActive) {
          setOnchainTokenizedAmount(uiAmount);
        }
      } catch {
        if (isActive) {
          setOnchainTokenizedAmount(null);
        }
      }
    };

    loadOnchainSupply();
    return () => {
      isActive = false;
    };
  }, [asset?.tokenContractAddress, connection]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading asset details...</p>
        </div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <Building2 className="h-16 w-16 text-muted-foreground mx-auto" />
          <h2 className="text-2xl font-bold">Asset Not Found</h2>
          <p className="text-muted-foreground">
            The asset you&apos;re looking for doesn&apos;t exist or has been removed.
          </p>
          <Button onClick={() => router.push("/assets")}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Assets
          </Button>
        </div>
      </div>
    );
  }

  const typeIcons = {
    "real-estate": Building2,
    commodity: TrendingUp,
    equity: Users,
    debt: Shield,
    art: Building2,
    "intellectual-property": Building2,
  } as const;

  const Icon = typeIcons[asset.assetType] || Building2;
  const totalSupply = optionalNumber(asset.totalSupply);
  const tokenizedAmount = optionalNumber(
    onchainTokenizedAmount ?? asset.tokenizedAmount,
  );
  const tokenizedPercent =
    totalSupply > 0 ? (tokenizedAmount / totalSupply) * 100 : 0;
  const requiredClaimTopics = getRequiredClaimTopics(asset);
  const trustedIssuers = getTrustedIssuers(asset);
  const complianceRows = getComplianceRuleRows(asset);
  const blockedCountries = getBlockedCountries(asset);

  return (
    <div className="p-8 glass-panel rounded-[22px]">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <Button
          variant="ghost"
          onClick={() => router.push("/assets")}
          className="mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Assets
        </Button>

        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-4">
            <div className="p-3 rounded-lg bg-gradient-to-br from-blue-50 to-blue-100">
              <Icon className="h-8 w-8 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold">{asset.name}</h1>
              <p className="text-gray-600 flex items-center gap-2 mt-1">
                <MapPin className="h-4 w-4" />
                {asset.location}
              </p>
            </div>
          </div>
          <Badge
            className={
              asset.complianceStatus === "compliant"
                ? "bg-green-100 text-green-700 border border-green-200"
                : "bg-yellow-100 text-yellow-700 border border-yellow-200"
            }
          >
            {asset.complianceStatus}
          </Badge>
        </div>
      </motion.div>

      <Alert className="mb-6">
        <AlertDescription>
          Investors can review asset details and trade. Token admins manage
          issuance and compliance from the Token Admin page.
        </AlertDescription>
      </Alert>

      {/* Key Metrics */}
      <div className="grid gap-2 md:grid-cols-4 mb-6">
        <Card className="bg-white rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[17px] font-semibold">
              Underlying Value
            </CardTitle>
            <DollarSign className="h-5 w-5 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(asset.underlyingValue)}
            </div>
            <p className="text-xs text-gray-500">{asset.currency}</p>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[17px] font-semibold">
              Total Supply
            </CardTitle>
            <TrendingUp className="h-5 w-5 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatOptionalNumber(asset.totalSupply)}
            </div>
            <p className="text-xs text-gray-500">{asset.symbol} tokens</p>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[17px] font-semibold">
              Tokenized Amount
            </CardTitle>
            <Building2 className="h-5 w-5 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tokenizedAmount.toLocaleString()}
            </div>
            <p className="text-xs text-gray-500">
              {tokenizedPercent.toFixed(1)}% tokenized
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-[17px] font-semibold">
              Token Price
            </CardTitle>
            <DollarSign className="h-5 w-5 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${asset.tokenPrice.toFixed(2)}
            </div>
            <p className="text-xs text-gray-500">per token</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Information */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="rounded-2xl bg-white border border-slate-200/70 p-1 shadow-sm">
          <TabsTrigger
            value="overview"
            className="rounded-xl px-4 py-1 text-sm data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="compliance"
            className="rounded-xl px-4 py-1 text-sm data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Compliance
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="rounded-xl px-4 py-1 text-sm data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Documents
          </TabsTrigger>
          <TabsTrigger
            value="blockchain"
            className="rounded-xl px-4 py-1 text-sm data-[state=active]:bg-gradient-to-tr data-[state=active]:from-[#172E7F] data-[state=active]:to-[#2A5FA6] data-[state=active]:text-white"
          >
            Blockchain
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle>Asset Description</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-600">{asset.description}</p>
            </CardContent>
          </Card>

          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle>Asset Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">Asset Type</p>
                  <p className="font-medium capitalize">
                    {asset.assetType.replace("-", " ")}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">Symbol</p>
                  <p className="font-medium">{asset.symbol}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">Issuer</p>
                  <p className="font-medium font-mono text-xs">
                    {asset.issuerAddress}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm text-gray-500">Issuance Date</p>
                  <p className="font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {asset.issuanceDate.toLocaleDateString()}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="compliance" className="space-y-4">
          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle>Compliance Requirements</CardTitle>
              <CardDescription>
                Rules indexed from this asset&apos;s deployed compliance metadata.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Required Claims</p>
                  <p className="mt-2 text-2xl font-bold text-[#172E7F]">
                    {requiredClaimTopics.length || 0}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {requiredClaimTopics.length > 0
                      ? requiredClaimTopics.map((topic) => `Topic ${topic}`).join(", ")
                      : "No claim topics indexed"}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Trusted Issuers</p>
                  <p className="mt-2 text-2xl font-bold text-[#172E7F]">
                    {trustedIssuers.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    KYC/AML providers allowed to issue claims
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-900">Restricted Countries</p>
                  <p className="mt-2 text-2xl font-bold text-[#172E7F]">
                    {blockedCountries.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {blockedCountries.length > 0
                      ? blockedCountries
                          .map((code) => `${code} ${getCountryName(code)}`)
                          .join(", ")
                      : "No blocked countries indexed"}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-semibold">KYC / AML Providers</h3>
                {trustedIssuers.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                    No trusted issuer metadata indexed for this asset.
                  </div>
                ) : (
                  trustedIssuers.map((issuer, index) => (
                    <div
                      key={`${issuer.walletAddress || issuer.issuerFid || index}`}
                      className="grid gap-3 rounded-xl border border-slate-200 p-4 md:grid-cols-[1fr_auto]"
                    >
                      <div>
                        <p className="font-semibold text-slate-900">
                          {issuer.label || "Trusted Issuer"}
                        </p>
                        <p className="mt-1 break-all font-mono text-xs text-slate-500">
                          {issuer.walletAddress || "Wallet not indexed"}
                        </p>
                        {issuer.issuerFid ? (
                          <p className="mt-1 break-all font-mono text-xs text-slate-500">
                            FID {issuer.issuerFid}
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="secondary">
                        {(issuer.topics || []).map((topic) => `Topic ${topic}`).join(", ") || "No topics"}
                      </Badge>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Compliance Modules</h3>
                {complianceRows.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                    No compliance module parameters indexed for this asset.
                  </div>
                ) : (
                  complianceRows.map((rule) => (
                    <div
                      key={rule.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4"
                    >
                      <div className="flex items-center gap-3">
                        <Shield className="h-5 w-5 text-[#172E7F]" />
                        <div>
                          <p className="font-semibold text-slate-900">{rule.label}</p>
                          <p className="text-sm text-slate-500">{rule.description}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="max-w-sm break-all text-right">
                        {rule.value}
                      </Badge>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Legal Documents</CardTitle>
              <CardDescription>
                Official documentation for this asset
              </CardDescription>
            </CardHeader>
            <CardContent>
              {asset.documents && asset.documents.length > 0 ? (
                <div className="space-y-2">
                  {asset.documents.map((doc, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                        <p className="font-medium">{doc.name}</p>
                      </div>
                      {doc.url ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          title="Open document"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No documents available yet</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="blockchain" className="space-y-4">
          <Card className="border-primary/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                Dedicated Token Contract
              </CardTitle>
              <CardDescription>
                This asset has its own FRACKS token contract with dedicated
                compliance wiring
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold mb-1">
                        Independent Token Contract
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Each asset has a separate token contract with its own
                        balances, supply, and symbol ({asset.symbol})
                      </p>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-muted-foreground">
                      Token Contract Address
                    </p>
                    <p className="font-mono text-sm bg-background p-3 rounded border break-all">
                      {asset.tokenContractAddress}
                    </p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Asset ID (Factory)
                    </p>
                    <p className="font-mono text-sm bg-secondary p-2 rounded">
                      {asset.id}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Token Symbol
                    </p>
                    <p className="font-mono text-sm bg-secondary p-2 rounded">
                      {asset.symbol}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">Chain ID</p>
                    <p className="font-mono text-sm bg-secondary p-2 rounded">
                      {asset.chainId}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      Native Denom
                    </p>
                    <p className="font-mono text-sm bg-secondary p-2 rounded">
                      {asset.tokenDenom}
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-muted/50 text-sm">
                  <p className="font-medium mb-2">
                    Shared Compliance Infrastructure:
                  </p>
                  <ul className="space-y-1 text-muted-foreground text-xs">
                    <li>• Identity Registry: Shared across all assets</li>
                    <li>• Trusted Issuers: Common issuer registry</li>
                    <li>• Claim Topics: Unified KYC/AML requirements</li>
                    <li>• Compliance Module: Centralized rule enforcement</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Action Buttons */}
      <div className="flex gap-2 mt-2">
        <Button
          size="lg"
          onClick={() =>
            router.push(`/investor/request-form?asset=${asset.id}`)
          }
          className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6]"
        >
          Request Tokens
        </Button>
        {/* <Button
          size="lg"
          variant="outline"
          onClick={() => router.push("/transfer")}
        >
          Transfer Tokens
        </Button> */}
      </div>
    </div>
  );
}
