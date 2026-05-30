import { clusterApiUrl, Connection, PublicKey } from '@solana/web3.js';

export interface SolanaClientConfig {
  rpcEndpoint: string;
  chainId?: string;
}

// MIGRATED: lightweight Solana connection helper.
export class SolanaClient {
  private readonly connection: Connection;

  constructor(config?: SolanaClientConfig) {
    const endpoint =
      process.env.NEXT_PUBLIC_RPC_URL ||
      config?.rpcEndpoint ||
      clusterApiUrl('mainnet-beta');
    this.connection = new Connection(endpoint, 'confirmed');
  }

  async connect(): Promise<{ address: string; client: Connection }> {
    return { address: '', client: this.connection };
  }

  async queryProgramAccount<T>(): Promise<T> {
    throw new Error('MIGRATED: use TrexClient/Solana PDA fetchers for account queries.');
  }

  async executeInstruction(): Promise<string> {
    throw new Error('MIGRATED: use TrexClient/Solana instruction builders for execution.');
  }

  async getBalance(address: string): Promise<string> {
    const lamports = await this.connection.getBalance(new PublicKey(address));
    return lamports.toString();
  }

  async getChainInfo() {
    return {
      chainId: process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta',
      rpcEndpoint: this.connection.rpcEndpoint,
      prefix: 'solana',
      tokenSymbol: 'SOL',
    };
  }

  async simulateTransaction() {
    throw new Error('MIGRATED: simulation moved to Solana transaction APIs.');
  }
}

// Backward-compatible aliases for legacy import paths.
export type CosmosClientConfig = SolanaClientConfig;
export const CosmosClient = SolanaClient;
export const zigChainClient = new SolanaClient();
