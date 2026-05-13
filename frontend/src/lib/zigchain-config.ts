export interface ZigChainConfig {
  rpcEndpoint: string;
  chainId: string;
  prefix: string;
  gasPrice: string;
  restEndpoint?: string;
  explorerUrl?: string;
  tokenDenom: string;
  tokenSymbol: string;
}

const getAbsoluteRpcUrl = (rpcUrl?: string) => {
  const url = rpcUrl || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.mainnet-beta.solana.com';
  if (url.startsWith('http') || url.startsWith('ws')) return url;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
};

// MIGRATED: was ZigChain config, now Solana cluster config while preserving exported names.
export const ZIGCHAIN_TESTNET: ZigChainConfig = {
  rpcEndpoint: getAbsoluteRpcUrl(process.env.NEXT_PUBLIC_RPC_URL),
  chainId: process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta',
  prefix: 'solana',
  gasPrice: '0',
  restEndpoint: process.env.NEXT_PUBLIC_RPC_URL,
  explorerUrl: process.env.NEXT_PUBLIC_SOLANA_EXPLORER || 'https://explorer.solana.com',
  tokenDenom: 'lamports',
  tokenSymbol: 'SOL',
};

export const ZIGCHAIN_MAINNET: ZigChainConfig = ZIGCHAIN_TESTNET;

export const getZigChainConfig = (): ZigChainConfig => ZIGCHAIN_TESTNET;

const envTokenList = (process.env.NEXT_PUBLIC_TREX_TOKEN_LIST || '')
  .split(',')
  .map((token) => token.trim())
  .filter(Boolean);

const defaultTokens = [
  process.env.NEXT_PUBLIC_FRACKS_TOKEN_MINT || 'So11111111111111111111111111111111111111112',
].filter(Boolean);

const tokenList = envTokenList.length > 0 ? envTokenList : defaultTokens;

export const TREX_CONTRACTS = {
  token: process.env.NEXT_PUBLIC_FRACKS_TOKEN_MINT || tokenList[0] || 'So11111111111111111111111111111111111111112',
  tokens: tokenList,

  identityRegistry:
    process.env.NEXT_PUBLIC_FRACKS_IRP ||
    '6dDKwtRbGkHJhU9LztpDkBC3fUdM46WeKJdrASFikce6',
  trustedIssuers:
    process.env.NEXT_PUBLIC_FRACKS_TIR ||
    'Am5W7oEe8NCU4jdLP8qyUT3gjUPCDsvTSxGhdCQp1ETS',
  claimTopics:
    process.env.NEXT_PUBLIC_FRACKS_CTR ||
    'B15EFQKwnfbNHXHhPVvVcw18PaBeTDsRLNRno3QS8Yna',
  compliance:
    process.env.NEXT_PUBLIC_FRACKS_COMPLIANCE ||
    '9XYxZzDfU17BBpN1qhdu7RDCCrV6uebDgi5xse7Jbz5d',

  onchainIdCodeId: 0,

  factory:
    process.env.NEXT_PUBLIC_FRACKS_FACTORY ||
    '3Vd81SWhR97nafQjsb43NGuP2L3RiCVcyzprXJ2yFs5M',
};

export const EXAMPLE_IDENTITIES = {
  issuer:
    process.env.NEXT_PUBLIC_ISSUER_IDENTITY ||
    '7Y6WJtDmRMcRYgENfKATsGnQTQJ2wAQfF3LhoBt3KbBH',
  investor:
    process.env.NEXT_PUBLIC_INVESTOR_IDENTITY ||
    '11111111111111111111111111111111',
};

export const CONTRACT_OWNERS = {
  admin: process.env.NEXT_PUBLIC_PLATFORM_OWNER || '',
  adminName: 'platform_owner',
};

export const ROLE_WALLETS = {
  platformOwner: process.env.NEXT_PUBLIC_PLATFORM_OWNER || '',
  kycIssuer: process.env.NEXT_PUBLIC_KYC_ISSUER || '',
  fundRealEstate: process.env.NEXT_PUBLIC_FUND_REAL || '',
  fundStocks: process.env.NEXT_PUBLIC_FUND_STOCKS || '',
};

export const CONTRACT_ADDRESSES = {
  rwaRegistry: TREX_CONTRACTS.token,
  complianceModule: TREX_CONTRACTS.compliance,
  tokenizationModule: TREX_CONTRACTS.token,
  kycModule: TREX_CONTRACTS.identityRegistry,
};
