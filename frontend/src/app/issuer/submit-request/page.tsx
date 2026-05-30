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
  type StoredLegalDocument,
  type UploadedLegalDocument,
} from "@/components/rwa/issuance-form";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";

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

export default function SubmitAssetRequestPage() {
  const router = useRouter();
  const { address } = useWallet();

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
        documents,
        metadata: {
          submittedFrom: "issuer/submit-request",
          documentFolder: documents[0]?.path
            ? documents[0].path.split("/").slice(0, 2).join("/")
            : null,
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
            onUploadDocuments={uploadAssetDocuments}
            onSubmitOverride={submitAssetRequest}
            submitLabel="Submit Tokenization Request"
          />
        </CardContent>
      </Card>
    </div>
  );
}
