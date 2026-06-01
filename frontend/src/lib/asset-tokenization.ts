import type { RWAAsset } from "@/types/rwa";

export function getTokenizedPercentage(
  asset: Pick<RWAAsset, "tokenizedAmount" | "totalSupply">,
) {
  const tokenizedAmount = Number(asset.tokenizedAmount);
  const totalSupply = Number(asset.totalSupply);

  if (
    !Number.isFinite(tokenizedAmount) ||
    !Number.isFinite(totalSupply) ||
    totalSupply <= 0
  ) {
    return 0;
  }

  return (tokenizedAmount / totalSupply) * 100;
}

export function formatTokenizedPercentage(
  asset: Pick<RWAAsset, "tokenizedAmount" | "totalSupply">,
) {
  return `${getTokenizedPercentage(asset).toFixed(1)}%`;
}
