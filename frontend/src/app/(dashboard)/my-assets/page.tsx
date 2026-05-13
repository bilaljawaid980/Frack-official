"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Building2, PlusCircle, LayoutDashboard, Clock, CheckCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { IssuanceForm } from "@/components/rwa/issuance-form";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/backend";
import { toast } from "sonner";
import { ConnectWalletCard } from "@/components/wallet/connect-wallet-card";
import { usePermissionsContext } from "@/contexts/permissions-context";

export default function MyAssetsPage() {
  const { address, isConnecting, connectWallet } = useWallet();
  const { assets, loadAssets } = useAssetsContext();
  const { canSeeIssuance, loading: permissionsLoading } = usePermissionsContext();
  const [activeTab, setActiveTab] = useState("assets");

  if (!address) {
    return <ConnectWalletCard onConnect={connectWallet} isConnecting={isConnecting} />;
  }

  // Issuers should not see this if they don't have permission (e.g. they are an investor)
  // Wait, the issuer IS the one who submits. Let's just assume if they are an issuer they can see it.

  const myAssets = assets.filter(
    (a) => a.issuer.toLowerCase() === address.toLowerCase() || a.issuerAddress?.toLowerCase() === address.toLowerCase()
  );

  const handleApply = async (data: any, uploadedFiles: File[]) => {
    try {
      // In a real app, you would upload files to IPFS/S3 here
      // and send the URLs to the backend.
      
      await apiFetch("/assets/apply", {
        method: "POST",
        body: JSON.stringify({
          assetDetails: data.assetDetails,
          complianceRequirements: data.complianceRequirements,
          tokenDetails: {
            tokenName: data.assetDetails.name,
            tokenSymbol: data.assetDetails.symbol,
            decimals: data.tokenDetails.decimals,
            initialPrice: data.tokenDetails.initialPrice,
          },
          issuerWallet: address
        }),
      });
      
      toast.success("Asset application submitted for approval!");
      setActiveTab("assets");
      await loadAssets(); // Reload to show the pending asset
    } catch (err: any) {
      toast.error("Failed to submit application: " + err.message);
      throw err;
    }
  };

  return (
    <div className="space-y-8 p-8 glass-panel rounded-[22px]">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">My Assets</h1>
        <p className="text-muted-foreground">
          Manage your tokenized properties and submit new assets for tokenization.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="bg-muted border border-border/40 p-1 w-full max-w-md grid grid-cols-2">
          <TabsTrigger value="assets" className="flex items-center gap-2">
            <LayoutDashboard className="h-4 w-4" />
            My Assets
          </TabsTrigger>
          <TabsTrigger value="create" className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4" />
            Create Asset
          </TabsTrigger>
        </TabsList>

        <TabsContent value="assets" className="space-y-6">
          {myAssets.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="p-4 bg-primary/10 rounded-full mb-4">
                  <Building2 className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">No Assets Yet</h3>
                <p className="text-muted-foreground max-w-sm mb-6">
                  You haven't tokenized any assets yet. Create a new asset application to get started.
                </p>
                <button
                  onClick={() => setActiveTab("create")}
                  className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium"
                >
                  Create New Asset
                </button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {myAssets.map((asset) => (
                <Card key={asset.id} className="overflow-hidden flex flex-col">
                  <div className="h-32 bg-gradient-to-r from-blue-500/20 to-purple-500/20 flex items-center justify-center relative">
                    <Building2 className="h-12 w-12 text-muted-foreground/50" />
                    <div className="absolute top-4 right-4">
                      {asset.lifecycleState === "PENDING_APPROVAL" ? (
                         <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 flex items-center gap-1">
                           <Clock className="w-3 h-3" /> Pending
                         </Badge>
                      ) : (
                         <Badge className="bg-green-500/10 text-green-600 border-green-500/20 flex items-center gap-1">
                           <CheckCircle className="w-3 h-3" /> Deployed
                         </Badge>
                      )}
                    </div>
                  </div>
                  <CardHeader>
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant="outline" className="capitalize">
                        {asset.assetType.replace("-", " ")}
                      </Badge>
                      <span className="text-sm text-muted-foreground">{asset.symbol}</span>
                    </div>
                    <CardTitle className="line-clamp-1">{asset.name}</CardTitle>
                    <CardDescription className="line-clamp-2">
                      {asset.description || "No description provided."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    <div className="flex justify-between items-center text-sm pt-4 border-t">
                      <span className="text-muted-foreground">Value</span>
                      <span className="font-semibold">{formatCurrency(asset.underlyingValue, asset.currency)}</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="create" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Asset Tokenization Application</CardTitle>
              <CardDescription>
                Submit your asset details for legal review and token deployment.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <IssuanceForm isApplicationMode={true} onSubmitOverride={handleApply} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
