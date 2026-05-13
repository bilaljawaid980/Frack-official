export const INDEXER_DEFAULTS = {
  rpcEndpoint: "https://api.mainnet-beta.solana.com",
  factoryProgram: "3Vd81SWhR97nafQjsb43NGuP2L3RiCVcyzprXJ2yFs5M",
  tokenList: [] as string[],
  maxAssetScan: 25,
  txScanLimit: 100,
  txScanPages: 1,
};

export function getIndexerConfig() {
  const rpcEndpoint = process.env.SOLANA_RPC_URL || INDEXER_DEFAULTS.rpcEndpoint;
  const factoryProgram = process.env.FRACKS_FACTORY || INDEXER_DEFAULTS.factoryProgram;
  const tokenListRaw = process.env.INDEXER_TOKENS || INDEXER_DEFAULTS.tokenList.join(",");

  const tokenContracts = tokenListRaw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const maxAssetScan = parseInt(
    process.env.INDEXER_MAX_ASSETS || `${INDEXER_DEFAULTS.maxAssetScan}`,
    10
  );

  const txScanLimit = parseInt(
    process.env.INDEXER_TX_SCAN_LIMIT || `${INDEXER_DEFAULTS.txScanLimit}`,
    10
  );

  const txScanPages = parseInt(
    process.env.INDEXER_TX_SCAN_PAGES || `${INDEXER_DEFAULTS.txScanPages}`,
    10
  );

  return {
    rpcEndpoint,
    factoryProgram,
    tokenContracts,
    maxAssetScan,
    txScanLimit,
    txScanPages,
  };
}
