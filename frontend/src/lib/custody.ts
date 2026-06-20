import { apiFetch } from '@/lib/backend';

export type CustodyMandate = {
  id: string;
  assetRequestId: string;
  factoryAssetId: number;
  issuerWallet: string;
  issuerFid: string;
  custodianWallet: string;
  custodianFid: string;
  mandateAddress: string | null;
  status: string;
  createTxHash: string | null;
  acceptTxHash: string | null;
  releaseTxHash: string | null;
  acceptedAt: string | null;
  releasedAt: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  expectedMandateAddress?: string;
  platformAuthorityAddress?: string;
};

export type CustodyAttestation = {
  id: string;
  mandateId: string;
  factoryAssetId: number;
  attestationAddress: string;
  documentHash: string;
  attestationHash: string;
  reserveRatioBps: number | null;
  status: string;
  txHash: string;
  attestedAt: string | null;
  expiresAt: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type DeploymentReadiness = {
  ready: boolean;
  factoryAssetId: number;
  expectedMandate: string;
  expectedAttestation: string;
  platformAuthority?: string;
  mandate?: CustodyMandate | null;
  attestation?: CustodyAttestation | null;
  backendChecks: Record<string, unknown>;
  blockchainChecks: Record<string, boolean>;
  reasons: Array<{ code: string; message: string }>;
};

export function listCustodyMandates(params: {
  custodianWallet?: string;
  assetRequestId?: string;
  factoryAssetId?: number | string;
  status?: string;
} = {}) {
  const search = new URLSearchParams();
  if (params.custodianWallet) search.set('custodianWallet', params.custodianWallet);
  if (params.assetRequestId) search.set('assetRequestId', params.assetRequestId);
  if (params.factoryAssetId !== undefined) search.set('factoryAssetId', String(params.factoryAssetId));
  if (params.status) search.set('status', params.status);
  const suffix = search.toString() ? `?${search.toString()}` : '';
  return apiFetch<CustodyMandate[]>(`/custody-mandates${suffix}`);
}


export function getCustodyMandate(mandateId: string) {
  return apiFetch<CustodyMandate & { attestations?: CustodyAttestation[] }>(`/custody-mandates/${mandateId}`);
}
export function createCustodyMandateRecord(assetRequestId: string, body: {
  issuerFid: string;
  custodianWallet: string;
  custodianFid: string;
  metadata?: Record<string, unknown>;
}) {
  return apiFetch<CustodyMandate>(`/asset-requests/${assetRequestId}/custody-mandates`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordCustodyMandateCreation(mandateId: string, body: {
  txHash: string;
  mandateAddress: string;
  actorWallet?: string;
}) {
  return apiFetch<CustodyMandate>(`/custody-mandates/${mandateId}/record-creation`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordCustodyMandateAcceptance(mandateId: string, body: {
  txHash: string;
  actorWallet?: string;
}) {
  return apiFetch<CustodyMandate>(`/custody-mandates/${mandateId}/accept`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function recordCustodyAttestation(mandateId: string, body: {
  txHash: string;
  attestationAddress: string;
  documentHash: string;
  attestationHash: string;
  reserveRatioBps?: number;
  actorWallet?: string;
  metadata?: Record<string, unknown>;
}) {
  return apiFetch<{ mandate: CustodyMandate; attestation: CustodyAttestation }>(
    `/custody-mandates/${mandateId}/attestations`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}

export function getDeploymentReadiness(assetRequestId: string) {
  return apiFetch<DeploymentReadiness>(`/asset-requests/${assetRequestId}/deployment-readiness`);
}



