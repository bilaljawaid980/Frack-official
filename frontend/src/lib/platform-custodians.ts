import { apiFetch } from '@/lib/backend';

export type PlatformCustodian = {
  id: string;
  organizationName: string;
  walletAddress: string;
  fidAddress: string | null;
  platformAuthorityAddress: string | null;
  authorityTopic: number;
  status: 'REGISTERED' | 'FID_CREATED' | 'APPROVED' | 'SUSPENDED' | string;
  fidTxHash: string | null;
  approvalTxHash: string | null;
  approvedAt: string | null;
  suspendedAt: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  expectedFid?: string;
};

export function listPlatformCustodians(params: { walletAddress?: string; status?: string } = {}) {
  const search = new URLSearchParams();
  if (params.walletAddress) search.set('walletAddress', params.walletAddress);
  if (params.status) search.set('status', params.status);
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch<PlatformCustodian[]>(`/platform-custodians${suffix}`);
}

export function createPlatformCustodian(body: {
  organizationName: string;
  walletAddress: string;
  metadata?: Record<string, unknown>;
}, headers?: HeadersInit) {
  return apiFetch<PlatformCustodian>('/platform-custodians', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

export function recordPlatformCustodianFid(id: string, body: { fidAddress: string; txHash?: string }) {
  return apiFetch<PlatformCustodian>(`/platform-custodians/${id}/fid`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordPlatformCustodianApproval(
  id: string,
  body: { platformAuthorityAddress: string; txHash: string },
  headers?: HeadersInit,
) {
  return apiFetch<PlatformCustodian>(`/platform-custodians/${id}/approval`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

export function suspendPlatformCustodian(id: string, headers?: HeadersInit) {
  return apiFetch<PlatformCustodian>(`/platform-custodians/${id}/suspend`, {
    method: 'PATCH',
    headers,
  });
}

export function removePlatformCustodian(id: string, headers?: HeadersInit) {
  return apiFetch<PlatformCustodian>(`/platform-custodians/${id}`, {
    method: 'DELETE',
    headers,
  });
}

