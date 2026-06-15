// ─── FRACKS Frontend TypeScript Types ────────────────────────────────────────
//
// Mirrors the on-chain account structures from all FRACKS Anchor programs.
// All pubkey fields are represented as strings (base-58) for JSON-safe usage.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Token Types ──────────────────────────────────────────────────────────────

/**
 * On-chain TokenState account (fracks_token program).
 * Tracks the core configuration for a FRACKS security token.
 */
export interface TokenState {
  /** Base-58 address of the Token-2022 mint. */
  tokenMint: string;
  /** Base-58 address of the IdentityRegistryProtocol (IRP) state account. */
  identityRegistry: string;
  /** Base-58 address of the ComplianceState account. */
  compliance: string;
  /** Whether all token transfers are paused. */
  paused: boolean;
  /** Number of decimal places for the token. */
  decimals: number;
  /** Human-readable token name (max 32 chars). */
  name: string;
  /** Token ticker symbol (max 8 chars). */
  symbol: string;
  /** ISIN or other security identifier (max 12 chars). */
  isin: string;
  /** PDA bump seed. */
  bump: number;
}

export interface TokenMintHealth {
  mint: string;
  transferable: boolean;
  reason: string | null;
  missingModuleAccounts: string[];
}

/**
 * On-chain OwnerState account (fracks_token program).
 * Stores the direct issuer owner for the token suite.
 */
export interface OwnerState {
  /** Current token owner (base-58). */
  owner: string;
  /** Base-58 address of the associated token mint. */
  tokenMint: string;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain AgentRole account (fracks_token program).
 * Represents an authorised agent for a specific token.
 */
export interface AgentRole {
  /** Agent wallet address (base-58). */
  agent: string;
  /** Token mint this agent is associated with (base-58). */
  tokenMint: string;
  /** Whether the agent role is currently active. */
  isActive: boolean;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain FrozenWallet account (fracks_token program).
 */
export interface FrozenWallet {
  wallet: string;
  tokenMint: string;
  frozenBy: string;
  frozenAt: number;
  bump: number;
}

/**
 * On-chain PartialFreeze account (fracks_token program).
 */
export interface PartialFreeze {
  wallet: string;
  tokenMint: string;
  frozenAmount: bigint;
  frozenBy: string;
  bump: number;
}

/**
 * On-chain TransferApproval account (fracks_token_hook program).
 * Created before a transfer and consumed by the hook during execution.
 */
export interface TransferApproval {
  tokenState: string;
  sourceTokenAccount: string;
  destinationTokenAccount: string;
  authority: string;
  sourceWallet: string;
  destinationWallet: string;
  amount: bigint;
  fromBalance: bigint;
  toBalance: bigint;
  fromCountry: number;
  toCountry: number;
  /** Transfer kind byte (0 = normal, 1 = forced, 2 = recovery). */
  kind: number;
  consumed: boolean;
  finalized: boolean;
  bump: number;
}

// ─── Factory Types ────────────────────────────────────────────────────────────

/**
 * On-chain FactoryState account (fracks_factory program).
 */
export interface FactoryState {
  /** Factory owner (base-58). */
  owner: string;
  /** Registered fracks_token program ID (base-58). */
  tokenProgramId: string;
  /** Registered fracks_fid program ID (base-58). */
  fidProgramId: string;
  /** Registered fracks_irp program ID (base-58). */
  irpProgramId: string;
  /** Registered fracks_irs program ID (base-58). */
  irsProgramId: string;
  /** Registered fracks_tir program ID (base-58). */
  tirProgramId: string;
  /** Registered fracks_ctr program ID (base-58). */
  ctrProgramId: string;
  /** Registered fracks_compliance program ID (base-58). */
  complianceProgramId: string;
  /** Total number of token suites deployed via this factory. */
  deploymentCount: bigint;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain TokenDeployment account (fracks_factory program).
 * Records all account addresses for a deployed token suite.
 */
export interface TokenDeployment {
  /** Auto-incrementing deployment identifier. */
  deploymentId: bigint;
  /** The deployment PDA address itself (base-58). */
  deploymentPda: string;
  /** Issuer wallet that created this deployment (base-58). */
  issuer: string;
  /** 32-byte salt used to derive this deployment's PDAs. */
  salt: Uint8Array;
  /** Factory-level asset/custody identifier. */
  assetId: bigint;
  /** Token-2022 mint address (base-58). */
  tokenMint: string;
  /** fracks_token TokenState PDA (base-58). */
  tokenState: string;
  /** fracks_token OwnerState PDA (base-58). */
  ownerState: string;
  /** fracks_irp IdentityRegistryState PDA (base-58). */
  irpState: string;
  /** fracks_irs IdentityRegistryStorageState PDA (base-58). */
  irsState: string;
  /** fracks_tir TrustedIssuersState PDA (base-58). */
  tirState: string;
  /** fracks_ctr ClaimTopicsRegistry PDA (base-58). */
  ctrState: string;
  /** fracks_compliance ComplianceState PDA (base-58). */
  complianceState: string;
  /** Custody mandate PDA required by the sandbox deployment gate. */
  custodyMandate: string;
  /** Latest custody attestation PDA required by the sandbox deployment gate. */
  custodyAttestation: string;
  /** Unix timestamp of deployment (seconds). */
  deployedAt: number;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Arguments passed to the fracks_factory deploy_token_suite instruction.
 */
export interface DeployTokenSuiteArgs {
  /** Factory-level asset/custody identifier. */
  assetId: bigint;
  /** Issuer wallet that becomes final owner of the deployed suite. */
  issuer: string;
  /** Pre-generated Token-2022 mint keypair public key (base-58). */
  tokenMint: string;
  /** Custodian wallet that signs custody/reserve attestations. */
  custodian: string;
  /** Token name (max 32 chars). */
  tokenName: string;
  /** Token symbol (max 8 chars). */
  tokenSymbol: string;
  /** Number of decimal places (typically 6). */
  decimals: number;
  /** ISIN or security identifier (max 12 chars). */
  isin: string;
  /** Claim topic u64 values required for transfer eligibility. */
  claimTopics: bigint[];
  /** Trusted issuers to register at deployment time. */
  trustedIssuers: TrustedIssuerInput[];
  /** Compliance module program IDs (base-58) to attach at deployment. */
  complianceModules: string[];
  /** Per-module initialization params keyed by module program ID. */
  complianceModuleParams?: Record<string, Record<string, unknown>>;
  /** Optional existing IRS account to share (base-58), or null. */
  sharedIrs: string | null;
  /** 32-byte deployment salt. */
  salt: Uint8Array;
}

/**
 * Trusted issuer input for factory deployment.
 */
export interface TrustedIssuerInput {
  /** Raw wallet address entered by the user (base-58). Used to derive issuerFid. */
  walletAddress: string;
  /** Issuer FID PDA address (base-58), auto-derived from walletAddress. */
  issuerFid: string;
  /** Claim topics this issuer is trusted to sign. */
  topics: bigint[];
  /** Human-readable issuer label (max 64 chars). */
  label: string;
}

// ─── Compliance Types ─────────────────────────────────────────────────────────

/**
 * On-chain ComplianceState account (fracks_compliance program).
 */
export interface ComplianceState {
  /** Token owner (base-58). */
  owner: string;
  /** Associated token mint (base-58). */
  tokenMint: string;
  /** Ordered list of bound module program IDs (base-58). */
  modules: string[];
  /** Whether all compliance modules are paused. */
  modulesPaused: boolean;
  /** PDA bump seed. */
  bump: number;
}

/** UI-level representation of a compliance module option. */
export interface ComplianceModule {
  programId: string;
  name: string;
  description: string;
}

// ── Module State Types ────────────────────────────────────────────────────────

/**
 * On-chain DailyTransferLimitModule account (mod_daily_limit program).
 */
export interface DailyTransferLimitModule {
  owner: string;
  tokenMint: string;
  hookAuthority: string;
  dailyLimit: bigint;
  bump: number;
}

/**
 * Per-wallet daily usage tracking (mod_daily_limit program).
 */
export interface DailyWalletUsage {
  module: string;
  wallet: string;
  windowStartedAt: number;
  volume: bigint;
  bump: number;
}

/**
 * On-chain MaxBalanceModule account (mod_max_balance program).
 */
export interface MaxBalanceModule {
  owner: string;
  tokenMint: string;
  maxBalance: bigint;
  bump: number;
}

/**
 * On-chain MaxTransferModule account (mod_max_transfer program).
 */
export interface MaxTransferModule {
  owner: string;
  tokenMint: string;
  maxAmount: bigint;
  bump: number;
}

/**
 * On-chain LockupModule account (mod_lockup program).
 */
export interface LockupModule {
  owner: string;
  tokenMint: string;
  lockupEnd: number;
  bump: number;
}

/**
 * On-chain SupplyCapModule account (mod_supply_cap program).
 */
export interface SupplyCapModule {
  owner: string;
  tokenMint: string;
  hookAuthority: string;
  maxSupply: bigint;
  totalSupply: bigint;
  bump: number;
}

/**
 * On-chain MaxInvestorsModule account (mod_max_investors program).
 */
export interface MaxInvestorsModule {
  owner: string;
  tokenMint: string;
  hookAuthority: string;
  maxInvestors: bigint;
  holderCount: bigint;
  bump: number;
}

/**
 * On-chain country allowlist module account (mod_country_restrict program).
 */
export interface CountryRestrictModule {
  owner: string;
  tokenMint: string;
  allowedCountries: number[];
  bump: number;
}

/**
 * Per-country cap entry within InvestorCountryCapModule.
 */
export interface CountryCapEntry {
  country: number;
  cap: bigint;
}

/**
 * Per-country investor count tracking account (mod_country_cap program).
 */
export interface CountryInvestorCount {
  module: string;
  country: number;
  count: bigint;
  bump: number;
}

/**
 * On-chain InvestorCountryCapModule account (mod_country_cap program).
 */
export interface InvestorCountryCapModule {
  owner: string;
  tokenMint: string;
  hookAuthority: string;
  countryCaps: CountryCapEntry[];
  bump: number;
}

// ─── Identity Types ───────────────────────────────────────────────────────────

/**
 * On-chain WalletIdentity account (fracks_irs program).
 * Links a wallet to its FID and country.
 */
export interface WalletIdentity {
  /** Investor wallet address (base-58). */
  wallet: string;
  /** FID account address (base-58). */
  fid: string;
  /** ISO 3166-1 numeric country code. */
  country: number;
  /** IRS account this identity is stored in (base-58). */
  irs: string;
  /** Whether the issuer has activated/whitelisted this identity for token eligibility. */
  isActive: boolean;
  /** Issuer wallet that last changed activation state (base-58). */
  activatedBy: string;
  /** Unix timestamp when activation state last changed. */
  activatedAt: bigint;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain FidAccount (fracks_fid program).
 * The core on-chain identity record for a FRACKS participant.
 */
export interface FidAccount {
  /** Controlling wallet (base-58). */
  owner: string;
  /** Management key (base-58). */
  managementKey: string;
  /** Signing key used for claim signatures (base-58). */
  signerKey: string;
  /** Total number of claims ever added. */
  claimCount: number;
  /** Whether this FID is registered as a claim issuer. */
  isIssuer: boolean;
  /** ISO 3166-1 numeric country code. */
  country: number;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain ClaimAccount (fracks_fid program).
 */
export interface ClaimAccount {
  /** FID this claim belongs to (base-58). */
  fid: string;
  /** Sequential claim identifier within the FID. */
  claimId: number;
  /** u64 claim topic identifier. */
  topic: bigint;
  /** Issuer FID account (base-58). */
  issuerFid: string;
  /** SHA-256 hash of the off-chain claim data. */
  dataHash: Uint8Array;
  /** Ed25519 public key that signed the claim (base-58). */
  signerKey: string;
  /** 64-byte Ed25519 signature over the claim data. */
  signature: Uint8Array;
  /** Unix timestamp when the claim was issued. */
  issuedAt: number;
  /** Unix timestamp when the claim expires (0 = never). */
  expiresAt: number;
  /** Whether the claim has been revoked by the issuer. */
  revoked: boolean;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Simplified claim topic used in UI state.
 */
export interface ClaimTopic {
  topic: bigint;
  value: Uint8Array;
  issuer: string;
  expiry: bigint;
}

// ─── IRP / IRS Types ──────────────────────────────────────────────────────────

/**
 * On-chain IdentityRegistryState account (fracks_irp program).
 * The Identity Registry Protocol state for a specific token.
 */
export interface IrpState {
  /** Token owner (base-58). */
  owner: string;
  /** Associated token mint (base-58). */
  tokenMint: string;
  /** IRS account address (base-58). */
  irsAccount: string;
  /** TIR account address (base-58). */
  tirAccount: string;
  /** CTR account address (base-58). */
  ctrAccount: string;
  /** Active identity agent wallet addresses (base-58). */
  agents: string[];
  /** Total number of registered identities. */
  registeredCount: bigint;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain IdentityRegistryStorageState account (fracks_irs program).
 */
export interface IrsState {
  /** IRS owner (base-58). */
  owner: string;
  /** Bound IRP registry addresses (base-58). */
  boundRegistries: string[];
  /** Total registered wallet count. */
  registeredCount: bigint;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain TrustedIssuersState account (fracks_tir program).
 */
export interface TirState {
  /** TIR owner (base-58). */
  owner: string;
  /** Associated token mint (base-58). */
  tokenMint: string;
  /** Total number of registered issuers. */
  issuerCount: number;
  /** PDA bump seed. */
  bump: number;
}

/**
 * On-chain IssuerEntry account (fracks_tir program).
 */
export interface IssuerEntry {
  /** Issuer FID account (base-58). */
  issuerFid: string;
  /** Parent TIR account (base-58). */
  tir: string;
  /** Claim topics this issuer is trusted to sign. */
  allowedTopics: bigint[];
  /** Whether this issuer is currently active. */
  isActive: boolean;
  /** Human-readable label for this issuer. */
  label: string;
  /** PDA bump seed. */
  bump: number;
}

// ─── Transfer Types ───────────────────────────────────────────────────────────

/** Result of submitting a transfer transaction. */
export interface TransferResult {
  /** Transaction signature (base-58). */
  signature: string;
  success: boolean;
  error?: string;
}

/** Result of a transaction simulation (preflight). */
export interface SimulationResult {
  success: boolean;
  error?: string;
  notice?: string;
  logs: string[];
}

/** Historical transfer record for UI display. */
export interface TransferHistoryItem {
  /** Transaction signature (base-58). */
  signature: string;
  /** Sender wallet address (base-58). */
  from: string;
  /** Recipient wallet address (base-58). */
  to: string;
  /** Transfer amount in base units. */
  amount: bigint;
  /** Unix timestamp (seconds). */
  timestamp: number;
  status: "success" | "failed";
  error?: string;
}

// ─── UI / Dashboard Types ─────────────────────────────────────────────────────

/** Aggregated stats shown on the token dashboard. */
export interface DashboardStats {
  totalSupply: bigint;
  totalInvestors: number;
  frozenWallets: number;
  activeModules: number;
}

/** UI-level compliance module configuration including runtime params. */
export interface ComplianceModuleConfig {
  /** Short module identifier (e.g. "daily_limit"). */
  moduleId: string;
  /** Program ID (base-58). */
  programId: string;
  /** Display name. */
  name: string;
  /** Whether the module is currently bound and active. */
  enabled: boolean;
  /** Module-specific parameters (varies by module type). */
  params: Record<string, unknown>;
}

// ─── Governance Types ─────────────────────────────────────────────────────────

/** Direct-authority admin state summary for UI display. */
export interface MultisigState {
  /** Admin authority account address (base-58). */
  address: string;
  /** Number of approvals required to execute; direct mode uses 1. */
  threshold: number;
  /** Authorized admin wallet addresses (base-58). */
  members: string[];
  /** Total authority actions tracked by the UI. */
  transactionCount: number;
}

/** Governance action tracked in UI state. */
export interface GovernanceProposal {
  /** Sequential action index. */
  index: number;
  /** Proposer wallet (base-58). */
  proposer: string;
  /** Human-readable description. */
  description: string;
  status: "pending" | "approved" | "executed" | "rejected";
  /** Number of approvals received. */
  approvals: number;
  /** Unix timestamp when the action was created (seconds). */
  createdAt: number;
}

// ─── Network / Connection Types ───────────────────────────────────────────────

export type SolanaCommitment = "processed" | "confirmed" | "finalized";

export type SolanaNetwork = "mainnet-beta" | "testnet" | "devnet" | "localnet";

/** RPC and network configuration. */
export interface NetworkConfig {
  network: SolanaNetwork;
  rpcUrl: string;
  wsUrl?: string;
  commitment: SolanaCommitment;
}

// ─── Token Suite (aggregated view) ───────────────────────────────────────────

/**
 * A fully-fetched token suite combining all program states.
 * Used in the dashboard and token detail views.
 */
export interface TokenSuite {
  deployment: TokenDeployment;
  tokenState: TokenState;
  ownerState: OwnerState;
  complianceState: ComplianceState;
  irpState: IrpState;
  irsState: IrsState;
  tirState: TirState;
  stats: DashboardStats;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Form State ───────────────────────────────────────────────────────────────

export interface FormField<T> {
  value: T;
  error?: string;
  touched: boolean;
}

export type FormState<T extends Record<string, unknown>> = {
  [K in keyof T]: FormField<T[K]>;
};
