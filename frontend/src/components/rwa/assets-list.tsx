"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Building2, ChevronLeft, ChevronRight, MapPin, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils";
import { formatTokenizedPercentage } from "@/lib/asset-tokenization";
import { RWAAsset } from "@/types/rwa";
import Link from "next/link";

interface AssetsListProps {
  assets: RWAAsset[];
  loading?: boolean;
  limit?: number;
  pageSize?: number;
}

export function AssetsList({
  assets,
  loading,
  limit,
  pageSize = 8,
}: AssetsListProps) {
  const [page, setPage] = useState(0);
  const sourceAssets = useMemo(
    () => (typeof limit === "number" ? assets.slice(0, limit) : assets),
    [assets, limit],
  );
  const totalPages = Math.max(1, Math.ceil(sourceAssets.length / pageSize));
  const effectivePage = Math.min(page, totalPages - 1);
  const displayAssets = sourceAssets.slice(
    effectivePage * pageSize,
    effectivePage * pageSize + pageSize,
  );

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
        {[...Array(pageSize)].map((_, i) => (
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
    <div className="flex flex-1 flex-col">
      <div className="space-y-3">
        {displayAssets.map((asset, index) => (
          <Link
            key={getAssetKey(asset, effectivePage * pageSize + index)}
            href={`/assets/${asset.id}`}
            className="block min-w-0"
          >
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.04 }}
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

      <div className="mt-4 flex items-center justify-end gap-2">
        <span className="text-xs text-slate-500">
          Page {effectivePage + 1} of {totalPages}
        </span>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={effectivePage === 0}
          onClick={() => setPage(Math.max(0, effectivePage - 1))}
          aria-label="Previous assets page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={effectivePage >= totalPages - 1}
          onClick={() => setPage(Math.min(totalPages - 1, effectivePage + 1))}
          aria-label="Next assets page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
