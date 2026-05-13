"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Building2,
  FileText,
  Shield,
  TrendingUp,
  CheckCircle,
  Clock,
  AlertCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { IssuanceForm } from "@/components/rwa/issuance-form";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";
import { usePermissionsContext } from "@/contexts/permissions-context";

export default function IssuancePage() {
  const { address, connectWallet, isConnecting } = useWallet();
  const { canSeeIssuance, loading: permissionsLoading } =
    usePermissionsContext();
  const { assets, loading, issueAsset, deleteAsset } = useAssetsContext();
  const [activeTab, setActiveTab] = useState("new");

  const recentIssuances = assets.filter(a => a.lifecycleState !== "PENDING_APPROVAL").slice(0, 5);
  const pendingIssuances = assets.filter(
    (asset) => asset.lifecycleState === "PENDING_APPROVAL",
  );

  const stats = {
    totalIssued: assets.filter(a => a.lifecycleState !== "PENDING_APPROVAL").length,
    totalValue: assets.reduce((sum, asset) => sum + (asset.underlyingValue || 0), 0),
    pendingReview: pendingIssuances.length,
  };

  const handleApprove = async (asset: any) => {
    try {
      const issuanceRequest = {
        assetDetails: {
          name: asset.name,
          symbol: asset.symbol,
          description: asset.description,
          assetType: asset.assetType,
          location: asset.location || "",
          currency: asset.currency || "USD",
          underlyingValue: asset.underlyingValue || 0,
          totalSupply: asset.totalSupply || 0,
          legalOwner: asset.issuerWallet || asset.issuer || ""
        },
        complianceRequirements: {
          kycRequired: true,
          amlRequired: true,
          accreditedInvestorsOnly: false,
          jurisdiction: ["us"]
        },
        tokenDetails: {
          tokenName: asset.name,
          tokenSymbol: asset.symbol,
          decimals: 6,
          initialPrice: 1,
          owner: asset.issuerWallet || asset.issuer || "",
          issuer: asset.issuerWallet || asset.issuer || "",
          controller: asset.issuerWallet || asset.issuer || "",
        },
        documents: []
      };
      
      toast.loading("Approving and deploying token suite...", { id: "approve-deploy" });
      
      // 1. Issue on-chain
      await issueAsset(issuanceRequest);
      
      // 2. Remove the pending application from DB since it is now live
      await deleteAsset(asset.id);
      
      toast.success("Application approved and deployed on-chain!", { id: "approve-deploy" });
      
    } catch (err: any) {
      console.error(err);
      toast.error("Deployment failed: " + err.message, { id: "approve-deploy" });
    }
  };

  const handleReject = async (asset: any) => {
    if (!window.confirm("Are you sure you want to reject this application?")) return;
    
    try {
      toast.loading("Rejecting application...", { id: "reject-app" });
      await deleteAsset(asset.id);
      toast.success("Application rejected and removed.", { id: "reject-app" });
    } catch (err: any) {
      toast.error("Failed to reject: " + err.message, { id: "reject-app" });
    }
  };

  // Show connect wallet prompt if not connected
  if (!address) {
    return (
      <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />
    );
  }

  if (!permissionsLoading && !canSeeIssuance) {
    return (
      <div className="space-y-6 p-8 glass-panel rounded-[22px]">
        <Card className="border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <h2 className="text-lg font-semibold text-red-800">
              Access Restricted
            </h2>
            <p className="text-sm text-red-700 mt-1">
              Only the platform owner wallet can manage asset issuances.
            </p>
          </CardContent>
        </Card>
      </div>
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
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Total Assets</p>
            <p className="text-2xl font-bold">{stats.totalIssued}</p>
          </Card>
          <Card className="px-6 py-3 bg-yellow-500/5 border-yellow-500/10">
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Pending Review</p>
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
          <IssuanceForm />
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
                <div className="text-center py-12 text-muted-foreground">Loading applications...</div>
              ) : pendingIssuances.length === 0 ? (
                <div className="text-center py-16">
                  <div className="h-16 w-16 mx-auto rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                    <CheckCircle className="h-8 w-8 text-emerald-500" />
                  </div>
                  <h3 className="text-lg font-semibold">Queue Empty</h3>
                  <p className="text-muted-foreground max-w-xs mx-auto">
                    All submitted asset applications have been reviewed and processed.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {pendingIssuances.map((asset) => (
                    <motion.div
                      key={asset.id}
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
                              <h4 className="font-bold text-lg">{asset.name}</h4>
                              <Badge variant="secondary">{asset.symbol}</Badge>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <TrendingUp className="h-3.5 w-3.5" />
                                {formatCurrency(asset.underlyingValue)}
                              </span>
                              <span>•</span>
                              <span>Issuer: {asset.issuer.slice(0, 6)}...{asset.issuer.slice(-4)}</span>
                              <span>•</span>
                              <span className="capitalize">{asset.assetType.replace('-', ' ')}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Button 
                            className="bg-primary hover:bg-primary/90 text-white font-semibold px-6"
                            onClick={() => handleApprove(asset)}
                          >
                            Approve & Deploy
                          </Button>
                          <Button 
                            variant="outline" 
                            className="text-slate-600"
                            onClick={() => handleReject(asset)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                      {asset.description && (
                        <div className="mt-4 pt-4 border-t text-sm text-muted-foreground italic">
                          "{asset.description}"
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
              {recentIssuances.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No active tokens found.</div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {recentIssuances.map((asset) => (
                    <div key={asset.id} className="flex items-center justify-between p-4 rounded-lg border bg-slate-50/30">
                      <div className="flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600">
                          <CheckCircle className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-bold">{asset.name}</p>
                          <p className="text-xs text-muted-foreground mono">{asset.contractAddress.slice(0, 8)}...{asset.contractAddress.slice(-8)}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-bold">{formatCurrency(asset.underlyingValue)}</p>
                        <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200">Active</Badge>
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
