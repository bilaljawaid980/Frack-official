import { Keypair, PublicKey } from "@solana/web3.js";

export type TrustedIssuerConfig = {
  issuerFid: PublicKey;
  topics: number[];
  label: string;
};

export type DeployTokenSuiteInput = {
  tokenMint?: PublicKey;
  tokenMintKeypair?: Keypair;
  tokenName: string;
  tokenSymbol: string;
  decimals: number;
  isin: string;
  claimTopics: number[];
  trustedIssuers: TrustedIssuerConfig[];
  complianceModules: PublicKey[];
  sharedIrs?: PublicKey | null;
  salt: Buffer | Uint8Array;
};

export type TokenSuiteDeployment = {
  deployment: PublicKey;
  tokenMint: PublicKey;
  extraAccountMetas: PublicKey;
  tokenState: PublicKey;
  ownerState: PublicKey;
  irsState: PublicKey;
  tirState: PublicKey;
  ctrState: PublicKey;
  irpState: PublicKey;
  complianceState: PublicKey;
};
