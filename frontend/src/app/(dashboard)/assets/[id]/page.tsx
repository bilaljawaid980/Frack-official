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
  FileCheck2,
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
  getAllowedCountries,
  getComplianceRuleRows,
  getRequiredClaimTopics,
  getTrustedIssuers,
} from "@/lib/asset-compliance";
import { getCustodyMandate, listCustodyMandates, type CustodyAttestation, type CustodyMandate } from "@/lib/custody";
import { getSolscanTxUrl, shortTx } from "@/lib/solscan";
import { listAssetDocuments, type AssetDocument } from "@/lib/asset-documents";
import { getLatestValuationReport, type LatestValuationReport } from "@/lib/valuations";


type CustodyMandateDetail = CustodyMandate & {
  attestations?: CustodyAttestation[];
};

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function shortAddress(value?: string | null, head = 8, tail = 8) {
  if (!value) return "Not available";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function solscanAccountUrl(address: string) {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || process.env.NEXT_PUBLIC_SOLANA_NETWORK || "devnet";
  const query = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://solscan.io/account/${address}${query}`;
}

function InfoTile({ label, value, mono = false }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-2 break-all text-sm font-medium text-slate-900 ${mono ? "font-mono" : ""}`}>
        {value || "Not available"}
      </p>
    </div>
  );
}

function TxLink({ signature }: { signature?: string | null }) {
  if (!signature) return <span className="text-sm text-slate-500">Not available</span>;
  return (
    <a
      href={getSolscanTxUrl(signature)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-sm text-[#172E7F] underline underline-offset-2"
    >
      {shortTx(signature)}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
}
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
  const [custodyDetail, setCustodyDetail] = useState<CustodyMandateDetail | null>(null);
  const [custodyLoading, setCustodyLoading] = useState(false);
  const [publicDocuments, setPublicDocuments] = useState<AssetDocument[]>([]);
  const [publicDocumentsLoading, setPublicDocumentsLoading] = useState(false);
  const [valuationReport, setValuationReport] = useState<LatestValuationReport | null>(null);
  const [valuationReportLoading, setValuationReportLoading] = useState(false);

  const asset = useMemo(
    () => assets.find((a) => a.id === resolvedParams.id) || null,
    [assets, resolvedParams.id],
  );

  useEffect(() => {
    let isActive = true;

    const loadPublicDocuments = async () => {
      if (!asset?.id) {
        setPublicDocuments([]);
        return;
      }

      setPublicDocumentsLoading(true);
      try {
        const rows = await listAssetDocuments(asset.id);
        if (isActive) setPublicDocuments(rows);
      } catch {
        if (isActive) setPublicDocuments([]);
      } finally {
        if (isActive) setPublicDocumentsLoading(false);
      }
    };

    loadPublicDocuments();
    return () => {
      isActive = false;
    };
  }, [asset?.id]);

  useEffect(() => {
    let isActive = true;

    const loadValuationReport = async () => {
      const lookupId = asset?.factoryAssetId ? String(asset.factoryAssetId) : asset?.id;
      if (!lookupId) {
        setValuationReport(null);
        return;
      }

      setValuationReportLoading(true);
      try {
        const report = await getLatestValuationReport(lookupId);
        if (isActive) setValuationReport(report);
      } catch {
        if (isActive) setValuationReport(null);
      } finally {
        if (isActive) setValuationReportLoading(false);
      }
    };

    loadValuationReport();
    return () => {
      isActive = false;
    };
  }, [asset?.factoryAssetId, asset?.id]);
  useEffect(() => {
    let isActive = true;

    const loadCustodyDetails = async () => {
      if (!asset?.factoryAssetId) {
        setCustodyDetail(null);
        return;
      }

      setCustodyLoading(true);
      try {
        const mandates = await listCustodyMandates({ factoryAssetId: asset.factoryAssetId });
        const mandate = mandates[0];
        if (!mandate) {
          if (isActive) setCustodyDetail(null);
          return;
        }

        const detail = await getCustodyMandate(mandate.id);
        if (isActive) setCustodyDetail(detail);
      } catch {
        if (isActive) setCustodyDetail(null);
      } finally {
        if (isActive) setCustodyLoading(false);
      }
    };

    loadCustodyDetails();
    return () => {
      isActive = false;
    };
  }, [asset?.factoryAssetId]);
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
  const allowedCountries = getAllowedCountries(asset);
  const custodyMetadata = metadataRecord(custodyDetail?.metadata);
  const custodianOrganization = stringValue(custodyMetadata.custodianOrganization, "Independent custodian");
  const latestAttestation = custodyDetail?.attestations?.[0] || null;
  const hasCustody = Boolean(custodyDetail);
  const attestationValid = latestAttestation?.status === "ACTIVE" || custodyDetail?.status === "ATTESTED";
  const displayedDocuments: Array<{
    id: string;
    name: string;
    url: string;
    hash: string;
    type?: string;
    uploadedAt: Date;
  }> = publicDocuments.length > 0
    ? publicDocuments.map((doc) => ({
        id: doc.id,
        name: doc.fileName,
        url: doc.accessUrl,
        hash: doc.fileHash,
        type: doc.type,
        uploadedAt: new Date(doc.uploadedAt),
      }))
    : asset.documents.map((doc) => ({
        id: doc.id,
        name: doc.name,
        url: doc.url,
        hash: doc.hash,
        type: undefined,
        uploadedAt: doc.uploadedAt,
      }));

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

          <Card className="bg-white rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-[#172E7F]" />
                Custodian & Asset Verification
              </CardTitle>
              <CardDescription>
                Public custody information used to verify this asset before token deployment.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {custodyLoading ? (
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">Loading custody verification...</div>
              ) : hasCustody ? (
                <>
                  <div className="grid gap-3 md:grid-cols-3">
                    <InfoTile label="Custodian" value={custodianOrganization} />
                    <InfoTile label="Custody Status" value={custodyDetail?.status} />
                    <InfoTile label="Attestation" value={attestationValid ? "Confirmed" : latestAttestation?.status || "Pending"} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoTile label="Custodian Wallet" value={custodyDetail?.custodianWallet} mono />
                    <InfoTile label="Custodian FID" value={custodyDetail?.custodianFid} mono />
                    <InfoTile label="Issuer FID" value={custodyDetail?.issuerFid} mono />
                    <InfoTile label="Attestation Expiry" value={formatDateTime(latestAttestation?.expiresAt)} />
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                  No public custody mandate has been indexed for this asset yet.
                </div>
              )}
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
                  <p className="text-sm font-semibold text-slate-900">Allowed Countries</p>
                  <p className="mt-2 text-2xl font-bold text-[#172E7F]">
                    {allowedCountries.length}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {allowedCountries.length > 0
                      ? allowedCountries
                          .map((code) => `${code} ${getCountryName(code)}`)
                          .join(", ")
                      : "No allowed countries indexed"}
                  </p>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-lg font-semibold">Custody Gate</h3>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Mandate</p>
                    <p className="mt-2 text-lg font-bold text-[#172E7F]">{custodyDetail?.status || "Not indexed"}</p>
                    <p className="mt-1 text-xs text-slate-500">Custodian assignment and acceptance state</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Attestation</p>
                    <p className="mt-2 text-lg font-bold text-[#172E7F]">{latestAttestation?.status || "Pending"}</p>
                    <p className="mt-1 text-xs text-slate-500">Custody evidence verification record</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4">
                    <p className="text-sm font-semibold text-slate-900">Custodian Authority</p>
                    <p className="mt-2 text-lg font-bold text-[#172E7F]">Topic 4</p>
                    <p className="mt-1 text-xs text-slate-500">Protocol-level platform custodian authority</p>
                  </div>
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
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-[#172E7F]" />
                Latest Valuation Report
              </CardTitle>
              <CardDescription>
                Public valuation report whose SHA-256 hash is attested in the asset registry.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {valuationReportLoading ? (
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">Loading valuation report...</div>
              ) : valuationReport ? (
                <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{valuationReport.fileName}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                      <span className="font-mono">SHA-256 {shortAddress(valuationReport.hash, 10, 10)}</span>
                      {valuationReport.attestedAt ? <span>Attested {formatDateTime(valuationReport.attestedAt)}</span> : <span>Uploaded, not attested yet</span>}
                      {valuationReport.navValidityDays ? <span>Valid for {valuationReport.navValidityDays} days</span> : null}
                    </div>
                    {valuationReport.attestationTxHash ? (
                      <div className="mt-2 text-xs text-slate-500">Attestation tx: <TxLink signature={valuationReport.attestationTxHash} /></div>
                    ) : null}
                  </div>
                  <Button type="button" onClick={() => window.open(valuationReport.downloadUrl, "_blank", "noopener,noreferrer")} className="bg-[#172E7F] hover:bg-[#21439B]">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Download Latest Valuation Report
                  </Button>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileCheck2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No valuation report available</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Legal Documents</CardTitle>
              <CardDescription>
                Official documentation for this asset
              </CardDescription>
            </CardHeader>
            <CardContent>
              {publicDocumentsLoading ? (
                <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">Loading public documents...</div>
              ) : displayedDocuments && displayedDocuments.length > 0 ? (
                <div className="space-y-2">
                  {displayedDocuments.map((doc, index) => (
                    <div
                      key={doc.id || index}
                      className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                        <div className="min-w-0">
                          <p className="truncate font-medium">{doc.name}</p>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                            {"type" in doc && doc.type ? <span>{doc.type}</span> : null}
                            {doc.hash ? <span className="font-mono">SHA-256 {shortAddress(doc.hash, 10, 10)}</span> : null}
                          </div>
                        </div>
                      </div>
                      {doc.url ? (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-[#172E7F] hover:bg-slate-50"
                          title="Open document"
                        >
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          Open
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileCheck2 className="h-5 w-5 text-[#172E7F]" />
                Custody Verification Evidence
              </CardTitle>
              <CardDescription>
                Public hashes and validity data for the custodian evidence. The source file remains off-chain.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {latestAttestation ? (
                <div className="space-y-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <InfoTile label="Document SHA-256" value={latestAttestation.documentHash} mono />
                    <InfoTile label="Attestation Hash" value={latestAttestation.attestationHash} mono />
                    <InfoTile label="Attestation Status" value={latestAttestation.status} />
                    <InfoTile label="Valid Until" value={formatDateTime(latestAttestation.expiresAt)} />
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    Investors can compare the SHA-256 hash of an independently shared custody evidence file against the document hash shown here.
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileCheck2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No custody attestation evidence has been indexed yet.</p>
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

                <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-sm">
                  <div className="mb-3 flex items-center gap-2">
                    <Shield className="h-4 w-4 text-[#172E7F]" />
                    <p className="font-semibold text-slate-900">Custody On-Chain Records</p>
                  </div>
                  {hasCustody ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Custody Mandate PDA</p>
                          {custodyDetail?.mandateAddress ? (
                            <a href={solscanAccountUrl(custodyDetail.mandateAddress)} target="_blank" rel="noreferrer" className="block break-all rounded bg-white p-2 font-mono text-sm text-[#172E7F] underline underline-offset-2">
                              {custodyDetail.mandateAddress}
                            </a>
                          ) : (
                            <p className="font-mono text-sm bg-white p-2 rounded">Not available</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-sm text-muted-foreground">Custody Attestation PDA</p>
                          {latestAttestation?.attestationAddress ? (
                            <a href={solscanAccountUrl(latestAttestation.attestationAddress)} target="_blank" rel="noreferrer" className="block break-all rounded bg-white p-2 font-mono text-sm text-[#172E7F] underline underline-offset-2">
                              {latestAttestation.attestationAddress}
                            </a>
                          ) : (
                            <p className="font-mono text-sm bg-white p-2 rounded">Not available</p>
                          )}
                        </div>
                      </div>
                      <div className="grid gap-4 md:grid-cols-3">
                        <div>
                          <p className="text-sm text-muted-foreground">Mandate Creation Tx</p>
                          <div className="mt-1"><TxLink signature={custodyDetail?.createTxHash} /></div>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Mandate Acceptance Tx</p>
                          <div className="mt-1"><TxLink signature={custodyDetail?.acceptTxHash} /></div>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Attestation Tx</p>
                          <div className="mt-1"><TxLink signature={latestAttestation?.txHash} /></div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground">No custody on-chain records indexed for this asset.</p>
                  )}
                </div>

                <div className="p-4 rounded-lg bg-muted/50 text-sm">
                  <p className="font-medium mb-2">
                    Shared Compliance Infrastructure:
                  </p>
                  <ul className="space-y-1 text-muted-foreground text-xs">
                    <li>Ã¢â‚¬Â¢ Identity Registry: Shared across all assets</li>
                    <li>Ã¢â‚¬Â¢ Trusted Issuers: Common issuer registry</li>
                    <li>Ã¢â‚¬Â¢ Claim Topics: Unified KYC/AML requirements</li>
                    <li>Ã¢â‚¬Â¢ Compliance Module: Centralized rule enforcement</li>
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






