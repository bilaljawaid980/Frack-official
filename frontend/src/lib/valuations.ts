import { apiFetch, getAccessToken, getBackendUrl } from '@/lib/backend';

export type PlatformValuer = {
  id: string;
  organizationName: string;
  walletAddress: string;
  fidAddress: string | null;
  status: 'REGISTERED' | 'FID_CREATED' | 'APPROVED' | 'SUSPENDED' | string;
  fidTxHash: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  credentials?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  expectedFid?: string;
  createdAt: string;
  updatedAt: string;
};

export type AssetValuerAssignment = {
  id: string;
  assetRequestId: string;
  deployedAssetId: string | null;
  factoryAssetId: number;
  tokenContract: string | null;
  assetRegistryAddress: string | null;
  tirStateAddress: string | null;
  valuerProfileId: string;
  valuerWallet: string;
  valuerFid: string;
  status: string;
  assignedBy: string | null;
  acceptedAt: string | null;
  tirTrustTxHash: string | null;
  tirTrustedAt: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};


export type UploadedValuationReport = {
  hash: string;
  documentId: string;
  storageKey: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  downloadUrl: string;
};

export type LatestValuationReport = {
  documentId: string;
  hash: string;
  fileName: string;
  downloadUrl: string;
  attestedAt: string | null;
  attestationTxHash: string | null;
  navRaw: string | null;
  navValidityDays: number | null;
  validUntil: string | null;
};
export type AssetValuation = {
  id: string;
  assignmentId: string;
  assetRequestId: string;
  deployedAssetId: string | null;
  factoryAssetId: number;
  tokenContract: string | null;
  assetRegistryAddress: string | null;
  valuerWallet: string;
  valuerFid: string;
  navRaw: string;
  navCurrency: string;
  navScale: number;
  navDate: string;
  navValidityDays: number;
  validUntil: string;
  methodologyHash: string;
  reportDocumentId: string | null;
  txHash: string | null;
  status: string;
};

export function listPlatformValuers(params: { walletAddress?: string; status?: string } = {}) {
  const search = new URLSearchParams();
  if (params.walletAddress) search.set('walletAddress', params.walletAddress);
  if (params.status) search.set('status', params.status);
  return apiFetch<PlatformValuer[]>(`/platform-valuers${search.toString() ? `?${search}` : ''}`);
}

export function createPlatformValuer(body: { organizationName: string; walletAddress: string; credentials?: Record<string, unknown>; metadata?: Record<string, unknown> }, headers?: HeadersInit) {
  return apiFetch<PlatformValuer>('/platform-valuers', { method: 'POST', body: JSON.stringify(body), headers });
}

export function recordPlatformValuerFid(id: string, body: { fidAddress: string; txHash?: string }) {
  return apiFetch<PlatformValuer>(`/platform-valuers/${id}/fid`, { method: 'POST', body: JSON.stringify(body) });
}

export function approvePlatformValuer(id: string, headers?: HeadersInit) {
  return apiFetch<PlatformValuer>(`/platform-valuers/${id}/approval`, { method: 'POST', headers });
}

export function suspendPlatformValuer(id: string, headers?: HeadersInit) {
  return apiFetch<PlatformValuer>(`/platform-valuers/${id}/suspend`, { method: 'PATCH', headers });
}

export function removePlatformValuer(id: string, headers?: HeadersInit) {
  return apiFetch<PlatformValuer>(`/platform-valuers/${id}`, { method: 'DELETE', headers });
}

export function assignValuerToAssetRequest(assetRequestId: string, body: { valuerProfileId: string; assignedBy?: string; tokenContract?: string; metadata?: Record<string, unknown> }, headers?: HeadersInit) {
  return apiFetch<AssetValuerAssignment>(`/asset-requests/${assetRequestId}/valuer-assignments`, { method: 'POST', body: JSON.stringify(body), headers });
}

export function listValuerAssignments(params: { valuerWallet?: string; assetRequestId?: string; tokenContract?: string; status?: string } = {}) {
  const search = new URLSearchParams();
  if (params.valuerWallet) search.set('valuerWallet', params.valuerWallet);
  if (params.assetRequestId) search.set('assetRequestId', params.assetRequestId);
  if (params.tokenContract) search.set('tokenContract', params.tokenContract);
  if (params.status) search.set('status', params.status);
  return apiFetch<AssetValuerAssignment[]>(`/asset-valuer-assignments${search.toString() ? `?${search}` : ''}`);
}

export function acceptValuerAssignment(id: string, body: { actorWallet?: string }) {
  return apiFetch<AssetValuerAssignment>(`/asset-valuer-assignments/${id}/accept`, { method: 'POST', body: JSON.stringify(body) });
}

export function recordValuerTirTrust(id: string, body: { txHash: string; issuerEntryAddress: string; actorWallet?: string }, headers?: HeadersInit) {
  return apiFetch<AssetValuerAssignment>(`/asset-valuer-assignments/${id}/tir-trust`, { method: 'POST', body: JSON.stringify(body), headers });
}

export function recordAssetValuation(id: string, body: { txHash?: string; navRaw: string; navValidityDays: number; methodologyHash: string; reportDocumentId?: string; actorWallet?: string; metadata?: Record<string, unknown> }) {
  return apiFetch<AssetValuation>(`/asset-valuer-assignments/${id}/valuations`, { method: 'POST', body: JSON.stringify(body) });
}

export function getValuationReadiness(params: { assetRequestId?: string; tokenContract?: string }) {
  const search = new URLSearchParams();
  if (params.assetRequestId) search.set('assetRequestId', params.assetRequestId);
  if (params.tokenContract) search.set('tokenContract', params.tokenContract);
  return apiFetch<{ ready: boolean; assignment: AssetValuerAssignment | null; valuation: AssetValuation | null; pendingValuation?: AssetValuation | null; confirmedValuation?: AssetValuation | null; tirTrusted?: boolean; checks?: Record<string, unknown>; reasons: Array<{ code: string; message: string }> }>(`/valuation-readiness?${search}`);
}
export async function uploadValuationReport(assignmentId: string, file: File, headers?: HeadersInit) {
  const url = `${getBackendUrl()}/asset-valuer-assignments/${assignmentId}/valuation-report`;
  const requestHeaders = new Headers(headers || {});
  const token = getAccessToken();
  if (token) requestHeaders.set('Authorization', `Bearer ${token}`);
  const body = new FormData();
  body.append('file', file);
  const response = await fetch(url, { method: 'POST', headers: requestHeaders, body });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed (${response.status})`);
  }
  return (await response.json()) as UploadedValuationReport;
}

export function getLatestValuationReport(assetId: string) {
  return apiFetch<LatestValuationReport>(`/assets/${assetId}/valuation-report`);
}