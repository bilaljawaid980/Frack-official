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
  const url =
    rpcUrl ||
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    'https://devnet.helius-rpc.com/?api-key=f2852f85-8a60-4eaf-bbe7-009aa1b9e41f';
  if (url.startsWith('http') || url.startsWith('ws')) return url;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
};

// MIGRATED: was ZigChain config, now Solana cluster config while preserving exported names.
export const ZIGCHAIN_TESTNET: ZigChainConfig = {
  rpcEndpoint: getAbsoluteRpcUrl(
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL
  ),
  chainId:
    process.env.NEXT_PUBLIC_SOLANA_NETWORK ||
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ||
    'devnet',
  prefix: 'solana',
  gasPrice: '0',
  restEndpoint:
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL,
  explorerUrl:
    process.env.NEXT_PUBLIC_EXPLORER_URL ||
    process.env.NEXT_PUBLIC_SOLANA_EXPLORER ||
    'https://explorer.solana.com',
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
  ...(process.env.NEXT_PUBLIC_TOKEN_MINTS || '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean),
  process.env.NEXT_PUBLIC_FRACKS_TOKEN_MINT || 'So11111111111111111111111111111111111111112',
].filter(Boolean);

const tokenList = envTokenList.length > 0 ? envTokenList : defaultTokens;

export const TREX_CONTRACTS = {
  token:
    tokenList[0] ||
    process.env.NEXT_PUBLIC_FRACKS_TOKEN_MINT ||
    'So11111111111111111111111111111111111111112',
  tokens: tokenList,

  identityRegistry:
    process.env.NEXT_PUBLIC_IRP_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_FRACKS_IRP ||
    'HQqgbvfmSzY1yEyhVbyhYqSsbVrRmjUnPmm2nE4ZwRvZ',
  trustedIssuers:
    process.env.NEXT_PUBLIC_TIR_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_FRACKS_TIR ||
    '9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L',
  claimTopics:
    process.env.NEXT_PUBLIC_CTR_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_FRACKS_CTR ||
    '8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig',
  compliance:
    process.env.NEXT_PUBLIC_COMPLIANCE_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_FRACKS_COMPLIANCE ||
    'HnJiNrmDeVFZksgEXaQwyVqHXQLRcyqXEksbYhkiPFFV',

  onchainIdCodeId: 0,

  factory:
    process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID ||
    process.env.NEXT_PUBLIC_FRACKS_FACTORY ||
    'FtrzQ1hhjL7vbEPAxLBeLgrmomanSVj9UpV6LLJ5TYFS',
};

export const EXAMPLE_IDENTITIES = {
  issuer:
    process.env.NEXT_PUBLIC_ISSUER_IDENTITY ||
    'Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW',
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
};

export const CONTRACT_ADDRESSES = {
  rwaRegistry: TREX_CONTRACTS.token,
  complianceModule: TREX_CONTRACTS.compliance,
  tokenizationModule: TREX_CONTRACTS.token,
  kycModule: TREX_CONTRACTS.identityRegistry,
};
