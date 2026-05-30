"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssetsContext } from "@/contexts/assets-context";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import { formatTokenAmount } from "@/lib/token-utils";
import { IdentityService } from "@/services/identity";
import { TransferService, type TransferPreflightResult } from "@/services/transfer";

type TokenSellListing = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  sellerWallet: string;
  targetBuyerWallet?: string | null;
  amountBaseUnits: string;
  amountRemaining: string;
  price?: number | null;
  currency?: string | null;
  status: string;
  settlementTerms?: string | null;
  expiresAt?: string | null;
  createdAt: string;
};

type TrustedIssuer = {
  walletAddress?: string;
  topics?: Array<string | number>;
};

type KycFormData = {
  fullName: string;
  email: string;
  nationality: string;
  country: string;
  idDocumentUrl: string;
  proofOfAddressUrl: string;
};

type ListingsTableProps = {
  address?: string | null;
  assetByToken: Map<string, ReturnType<typeof useAssetsContext>["assets"][number]>;
  emptyText: string;
  listings: TokenSellListing[];
  onRequest: (listing: TokenSellListing) => void;
};

const OPEN_LISTING_STATUSES = new Set(["LISTED", "PARTIALLY_FILLED"]);
const EMPTY_KYC_FORM: KycFormData = {
  fullName: "",
  email: "",
  nationality: "",
  country: "",
  idDocumentUrl: "",
  proofOfAddressUrl: "",
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function isExpired(listing: TokenSellListing) {
  return Boolean(listing.expiresAt && new Date(listing.expiresAt).getTime() <= Date.now());
}

function isOpenListing(listing: TokenSellListing) {
  return OPEN_LISTING_STATUSES.has(listing.status) && !isExpired(listing);
}

function displayStatus(listing: TokenSellListing) {
  if (isExpired(listing) && OPEN_LISTING_STATUSES.has(listing.status)) return "EXPIRED";
  return listing.status;
}

function formatExpiry(value?: string | null) {
  if (!value) return "No expiry";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTrustedProvider(
  asset: { metadata?: { trustedIssuers?: TrustedIssuer[] } } | undefined,
  topic: string,
) {
  const issuers = asset?.metadata?.trustedIssuers || [];
  return issuers.find((issuer) => (issuer.topics || []).map(String).includes(topic))?.walletAddress || null;
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

function getSellerEligibilityError(preflight: TransferPreflightResult) {
  const status = getBuyIntentStatus(preflight);
  if (
    status.startsWith("SELLER_") ||
    status.startsWith("SENDER_") ||
    status === "INSUFFICIENT_TRANSFERABLE_BALANCE"
  ) {
    return preflight.blockers[0] || "Seller is not currently eligible to transfer this amount.";
  }
  return null;
}

function ListingsTable({ address, assetByToken, emptyText, listings, onRequest }: ListingsTableProps) {
  if (listings.length === 0) {
    return <div className="py-12 text-center text-sm text-slate-500">{emptyText}</div>;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Token</th>
            <th className="px-4 py-3 font-semibold">Seller</th>
            <th className="px-4 py-3 font-semibold">Amount</th>
            <th className="px-4 py-3 font-semibold">Price</th>
            <th className="px-4 py-3 font-semibold">Expires</th>
            <th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 text-right font-semibold">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {listings.map((listing) => {
            const asset = assetByToken.get(listing.tokenContract);
            const decimals = Number(asset?.metadata?.decimals ?? 6);
            const open = isOpenListing(listing);
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
                <td className="px-4 py-4 text-slate-600">{formatExpiry(listing.expiresAt)}</td>
                <td className="px-4 py-4">
                  <Badge variant={open ? "secondary" : "outline"} className={open ? "" : "text-slate-500"}>
                    {displayStatus(listing).replaceAll("_", " ")}
                  </Badge>
                </td>
                <td className="px-4 py-4 text-right">
                  <Button
                    size="sm"
                    className="bg-[#172E7F] hover:bg-[#24469E]"
                    onClick={() => onRequest(listing)}
                    disabled={!open || address === listing.sellerWallet}
                  >
                    {open ? "Request to Buy" : "Closed"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function ListingsPage() {
  const { assets } = useAssetsContext();
  const { address, connectWallet } = useWallet();
  const anchorProvider = useAnchorProvider();
  const [listings, setListings] = useState<TokenSellListing[]>([]);
  const [reservedListings, setReservedListings] = useState<TokenSellListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedListing, setSelectedListing] = useState<TokenSellListing | null>(null);
  const [checkingEligibility, setCheckingEligibility] = useState(false);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [buyerFidRegistered, setBuyerFidRegistered] = useState<boolean | null>(null);
  const [fidCountryCode, setFidCountryCode] = useState("840");
  const [registeringFid, setRegisteringFid] = useState(false);
  const [kycForm, setKycForm] = useState<KycFormData>(EMPTY_KYC_FORM);
  const [creatingIntent, setCreatingIntent] = useState(false);

  const assetByToken = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>();
    assets.forEach((asset) => {
      const token = asset.contractAddress || asset.tokenContractAddress;
      if (token) map.set(token, asset);
    });
    return map;
  }, [assets]);

  const loadListings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [marketplaceRows, reservedRows] = await Promise.all([
        apiFetch<TokenSellListing[]>("/token-listings"),
        address
          ? apiFetch<TokenSellListing[]>(
              `/token-listings?${new URLSearchParams({ targetBuyerWallet: address }).toString()}`,
            )
          : Promise.resolve([]),
      ]);
      setListings(marketplaceRows);
      setReservedListings(reservedRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load listings.");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void Promise.resolve().then(loadListings);
  }, [loadListings]);

  const checkBuyerEligibility = useCallback(
    async (listing: TokenSellListing) => {
      if (!address || !anchorProvider) return;
      setCheckingEligibility(true);
      setEligibilityError(null);
      setBuyerFidRegistered(null);
      try {
        if (listing.targetBuyerWallet && listing.targetBuyerWallet !== address) {
          throw new Error("This listing is reserved for another wallet.");
        }
        const wallet = new PublicKey(address);
        const identityService = new IdentityService(anchorProvider);
        const fid = await identityService.fetchFid(wallet);
        if (!fid || fid.isIssuer) {
          setBuyerFidRegistered(false);
          return;
        }
        setBuyerFidRegistered(true);
        setFidCountryCode(String(fid.country));
        setKycForm((current) => ({ ...current, country: String(fid.country) }));

        const asset = assetByToken.get(listing.tokenContract);
        const decimals = Number(asset?.metadata?.decimals ?? 6);
        const service = new TransferService(anchorProvider.connection, anchorProvider);
        const preflight = await service.preflightTransfer(
          new PublicKey(listing.tokenContract),
          new PublicKey(listing.sellerWallet),
          wallet,
          BigInt(listing.amountRemaining),
          decimals,
        );
        setEligibilityError(getSellerEligibilityError(preflight));
      } catch (err) {
        setEligibilityError(err instanceof Error ? err.message : "Failed to check listing compliance.");
      } finally {
        setCheckingEligibility(false);
      }
    },
    [address, anchorProvider, assetByToken],
  );

  useEffect(() => {
    if (selectedListing && address && anchorProvider) {
      const timeout = window.setTimeout(() => {
        void checkBuyerEligibility(selectedListing);
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, [address, anchorProvider, checkBuyerEligibility, selectedListing]);

  const openBuyRequest = (listing: TokenSellListing) => {
    if (!isOpenListing(listing)) {
      toast.error("This listing is expired or closed.");
      return;
    }
    setSelectedListing(listing);
    setEligibilityError(null);
    setBuyerFidRegistered(null);
    setKycForm(EMPTY_KYC_FORM);
  };

  const handleCreateInvestorFid = async () => {
    if (!selectedListing || !anchorProvider || !address) {
      toast.error("Connect the investor wallet before creating a FID.");
      return;
    }
    const countryCode = Number(fidCountryCode);
    if (!Number.isInteger(countryCode) || countryCode < 1 || countryCode > 999) {
      toast.error("Enter a valid numeric country code between 1 and 999.");
      return;
    }

    setRegisteringFid(true);
    const loadingToast = toast.loading("Creating investor FID...");
    try {
      await new IdentityService(anchorProvider).ensureOwnFid(countryCode, false);
      toast.success("Investor FID created.", { id: loadingToast });
      await checkBuyerEligibility(selectedListing);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create investor FID.", { id: loadingToast });
    } finally {
      setRegisteringFid(false);
    }
  };

  const createBuyIntent = async () => {
    if (!selectedListing || !address || !anchorProvider || !buyerFidRegistered) return;
    setCreatingIntent(true);
    const loadingToast = toast.loading("Checking buyer eligibility...");
    try {
      const asset = assetByToken.get(selectedListing.tokenContract);
      const decimals = Number(asset?.metadata?.decimals ?? 6);
      const amountBaseUnits = BigInt(selectedListing.amountRemaining);
      const service = new TransferService(anchorProvider.connection, anchorProvider);
      const preflight = await service.preflightTransfer(
        new PublicKey(selectedListing.tokenContract),
        new PublicKey(selectedListing.sellerWallet),
        new PublicKey(address),
        amountBaseUnits,
        decimals,
      );
      const sellerError = getSellerEligibilityError(preflight);
      if (sellerError) throw new Error(sellerError);

      await apiFetch(`/token-listings/${selectedListing.id}/buy-intents`, {
        method: "POST",
        body: JSON.stringify({
          buyerWallet: address,
          amountBaseUnits: amountBaseUnits.toString(),
          ...kycForm,
          status: getBuyIntentStatus(preflight),
          requiredClaimTopics: preflight.requiredClaimTopics,
          kycProvider: getTrustedProvider(asset, "1"),
          amlProvider: getTrustedProvider(asset, "2"),
          issuerWallet: asset?.issuerAddress || asset?.issuer,
          preflightFailure: preflight.blockers.join("\n"),
          simulationError: preflight.simulation?.error,
        }),
      });
      toast.success("Buy request sent to the compliance provider.", { id: loadingToast });
      setSelectedListing(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create buy request.", { id: loadingToast });
    } finally {
      setCreatingIntent(false);
    }
  };

  const updateKycField = (field: keyof KycFormData, value: string) => {
    setKycForm((current) => ({ ...current, [field]: value }));
  };

  return (
    <div className="space-y-6 rounded-[22px] p-8 glass-panel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <Badge variant="outline" className="mb-3 border-[#CBA135]/40 text-[#172E7F]">
            Secondary Market
          </Badge>
          <h1 className="text-3xl font-semibold text-slate-950">Token Listings</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Browse public listings and token offers reserved for your connected wallet.
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
          Settlement is off-chain in this MVP. FRACKS verifies eligibility and executes the compliant token transfer.
        </AlertDescription>
      </Alert>

      {error ? (
        <Alert className="border-red-200 bg-red-50">
          <AlertDescription className="text-red-700">{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Listings for you</CardTitle>
          <CardDescription>
            {address
              ? `${reservedListings.filter(isOpenListing).length} wallet-reserved listings available.`
              : "Connect your wallet to see listings reserved for your address."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading listings...</div>
          ) : (
            <ListingsTable
              address={address}
              assetByToken={assetByToken}
              emptyText={address ? "No listings are reserved for your wallet." : "Connect your wallet to load reserved listings."}
              listings={reservedListings}
              onRequest={openBuyRequest}
            />
          )}
        </CardContent>
      </Card>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Marketplace Listings</CardTitle>
          <CardDescription>
            {listings.filter(isOpenListing).length} active of {listings.length} public listings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading listings...</div>
          ) : (
            <ListingsTable
              address={address}
              assetByToken={assetByToken}
              emptyText="No marketplace listings yet."
              listings={listings}
              onRequest={openBuyRequest}
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedListing)} onOpenChange={(open) => !open && setSelectedListing(null)}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request to Buy</DialogTitle>
            <DialogDescription>
              Compliance is checked before your fixed-amount request is sent to the appointed provider.
            </DialogDescription>
          </DialogHeader>

          {!address ? (
            <div className="space-y-4 py-4 text-center">
              <ShieldCheck className="mx-auto h-10 w-10 text-[#172E7F]" />
              <p className="text-sm text-slate-600">Connect your buyer wallet to run the compliance check.</p>
              <Button onClick={() => void connectWallet()}>Connect Wallet</Button>
            </div>
          ) : checkingEligibility ? (
            <div className="flex items-center justify-center gap-3 py-10 text-sm text-slate-600">
              <Loader2 className="h-5 w-5 animate-spin" />
              Checking wallet FID and listing compliance...
            </div>
          ) : buyerFidRegistered === false ? (
            <div className="space-y-4">
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-800">
                  Create an investor FID before requesting tokens from this listing.
                </AlertDescription>
              </Alert>
              <div className="space-y-2">
                <Label htmlFor="listing-fid-country-code">Investor country code</Label>
                <Input
                  id="listing-fid-country-code"
                  value={fidCountryCode}
                  onChange={(event) => setFidCountryCode(event.target.value.replace(/\D/g, "").slice(0, 3))}
                  inputMode="numeric"
                  placeholder="840"
                />
              </div>
              <Button disabled={registeringFid} onClick={() => void handleCreateInvestorFid()}>
                {registeringFid ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Investor FID
              </Button>
            </div>
          ) : eligibilityError ? (
            <Alert className="border-red-200 bg-red-50">
              <AlertDescription className="text-red-700">{eligibilityError}</AlertDescription>
            </Alert>
          ) : selectedListing && buyerFidRegistered ? (
            <form
              className="space-y-5"
              onSubmit={(event) => {
                event.preventDefault();
                void createBuyIntent();
              }}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Seller</Label>
                  <Input value={selectedListing.sellerWallet} disabled className="mt-2 font-mono" />
                </div>
                <div>
                  <Label>Amount to buy</Label>
                  <Input
                    value={formatTokenAmount(
                      selectedListing.amountRemaining,
                      Number(assetByToken.get(selectedListing.tokenContract)?.metadata?.decimals ?? 6),
                    )}
                    disabled
                    className="mt-2"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t border-slate-200 pt-5">
                <div>
                  <h3 className="font-semibold text-slate-900">KYC information</h3>
                  <p className="text-sm text-slate-600">These details are sent to the appointed KYC provider for review.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="listing-full-name">Full legal name</Label>
                    <Input id="listing-full-name" required value={kycForm.fullName} onChange={(e) => updateKycField("fullName", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="listing-email">Email address</Label>
                    <Input id="listing-email" type="email" required value={kycForm.email} onChange={(e) => updateKycField("email", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="listing-nationality">Nationality</Label>
                    <Input id="listing-nationality" required placeholder="e.g. US" value={kycForm.nationality} onChange={(e) => updateKycField("nationality", e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="listing-country">FID country code</Label>
                    <Input id="listing-country" disabled value={kycForm.country} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="listing-id-document">ID document URL</Label>
                    <Input id="listing-id-document" required value={kycForm.idDocumentUrl} onChange={(e) => updateKycField("idDocumentUrl", e.target.value)} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="listing-proof-address">Proof of address URL</Label>
                    <Input id="listing-proof-address" required value={kycForm.proofOfAddressUrl} onChange={(e) => updateKycField("proofOfAddressUrl", e.target.value)} />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setSelectedListing(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creatingIntent}>
                  {creatingIntent ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Submit Buy Request
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
