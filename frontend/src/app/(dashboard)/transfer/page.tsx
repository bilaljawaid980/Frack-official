"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowLeft, Shield, CheckCircle, FileText, Globe, DollarSign, Building } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAssetsContext } from "@/contexts/assets-context";
import { Skeleton } from "@/components/ui/skeleton";

function TokenDetailsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { assets, loading } = useAssetsContext();

  const requestedAssetId = useMemo(() => searchParams.get("asset"), [searchParams]);
  const requestedSymbol = useMemo(() => searchParams.get("symbol"), [searchParams]);

  const asset = useMemo(() => {
    if (!requestedAssetId && !requestedSymbol) return null;
    return assets.find(
      (a) =>
        a.id === requestedAssetId ||
        String(a.factoryAssetId ?? "") === requestedAssetId ||
        a.symbol === requestedSymbol,
    );
  }, [assets, requestedAssetId, requestedSymbol]);

  if (loading) {
    return (
      <div className="p-8 glass-panel rounded-[22px] space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="p-8 glass-panel rounded-[22px] flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <Shield className="h-16 w-16 text-slate-300" />
        <h2 className="text-2xl font-bold text-slate-700">Token Not Found</h2>
        <p className="text-slate-500">We couldn't find the requested token details.</p>
        <Button onClick={() => router.push("/")}>Return to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="p-8 glass-panel rounded-[22px] w-full">
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-slate-900 mb-2">
              {asset.name} ({asset.symbol})
            </h1>
            <p className="text-lg text-slate-600 max-w-2xl">
              {asset.description || "A secure, compliant Real World Asset token."}
            </p>
          </div>
          <Button 
            size="lg" 
            className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] hover:from-[#13266A] hover:to-[#224D86] text-white font-medium px-6 h-10 text-base rounded-[11px] shadow-lg shadow-blue-900/20 transition-all hover:scale-105 border-none"
            onClick={() => router.push(`/investor/request-form?asset=${asset.id}`)}
          >
            Request to buy tokens
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <Card className="bg-white/80 border-slate-200/60 shadow-sm backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-blue-500" />
              Asset Financials
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Total Value</span>
              <span className="font-semibold">{asset.underlyingValue ? `$${asset.underlyingValue.toLocaleString()}` : "N/A"}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Total Supply</span>
              <span className="font-semibold">{asset.totalSupply.toLocaleString()} Tokens</span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-slate-500">Currency</span>
              <span className="font-semibold">{asset.currency}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/80 border-slate-200/60 shadow-sm backdrop-blur-md">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Building className="h-5 w-5 text-blue-500" />
              Asset Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Asset Type</span>
              <span className="font-medium capitalize px-2 py-1 bg-slate-100 rounded-md text-slate-700 text-sm">
                {asset.assetType.replace("-", " ")}
              </span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-slate-100">
              <span className="text-slate-500">Location</span>
              <span className="font-semibold flex items-center gap-1">
                <Globe className="h-4 w-4 text-slate-400" />
                {asset.location || "Global"}
              </span>
            </div>
            <div className="flex justify-between items-center py-2">
              <span className="text-slate-500">Contract</span>
              <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 truncate max-w-[150px]">
                {asset.contractAddress}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-linear-to-br from-slate-50 to-blue-50/30 border-blue-100 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Compliance Requirements
          </CardTitle>
          <CardDescription>
            This token enforces strict regulatory compliance on-chain. You must possess the following verified claims to hold or purchase this asset.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
            {asset.metadata?.trustedIssuers?.length > 0 ? (
              asset.metadata.trustedIssuers.map((ti: any, i: number) => {
                const isKyc = ti.label?.toUpperCase() === "KYC" || ti.topics?.includes("1") || ti.topics?.includes(1);
                const isAml = ti.label?.toUpperCase() === "AML" || ti.topics?.includes("2") || ti.topics?.includes(2);
                const title = isKyc ? "Know Your Customer (KYC)" : isAml ? "Anti-Money Laundering (AML)" : ti.label || "Compliance Claim";
                const desc = isKyc ? "Identity verification is required to ensure regulatory compliance." : isAml ? "Ongoing screening against global watchlists is mandated." : `Verification required by provider ${ti.walletAddress?.substring(0, 8)}...`;
                
                return (
                  <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 flex items-start gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-slate-900">{title}</h4>
                      <p className="text-sm text-slate-500 mt-1">{desc}</p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="col-span-1 sm:col-span-2 text-sm text-slate-500 p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50/50">
                No specific compliance claims configured for this token.
              </div>
            )}
          </div>
          <div className="mt-6 pt-6 border-t border-slate-200 flex items-center gap-2 text-sm text-slate-600">
            <FileText className="h-4 w-4 text-slate-400" />
            <span>Issued by wallet: <span className="font-mono text-xs">{asset.issuerAddress}</span></span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function TokenDetailsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 glass-panel rounded-[22px] min-h-[60vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        </div>
      }
    >
      <TokenDetailsContent />
    </Suspense>
  );
}
