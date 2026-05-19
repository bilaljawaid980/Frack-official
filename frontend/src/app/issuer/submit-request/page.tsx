"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  IssuanceForm,
  type IssuanceFormValues,
} from "@/components/rwa/issuance-form";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";

function serializeTrustedIssuers(
  issuers: IssuanceFormValues["complianceRequirements"]["trustedIssuers"],
) {
  return issuers.map((issuer) => ({
    ...issuer,
    topics: issuer.topics.map((topic) => topic.toString()),
  }));
}

export default function SubmitAssetRequestPage() {
  const router = useRouter();
  const { address } = useWallet();

  const submitAssetRequest = async (
    data: IssuanceFormValues,
    uploadedFiles: File[],
  ) => {
    const issuerWallet = data.assetDetails.issuerWallet || address;
    if (!issuerWallet) {
      toast.error("Connect a wallet before submitting an asset request");
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
        claimTopics: data.complianceRequirements.claimTopics,
        complianceModules: data.complianceRequirements.selectedModules,
        trustedIssuers: serializeTrustedIssuers(
          data.complianceRequirements.trustedIssuers,
        ),
        documents: uploadedFiles.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        })),
        metadata: {
          submittedFrom: "issuer/submit-request",
        },
      }),
    });

    toast.success("Asset tokenization request submitted");
    router.push("/issuer");
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
            onSubmitOverride={submitAssetRequest}
            submitLabel="Submit Tokenization Request"
          />
        </CardContent>
      </Card>
    </div>
  );
}
