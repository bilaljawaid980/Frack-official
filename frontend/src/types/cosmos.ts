// MIGRATED: legacy Cosmos type module kept for compatibility, now Solana-native.

export interface SolanaTransaction {
  signature: string;
  slot: number;
  err: string | null;
  logs?: string[];
  blockTime?: number;
  memo?: string;
}

export interface ProgramInfo {
  address: string;
  programId: string;
  owner: string;
  label: string;
  admin?: string;
  created: {
    slot: number;
    signature: string;
  };
}

export interface ProgramQuery {
  programId: string;
  account: string;
  filters?: Record<string, unknown>;
}

export interface ProgramInstruction {
  programId: string;
  accounts: string[];
  data: string;
  memo?: string;
}

export interface ChainInfo {
  chainId: string;
  chainName: string;
  rpcEndpoint: string;
  restEndpoint?: string;
  explorerUrl: string;
  feeModel: string;
  prefix: string;
  coinDenom: string;
  coinDecimals: number;
}

export interface WalletInfo {
  address: string;
  name?: string;
  balance: Array<{
    denom: string;
    amount: string;
  }>;
  network: string;
  isConnected: boolean;
}

export interface SolanaProgramMsg {
  mint?: {
    recipient: string;
    amount: string;
  };

  burn?: {
    amount: string;
  };

  transfer?: {
    recipient: string;
    amount: string;
  };

  register_identity?: {
    wallet: string;
    fid: string;
    country: number;
  };

  add_claim?: {
    identity: string;
    topic: number;
    data_hash: string;
    expires_at: number;
  };

  get_account_info?: {
    account: string;
  };

  get_token_balance?: {
    owner: string;
    mint: string;
  };

  can_transfer?: {
    from: string;
    to: string;
    amount: string;
  };
}

// Backward-compatible aliases for existing imports.
export type CosmosTransaction = SolanaTransaction;
export type ContractInfo = ProgramInfo;
export type ContractQuery = ProgramQuery;
export type ContractExecute = ProgramInstruction;
export type SmartContractMsg = SolanaProgramMsg;
