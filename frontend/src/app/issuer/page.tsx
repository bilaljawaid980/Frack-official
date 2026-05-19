"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/hooks/use-wallet";
import { useMintTokens } from "@/hooks/useTokenActions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/backend";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";

type IndexedAsset = {
  id: string;
  factoryAssetId?: number | null;
  tokenContract: string;
  name: string;
  symbol: string;
  issuerWallet?: string | null;
  legalOwner?: string | null;
};

type IndexedBalance = {
  tokenContract: string;
  walletAddress: string;
  balance: string;
  updatedAt: string;
};

type AssetRequest = {
  id: string;
  status: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DEPLOYED";
  issuerWallet: string;
  name: string;
  symbol: string;
  assetType: string;
  underlyingValue: number;
  createdAt: string;
};

export default function IssuerPage() {
  const { address: walletAddress } = useWallet();
  const mintTokens = useMintTokens();
  const [assets, setAssets] = useState<IndexedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, IndexedBalance[]>>(
    {},
  );
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<TokenPurchaseRequest[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);

  const filteredAssets = useMemo(() => {
    if (!walletAddress) return [];
    const target = walletAddress.toLowerCase();
    return assets.filter((asset) => {
      const issuer = asset.issuerWallet || asset.legalOwner;
      return issuer?.toLowerCase() === target;
    });
  }, [assets, walletAddress]);

  useEffect(() => {
    let cancelled = false;
    const loadAssets = async () => {
      setLoading(true);
      setError(null);
      try {
        const indexedAssets = await apiFetch<IndexedAsset[]>("/indexed/assets");
        if (!cancelled) setAssets(indexedAssets);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load indexed assets",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAssets();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!walletAddress) {
      const timeout = window.setTimeout(() => setPurchaseRequests([]), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ issuerWallet: walletAddress });
        const requests = await apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests?${params.toString()}`,
        );
        if (!cancelled) setPurchaseRequests(requests);
      } catch {
        if (!cancelled) setPurchaseRequests([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [walletAddress]);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const requests = await apiFetch<AssetRequest[]>("/asset-requests");
        if (!cancelled) setAssetRequests(requests);
      } catch {
        if (!cancelled) setAssetRequests([]);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (filteredAssets.length === 0) {
      const timeout = window.setTimeout(() => setBalances({}), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const loadBalances = async () => {
      setLoadingBalances(true);
      try {
        const results = await Promise.all(
          filteredAssets.map(async (asset) => {
            const tokenBalances = await apiFetch<IndexedBalance[]>(
              `/indexed/tokens/${asset.tokenContract}/balances`,
            );
            return [asset.tokenContract, tokenBalances] as const;
          }),
        );

        if (!cancelled) {
          const next: Record<string, IndexedBalance[]> = {};
          results.forEach(([contract, tokenBalances]) => {
            next[contract] = tokenBalances;
          });
          setBalances(next);
        }
      } finally {
        if (!cancelled) setLoadingBalances(false);
      }
    };

    loadBalances();
    return () => {
      cancelled = true;
    };
  }, [filteredAssets]);

  const hasNonZeroBalance = (balance: string) => {
    try {
      return BigInt(balance) > 0n;
    } catch {
      return false;
    }
  };

  const visibleRequests = useMemo(() => {
    if (!walletAddress) return [];
    return assetRequests.filter(
      (request) =>
        request.issuerWallet.toLowerCase() === walletAddress.toLowerCase(),
    );
  }, [assetRequests, walletAddress]);

  const issuerPurchaseQueue = useMemo(
    () =>
      purchaseRequests.filter((request) =>
        ["PENDING_ISSUER_REVIEW", "APPROVED_FOR_MINT"].includes(request.status),
      ),
    [purchaseRequests],
  );

  const assetsByToken = useMemo(() => {
    const map = new Map<string, IndexedAsset>();
    assets.forEach((asset) => {
      map.set(asset.tokenContract, asset);
      if (asset.id) map.set(asset.id, asset);
    });
    return map;
  }, [assets]);

  const updatePurchaseRequestStatus = async (
    request: TokenPurchaseRequest,
    status: TokenPurchaseRequest["status"],
    extra: Record<string, string | undefined> = {},
  ) => {
    await apiFetch(`/token-purchase-requests/${request.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        reviewerWallet: walletAddress,
        ...extra,
      }),
    });
    setPurchaseRequests((current) =>
      current.map((item) =>
        item.id === request.id ? { ...item, status, ...extra } : item,
      ),
    );
  };

  const handleMintPurchaseRequest = async (request: TokenPurchaseRequest) => {
    try {
      const baseAmount = BigInt(Math.round(Number(request.amount) * 1_000_000));
      const sig = await mintTokens.mutateAsync({
        mint: new PublicKey(request.tokenContract),
        recipient: new PublicKey(request.investorWallet),
        amount: baseAmount,
      });
      await updatePurchaseRequestStatus(request, "MINTED", { mintTxHash: sig });
      toast.success("Tokens minted to investor wallet");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mint failed");
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border border-slate-200/70 bg-white/80 shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Tokenization Requests</CardTitle>
              <CardDescription>
                Off-chain asset requests submitted by the connected issuer
                wallet.
              </CardDescription>
            </div>
            <Link href="/issuer/submit-request">
              <Button>Tokenize Asset</Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {!walletAddress ? (
            <div className="text-sm text-slate-500">
              Connect an issuer wallet to view submitted requests.
            </div>
          ) : visibleRequests.length === 0 ? (
            <div className="text-sm text-slate-500">
              No tokenization requests submitted yet.
            </div>
          ) : (
            <div className="space-y-3">
              {visibleRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <div className="font-semibold text-slate-900">
                      {request.name} ({request.symbol})
                    </div>
                    <div className="text-xs capitalize text-slate-500">
                      {request.assetType.replace("-", " ")} · $
                      {request.underlyingValue.toLocaleString()}
                    </div>
                  </div>
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    {request.status.replace("_", " ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-slate-200/70 bg-white/80 shadow-sm">
        <CardHeader>
          <CardTitle>Investor Purchase Queue</CardTitle>
          <CardDescription>
            Requests that passed required provider checks and are waiting for
            issuer settlement review and minting.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {issuerPurchaseQueue.length === 0 ? (
            <div className="text-sm text-slate-500">
              No investor purchase requests awaiting issuer action.
            </div>
          ) : (
            <div className="space-y-3">
              {issuerPurchaseQueue.map((request) => {
                  const asset =
                    assetsByToken.get(request.tokenContract) ||
                    (request.assetId ? assetsByToken.get(request.assetId) : undefined);

                  return (
                    <div
                      key={request.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between"
                    >
                      <div>
                        <div className="font-semibold text-slate-900">
                          {asset
                            ? `${asset.name} (${asset.symbol})`
                            : "Unknown token"}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          {request.amount} tokens requested
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Investor{" "}
                          <span className="font-mono">
                            {request.investorWallet.slice(0, 6)}...
                            {request.investorWallet.slice(-4)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Token{" "}
                          <span className="font-mono">
                            {request.tokenContract.slice(0, 8)}...
                            {request.tokenContract.slice(-6)}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Status: {request.status.replaceAll("_", " ")}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {request.status === "PENDING_ISSUER_REVIEW" && (
                          <Button
                            variant="outline"
                            onClick={() =>
                              updatePurchaseRequestStatus(
                                request,
                                "APPROVED_FOR_MINT",
                              )
                            }
                          >
                            Mark Settlement Approved
                          </Button>
                        )}
                        <Button
                          disabled={
                            request.status !== "APPROVED_FOR_MINT" ||
                            mintTokens.isPending
                          }
                          onClick={() => handleMintPurchaseRequest(request)}
                        >
                          Mint to Investor
                        </Button>
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border border-slate-200/70 bg-white/80 shadow-sm">
        <CardHeader>
          <CardTitle>Issued Assets</CardTitle>
          <CardDescription>
            Assets linked to the connected wallet. Click an asset to review
            details.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-slate-500">Loading assets...</div>
          ) : error ? (
            <div className="text-sm text-red-600">
              Failed to load assets: {error}
            </div>
          ) : filteredAssets.length === 0 ? (
            <div className="text-sm text-slate-500">
              No assets found for this issuer.
            </div>
          ) : (
            <div className="space-y-6">
              {filteredAssets.map((asset) => {
                const tokenBalances = balances[asset.tokenContract] || [];
                const holders = tokenBalances.filter((entry) =>
                  hasNonZeroBalance(entry.balance),
                );

                return (
                  <Card
                    key={asset.tokenContract}
                    className="border border-slate-200/70"
                  >
                    <CardHeader className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="text-base">
                            {asset.name}
                          </CardTitle>
                          <CardDescription>
                            {asset.symbol} - Asset ID{" "}
                            {asset.factoryAssetId ?? asset.id}
                          </CardDescription>
                        </div>
                        <Link
                          href={`/assets/${asset.factoryAssetId ?? asset.id}`}
                          className="text-sm text-blue-600 hover:underline"
                        >
                          View Asset
                        </Link>
                      </div>
                      <div className="text-xs text-slate-500">
                        Token Contract: {asset.tokenContract}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Investor</TableHead>
                            <TableHead>Wallet</TableHead>
                            <TableHead className="text-right">
                              Balance
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {holders.length === 0 ? (
                            <TableRow>
                              <TableCell
                                colSpan={3}
                                className="text-sm text-slate-500"
                              >
                                {loadingBalances
                                  ? "Loading balances..."
                                  : "No indexed holders for this asset."}
                              </TableCell>
                            </TableRow>
                          ) : (
                            holders.map((holder) => (
                              <TableRow key={holder.walletAddress}>
                                <TableCell>Investor</TableCell>
                                <TableCell className="font-mono text-xs">
                                  {holder.walletAddress}
                                </TableCell>
                                <TableCell className="text-right font-medium">
                                  {loadingBalances ? "..." : holder.balance}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
