"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/backend";
import { formatTokenAmount, parseTokenAmount } from "@/lib/token-utils";
import { useAssetsContext } from "@/contexts/assets-context";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { TransferService, type TransferPreflightResult } from "@/services/transfer";

type TokenSellListing = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  sellerWallet: string;
  amountBaseUnits: string;
  amountRemaining: string;
  price?: number | null;
  currency?: string | null;
  status: string;
  settlementTerms?: string | null;
  expiresAt?: string | null;
  createdAt: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getTrustedProvider(asset: any, topic: string) {
  const issuers = asset?.metadata?.trustedIssuers || [];
  return issuers.find((issuer: any) =>
    (issuer.topics || []).map(String).includes(topic),
  )?.walletAddress || null;
}

function getBuyIntentStatus(preflight: TransferPreflightResult) {
  const buyer = preflight.recipient;
  if (!buyer.identityExists && buyer.blockers.some((item) => item.includes("FID"))) {
    return "ACTION_REQUIRED_BUYER_FID";
  }
  if (preflight.requiredClaimTopics.includes("1") && buyer.blockers.some((item) => item.includes("topic 1"))) {
    return "PENDING_KYC";
  }
  if (preflight.requiredClaimTopics.includes("2") && buyer.blockers.some((item) => item.includes("topic 2"))) {
    return "PENDING_AML";
  }
  if (!buyer.identityExists) return "PENDING_ISSUER_WHITELIST";
  if (!buyer.identityActive) return "PENDING_ISSUER_ACTIVATION";
  if (preflight.ok) return "READY_FOR_SELLER_ACCEPTANCE";
  return preflight.status;
}

export default function ListingsPage() {
  const { assets } = useAssetsContext();
  const { address, connectWallet } = useWallet();
  const anchorProvider = useAnchorProvider();
  const [listings, setListings] = useState<TokenSellListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<TokenSellListing | null>(null);
  const [buyAmount, setBuyAmount] = useState("");
  const [creatingIntent, setCreatingIntent] = useState(false);

  const assetByToken = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>();
    assets.forEach((asset) => {
      const token = asset.contractAddress || asset.tokenContractAddress;
      if (token) map.set(token, asset);
    });
    return map;
  }, [assets]);

  const loadListings = async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<TokenSellListing[]>("/token-listings?open=true");
      setListings(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load listings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadListings();
  }, []);

  const openBuyRequest = (listing: TokenSellListing) => {
    const asset = assetByToken.get(listing.tokenContract);
    const decimals = Number(asset?.metadata?.decimals ?? 6);
    setSelectedListing(listing);
    setBuyAmount(formatTokenAmount(listing.amountRemaining, decimals).replace(/,/g, ""));
  };

  const createBuyIntent = async () => {
    if (!selectedListing) return;
    if (!address) {
      await connectWallet();
      return;
    }
    if (!anchorProvider) {
      toast.error("Connect buyer wallet first.");
      return;
    }
    setCreatingIntent(true);
    const loadingToast = toast.loading("Checking buyer eligibility...");
    try {
      const asset = assetByToken.get(selectedListing.tokenContract);
      const decimals = Number(asset?.metadata?.decimals ?? 6);
      const amountBaseUnits = BigInt(parseTokenAmount(buyAmount, decimals));
      if (amountBaseUnits <= 0n) throw new Error("Enter a valid buy amount.");
      if (amountBaseUnits > BigInt(selectedListing.amountRemaining)) {
        throw new Error("Buy amount exceeds listing remaining amount.");
      }

      const service = new TransferService(anchorProvider.connection, anchorProvider);
      const preflight = await service.preflightTransfer(
        new PublicKey(selectedListing.tokenContract),
        new PublicKey(selectedListing.sellerWallet),
        new PublicKey(address),
        amountBaseUnits,
        decimals,
      );
      const status = getBuyIntentStatus(preflight);
      if (
        status.startsWith("SELLER_") ||
        status.startsWith("SENDER_") ||
        status === "INSUFFICIENT_TRANSFERABLE_BALANCE"
      ) {
        throw new Error(preflight.blockers[0] || "Seller is not currently eligible to transfer this amount.");
      }

      await apiFetch(`/token-listings/${selectedListing.id}/buy-intents`, {
        method: "POST",
        body: JSON.stringify({
          buyerWallet: address,
          amountBaseUnits: amountBaseUnits.toString(),
          status,
          requiredClaimTopics: preflight.requiredClaimTopics,
          kycProvider: getTrustedProvider(asset, "1"),
          amlProvider: getTrustedProvider(asset, "2"),
          issuerWallet: asset?.issuerAddress || asset?.issuer,
          preflightFailure: preflight.blockers.join("\n"),
          simulationError: preflight.simulation?.error,
        }),
      });
      toast.success("Buy request created.", { id: loadingToast });
      setSelectedListing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create buy request.", {
        id: loadingToast,
      });
    } finally {
      setCreatingIntent(false);
    }
  };

  return (
    <div className="p-8 glass-panel rounded-[22px] space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-[#CBA135]/40 text-[#172E7F]">
            Secondary Market
          </Badge>
          <h1 className="text-3xl font-semibold text-slate-950">Token Listings</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Buyer-driven secondary transfer listings. Buyers complete eligibility first; sellers only sign the final transfer after the buyer is compliant.
          </p>
        </div>
        <Button variant="outline" onClick={loadListings} disabled={loading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <Alert className="border-amber-200 bg-amber-50">
        <AlertTriangle className="h-4 w-4 text-amber-700" />
        <AlertDescription className="text-amber-800">
          Settlement is off-chain in this MVP. FRACKS only verifies eligibility and executes the compliant token transfer; payment agreement and settlement are handled outside the protocol.
        </AlertDescription>
      </Alert>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Open Listings</CardTitle>
          <CardDescription>
            Listing creation and buyer request actions will be added after the transfer simulation foundation is verified.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-red-700">{error}</AlertDescription>
            </Alert>
          ) : loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading listings...</div>
          ) : listings.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">No open listings yet.</div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Token</th>
                    <th className="px-4 py-3 font-semibold">Seller</th>
                    <th className="px-4 py-3 font-semibold">Remaining</th>
                    <th className="px-4 py-3 font-semibold">Price</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {listings.map((listing) => {
                    const asset = assetByToken.get(listing.tokenContract);
                    const decimals = Number(asset?.metadata?.decimals ?? 6);
                    return (
                      <tr key={listing.id}>
                        <td className="px-4 py-4">
                          <div className="font-semibold text-slate-900">
                            {asset ? `${asset.name} (${asset.symbol})` : shortAddress(listing.tokenContract)}
                          </div>
                          <div className="font-mono text-xs text-slate-500">{shortAddress(listing.tokenContract)}</div>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs">{shortAddress(listing.sellerWallet)}</td>
                        <td className="px-4 py-4">{formatTokenAmount(listing.amountRemaining, decimals)}</td>
                        <td className="px-4 py-4">
                          {listing.price != null ? `${listing.price} ${listing.currency || "USD"}` : "Off-chain"}
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant="secondary">{listing.status.replaceAll("_", " ")}</Badge>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <Button
                            size="sm"
                            className="bg-[#172E7F] hover:bg-[#24469E]"
                            onClick={() => openBuyRequest(listing)}
                            disabled={address === listing.sellerWallet}
                          >
                            Request to Buy
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedListing)} onOpenChange={(open) => !open && setSelectedListing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request to Buy</DialogTitle>
            <DialogDescription>
              You will complete eligibility first. The seller signs the final token transfer only after you are approved.
            </DialogDescription>
          </DialogHeader>
          {selectedListing ? (
            <div className="space-y-4">
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">
                  Payment and settlement are off-chain. This request only starts compliance eligibility for the token transfer.
                </AlertDescription>
              </Alert>
              <div>
                <Label>Listing</Label>
                <Input value={shortAddress(selectedListing.id)} disabled className="mt-2 font-mono" />
              </div>
              <div>
                <Label>Seller</Label>
                <Input value={selectedListing.sellerWallet} disabled className="mt-2 font-mono" />
              </div>
              <div>
                <Label htmlFor="buy-amount">Amount to buy</Label>
                <Input
                  id="buy-amount"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={buyAmount}
                  onChange={(event) => setBuyAmount(event.target.value)}
                  className="mt-2"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedListing(null)}>
              Cancel
            </Button>
            <Button onClick={() => void createBuyIntent()} disabled={creatingIntent || !buyAmount}>
              Submit Buy Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
