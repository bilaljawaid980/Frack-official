export type TokenPurchaseRequestStatus =
  | "SUBMITTED"
  | "PENDING_KYC"
  | "PENDING_AML"
  | "PENDING_ISSUER_REVIEW"
  | "APPROVED_FOR_MINT"
  | "ACTION_REQUIRED_INVESTOR_IDENTITY"
  | "REJECTED"
  | "MINTED";

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
  amlClaimTxHash?: string | null;
  mintTxHash?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
  updatedAt: string;
};
