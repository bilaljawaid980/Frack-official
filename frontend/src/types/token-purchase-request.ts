export type TokenPurchaseRequestStatus =
  | "SUBMITTED"
  | "PENDING_KYC"
  | "PENDING_AML"
  | "PENDING_ISSUER_REVIEW"
  | "APPROVED_FOR_MINT"
  | "ACTION_REQUIRED_INVESTOR_IDENTITY"
  | "REJECTED"
  | "MINTED"
  | "CANCELLED";

export type TokenPurchaseRequest = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  investorWallet: string;
  amount: number;
  fullName?: string | null;
  email?: string | null;
  nationality?: string | null;
  country?: string | null;
  idDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
  kycProvider?: string | null;
  amlProvider?: string | null;
  issuerWallet?: string | null;
  requiredClaimTopics: string[];
  status: TokenPurchaseRequestStatus;
  kycClaimTxHash?: string | null;
  kycApprovedAt?: string | null;
  amlClaimTxHash?: string | null;
  amlApprovedAt?: string | null;
  whitelistTxHash?: string | null;
  whitelistedAt?: string | null;
  activationTxHash?: string | null;
  activatedAt?: string | null;
  mintTxHash?: string | null;
  mintedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
};
