import { apiFetch } from "@/lib/backend";

export type AssetDocument = {
  id: string;
  assetRequestId: string;
  factoryAssetId?: number | null;
  deployedAssetId?: string | null;
  type: string;
  visibility: "PUBLIC" | "PRIVATE";
  accessUrl: string;
  fileHash: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  verifiedAt?: string | null;
};

export function listAssetDocuments(assetId: string, includePrivate = false) {
  const query = includePrivate ? "?includePrivate=true" : "";
  return apiFetch<AssetDocument[]>(`/assets/${assetId}/documents${query}`);
}
