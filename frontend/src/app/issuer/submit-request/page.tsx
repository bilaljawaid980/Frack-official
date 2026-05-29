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
  type UploadedLegalDocument,
} from "@/components/rwa/issuance-form";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import {
  getSupabaseBrowserClient,
  LEGAL_DOCS_BUCKET,
} from "@/lib/supabase";

function sanitizePathPart(value: string) {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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

  const supabase = getSupabaseBrowserClient();
  const requestFolder = [
    sanitizePathPart(issuerWallet),
    `${Date.now()}-${crypto.randomUUID()}`,
  ].join("/");

  return Promise.all(
    documents.map(async (document, index) => {
      const extension = document.file.name.includes(".")
        ? document.file.name.split(".").pop()
        : "bin";
      const safeName = sanitizePathPart(
        document.file.name.replace(/\.[^/.]+$/, ""),
      );
      const path = [
        requestFolder,
        sanitizePathPart(symbol || "asset"),
        sanitizePathPart(document.documentType),
        `${index + 1}-${crypto.randomUUID()}-${safeName}.${extension}`,
      ].join("/");

      const { error } = await supabase.storage
        .from(LEGAL_DOCS_BUCKET)
        .upload(path, document.file, {
          contentType: document.file.type || undefined,
          upsert: false,
        });

      if (error) throw new Error(error.message);

      const { data } = supabase.storage
        .from(LEGAL_DOCS_BUCKET)
        .getPublicUrl(path);

      return {
        name: document.file.name,
        size: document.file.size,
        type: document.file.type,
        lastModified: document.file.lastModified,
        documentType: document.documentType,
        bucket: LEGAL_DOCS_BUCKET,
        path,
        publicUrl: data.publicUrl,
      };
    }),
  );
}

export default function SubmitAssetRequestPage() {
  const router = useRouter();
  const { address } = useWallet();

  const submitAssetRequest = async (
    data: IssuanceFormValues,
    uploadedDocuments: UploadedLegalDocument[],
  ) => {
    const issuerWallet = data.assetDetails.issuerWallet || address;
    if (!issuerWallet) {
      toast.error("Connect a wallet before submitting an asset request");
      return;
    }

    const uploadToast =
      uploadedDocuments.length > 0
        ? toast.loading("Uploading legal documents...")
        : null;
    let documents: Awaited<ReturnType<typeof uploadLegalDocuments>> = [];
    try {
      documents = await uploadLegalDocuments({
        issuerWallet,
        symbol: data.assetDetails.symbol,
        documents: uploadedDocuments,
      });
      if (uploadToast) {
        toast.success("Documents uploaded", { id: uploadToast });
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Document upload failed";
      if (uploadToast) {
        toast.error(message, { id: uploadToast });
      } else {
        toast.error(message);
      }
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
          documentFolder:
            documents.length > 0
              ? documents[0].path.split("/").slice(0, 2).join("/")
              : null,
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
