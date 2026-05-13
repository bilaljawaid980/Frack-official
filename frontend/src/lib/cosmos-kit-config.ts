// MIGRATED: was Cosmos Kit chain/wallet config, now Solana network + wallet constants.

const isDevnet = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER || '').toLowerCase() === 'devnet';

export const SOLANA_CHAIN_NAME = isDevnet ? 'solana-devnet' : 'solana-mainnet-beta';

export const SOLANA_CHAIN = {
  chain_id: SOLANA_CHAIN_NAME,
  chain_name: SOLANA_CHAIN_NAME,
  pretty_name: isDevnet ? 'Solana Devnet' : 'Solana Mainnet Beta',
} as const;

export const SOLANA_ASSETS = {
  chain_name: SOLANA_CHAIN_NAME,
  assets: [
    {
      base: 'lamports',
      name: 'Solana',
      symbol: 'SOL',
      display: 'SOL',
      denom_units: [
        { denom: 'lamports', exponent: 0 },
        { denom: 'SOL', exponent: 9 },
      ],
    },
  ],
} as const;

export const SOLANA_DEFAULT_WALLETS = ['Phantom', 'Backpack', 'Solflare'] as const;

// Backward-compatible aliases for old import paths/names.
export const COSMOS_KIT_CHAIN_NAME = SOLANA_CHAIN_NAME;
export const zigchainChain = SOLANA_CHAIN;
export const zigchainAssets = SOLANA_ASSETS;
export const cosmosKitWallets: readonly string[] = SOLANA_DEFAULT_WALLETS;
export const walletConnectOptions: Record<string, unknown> = {};
