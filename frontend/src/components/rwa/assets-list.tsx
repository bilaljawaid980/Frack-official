"use client";

import { motion } from "framer-motion";
import { Building2, MapPin, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/utils";
import { formatTokenizedPercentage } from "@/lib/asset-tokenization";
import { RWAAsset } from "@/types/rwa";
import Link from "next/link";

interface AssetsListProps {
  assets: RWAAsset[];
  loading?: boolean;
  limit?: number;
}

export function AssetsList({ assets, loading, limit }: AssetsListProps) {
  const displayAssets =
    typeof limit === "number" ? assets.slice(0, limit) : assets;
  const getAssetKey = (asset: RWAAsset, index: number) =>
    [
      asset.id,
      asset.tokenContractAddress || asset.contractAddress,
      asset.symbol,
      index,
    ]
      .filter(Boolean)
      .join("-");

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="h-20 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (assets.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Building2 className="h-12 w-12 mx-auto mb-2 opacity-50" />
        <p>No assets found</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {displayAssets.map((asset, index) => (
        <Link
          key={getAssetKey(asset, index)}
          href={`/assets/${asset.id}`}
          className="block min-w-0"
        >
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border p-4 transition-colors hover:bg-gray-50"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="shrink-0 rounded-lg bg-blue-50 p-2">
                <Building2 className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-medium truncate">{asset.name}</h4>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                  <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{asset.location}</span>
                  </span>
                  <Badge variant="outline" className="max-w-28 truncate text-xs">
                    {asset.assetType}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-4">
              <div className="w-24 text-right">
                <p className="font-semibold text-sm">
                  {formatCurrency(asset.underlyingValue)}
                </p>
                <p className="text-xs text-muted-foreground">Value</p>
              </div>

              <div className="w-20 text-right">
                <div className="flex items-center justify-end gap-1">
                  <p className="font-semibold text-sm text-green-600">
                    {formatTokenizedPercentage(asset)}
                  </p>
                  <TrendingUp className="h-3 w-3 text-green-600" />
                </div>
                <p className="text-xs text-muted-foreground">Tokenized</p>
              </div>
            </div>
          </motion.div>
        </Link>
      ))}
    </div>
  );
}
