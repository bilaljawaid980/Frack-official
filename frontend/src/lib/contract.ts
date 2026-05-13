import { RWAAsset, ComplianceCheck, Investor } from '@/types/rwa';

// MIGRATED: was direct legacy contract wrapper. API routes that still reference this file
// are deprecated in favor of client-side TrexClient + backend indexer endpoints.
export class RWAContractClient {
  async connect() {
    return true;
  }

  async registerAsset(_assetData?: unknown): Promise<string> {
    throw new Error('MIGRATED: registerAsset moved to Solana factory flow in TrexClient.createAssetToken');
  }

  async getAsset(_assetId?: string): Promise<RWAAsset> {
    throw new Error('MIGRATED: asset reads moved to backend indexer (/indexed/assets) + TrexClient.');
  }

  async listAssets(): Promise<RWAAsset[]> {
    return [];
  }

  async updateComplianceStatus(
    _assetId?: string,
    _status?: string,
    _requirements?: Record<string, any>,
  ): Promise<string> {
    throw new Error('MIGRATED: compliance updates moved to Solana compliance modules.');
  }

  async checkCompliance(
    _assetId?: string,
    _investorAddress?: string,
  ): Promise<ComplianceCheck> {
    throw new Error('MIGRATED: compliance checks moved to TrexClient.canTransfer.');
  }

  async verifyInvestor(
    _investorAddress?: string,
    _kycData?: Record<string, any>,
  ): Promise<string> {
    throw new Error('MIGRATED: investor verification moved to identity registry programs.');
  }

  async getInvestorStatus(_investorAddress?: string): Promise<Investor> {
    throw new Error('MIGRATED: investor status moved to identity registry/account fetchers.');
  }

  async mintTokens(
    _assetId?: string,
    _recipient?: string,
    _amount?: number,
  ): Promise<string> {
    throw new Error('MIGRATED: minting moved to TrexClient.mint via Solana instructions.');
  }

  async transferTokens(
    _assetId?: string,
    _recipient?: string,
    _amount?: number,
  ): Promise<string> {
    throw new Error('MIGRATED: transfers moved to TrexClient.transferFromToken via Solana token flows.');
  }

  async getTokenBalance(_assetId?: string, _address?: string): Promise<number> {
    return 0;
  }

  async simulateTransaction(_contractAddress?: string, _msg?: unknown) {
    throw new Error('MIGRATED: simulation moved to Solana transaction simulation APIs.');
  }

  async getTransactionStatus(_txHash?: string) {
    throw new Error('MIGRATED: transaction status moved to Solana connection.getTransaction.');
  }
}

export const rwaContractClient = new RWAContractClient();
