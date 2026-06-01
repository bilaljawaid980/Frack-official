"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWallet } from "@/hooks/use-wallet";
import { useAssetsContext } from "@/contexts/assets-context";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";
import { parseTokenAmount } from "@/lib/token-utils";
import {
  RefreshCw,
  Wallet,
  TrendingUp,
  Layers,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import {
  TransferService,
  type TransferPreflightResult,
} from "@/services/transfer";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";

interface HoldingRow {
  assetId: string;
  assetName: string;
  symbol: string;
  tokenContract: string;
  tokenPrice: number;
  rawBalance: number;
  balance: number;
  value: number;
}

type TokenTransferRequest = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  fromWallet: string;
  toWallet: string;
  amount?: number;
  status: string;
  preflightFailure?: string | null;
  transferTxHash?: string | null;
  createdAt: string;
};

type TokenBuyIntent = {
  id: string;
  listingId: string;
  assetId?: string | null;
  tokenContract: string;
  sellerWallet: string;
  buyerWallet: string;
  amountBaseUnits: string;
  status: string;
  simulationError?: string | null;
  transferTxHash?: string | null;
  createdAt: string;
};

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

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function solscanTokenUrl(tokenContract: string) {
  return `https://solscan.io/token/${tokenContract}?cluster=devnet`;
}

function formatBaseUnits(rawAmount: string, decimals: number) {
  const raw = Number(rawAmount);
  if (!Number.isFinite(raw)) return 0;
  return raw / 10 ** decimals;
}

export default function InvestorDashboardPage() {
  const params = useParams();
  const { address, trexClient, connectWallet, isConnected } = useWallet();
  const anchorProvider = useAnchorProvider();
  const routeWallet = typeof params?.id === "string" ? params.id : undefined;
  const investorWallet = address || routeWallet || "";

  const { assets, loading: assetsLoading, loadAssets } = useAssetsContext();
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [purchaseRequests, setPurchaseRequests] = useState<TokenPurchaseRequest[]>([]);
  const [transferRequests, setTransferRequests] = useState<TokenTransferRequest[]>([]);
  const [sellerListings, setSellerListings] = useState<TokenSellListing[]>([]);
  const [sellerBuyIntents, setSellerBuyIntents] = useState<TokenBuyIntent[]>([]);
  const [buyerBuyIntents, setBuyerBuyIntents] = useState<TokenBuyIntent[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [listingHolding, setListingHolding] = useState<HoldingRow | null>(null);
  const [listingAmount, setListingAmount] = useState("");
  const [listingPrice, setListingPrice] = useState("");
  const [listingTerms, setListingTerms] = useState("Off-chain settlement between buyer and seller.");
  const [listingExpiry, setListingExpiry] = useState("");
  const [listingAudience, setListingAudience] = useState<"public" | "wallet">("public");
  const [listingTargetBuyer, setListingTargetBuyer] = useState("");
  const [creatingListing, setCreatingListing] = useState(false);
  const [processingListingId, setProcessingListingId] = useState<string | null>(null);
  const [processingBuyIntentId, setProcessingBuyIntentId] = useState<string | null>(null);
  const [deletingPurchaseRequestId, setDeletingPurchaseRequestId] = useState<string | null>(null);
  const [directTransferTokenContract, setDirectTransferTokenContract] = useState("");
  const [directTransferRecipient, setDirectTransferRecipient] = useState("");
  const [directTransferAmount, setDirectTransferAmount] = useState("");
  const [directTransferPreflight, setDirectTransferPreflight] =
    useState<TransferPreflightResult | null>(null);
  const [directTransferChecking, setDirectTransferChecking] = useState(false);
  const [directTransferSending, setDirectTransferSending] = useState(false);

  const isOwnInvestorPage = Boolean(
    address && investorWallet && address === investorWallet,
  );

  useEffect(() => {
    let isActive = true;
    
    const loadRequests = async () => {
      if (!investorWallet) {
        setPurchaseRequests([]);
        return;
      }
      setLoadingRequests(true);
      try {
        const reqs = await apiFetch<TokenPurchaseRequest[]>(`/token-purchase-requests?investorWallet=${investorWallet}`);
        if (isActive) {
          setPurchaseRequests(reqs);
        }
      } catch (err) {
        console.error("Failed to load purchase requests", err);
      } finally {
        if (isActive) setLoadingRequests(false);
      }
    };
    
    loadRequests();
    return () => { isActive = false; };
  }, [investorWallet]);

  useEffect(() => {
    let isActive = true;

    const loadHoldings = async () => {
      if (!trexClient || !investorWallet || assets.length === 0) {
        if (isActive) {
          setHoldings([]);
        }
        return;
      }

      setLoadingHoldings(true);
      try {
        const indexedRows = await Promise.all(
          assets.map(async (asset) => {
            const raw = await trexClient
              .getBalanceForToken(asset.tokenContractAddress, investorWallet)
              .catch(() => "0");
            const rawBalance = Number(raw) || 0;
            const decimals = Number(asset.metadata?.decimals ?? 6);
            const balance = formatBaseUnits(raw, decimals);
            const value = balance * (asset.tokenPrice || 0);
            return {
              assetId: asset.id,
              assetName: asset.name,
              symbol: asset.symbol,
              tokenContract: asset.tokenContractAddress,
              tokenPrice: asset.tokenPrice,
              rawBalance,
              balance,
              value,
            };
          }),
        );
        const rowsByMint = new Map(indexedRows.map((row) => [row.tokenContract, row]));
        const discoveredHoldings = await trexClient
          .getToken2022Holdings(investorWallet)
          .catch(() => []);

        for (const holding of discoveredHoldings) {
          if (rowsByMint.has(holding.mint)) continue;
          const balance = formatBaseUnits(holding.amount, holding.decimals);
          rowsByMint.set(holding.mint, {
            assetId: holding.mint,
            assetName: shortAddress(holding.mint),
            symbol: "TOKEN",
            tokenContract: holding.mint,
            tokenPrice: 0,
            rawBalance: Number(holding.amount) || 0,
            balance,
            value: 0,
          });
        }

        if (isActive) {
          setHoldings(
            Array.from(rowsByMint.values()).filter((row) => row.rawBalance > 0),
          );
        }
      } catch (error) {
        console.error("Failed to load holdings:", error);
        if (isActive) {
          setHoldings([]);
        }
      } finally {
        if (isActive) {
          setLoadingHoldings(false);
        }
      }
    };

    loadHoldings();
    return () => {
      isActive = false;
    };
  }, [trexClient, investorWallet, assets]);

  useEffect(() => {
    if (!investorWallet) return;
    let isActive = true;
    const loadTransferRequests = async () => {
      try {
        const [incoming, outgoing] = await Promise.all([
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({ toWallet: investorWallet }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({ fromWallet: investorWallet }).toString()}`,
          ),
        ]);
        const merged = new Map<string, TokenTransferRequest>();
        [...incoming, ...outgoing].forEach((request) => merged.set(request.id, request));
        if (isActive) setTransferRequests([...merged.values()]);
      } catch {
        if (isActive) setTransferRequests([]);
      }
    };
    void loadTransferRequests();
    return () => {
      isActive = false;
    };
  }, [investorWallet]);

  useEffect(() => {
    if (!investorWallet) return;
    let isActive = true;
    const loadMarketplaceIntents = async () => {
      try {
        const [sellerRows, ready, accepted, buyerRows] = await Promise.all([
          apiFetch<TokenSellListing[]>(
            `/token-listings?${new URLSearchParams({
              sellerWallet: investorWallet,
            }).toString()}`,
          ),
          apiFetch<TokenBuyIntent[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              sellerWallet: investorWallet,
              status: "READY_FOR_SELLER_ACCEPTANCE",
            }).toString()}`,
          ),
          apiFetch<TokenBuyIntent[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              sellerWallet: investorWallet,
              status: "READY_TO_TRANSFER",
            }).toString()}`,
          ),
          apiFetch<TokenBuyIntent[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              buyerWallet: investorWallet,
            }).toString()}`,
          ),
        ]);
        if (isActive) {
          setSellerListings(sellerRows);
          setSellerBuyIntents([...ready, ...accepted]);
          setBuyerBuyIntents(buyerRows);
        }
      } catch {
        if (isActive) {
          setSellerListings([]);
          setSellerBuyIntents([]);
          setBuyerBuyIntents([]);
        }
      }
    };
    void loadMarketplaceIntents();
    return () => {
      isActive = false;
    };
  }, [investorWallet]);

  const getMarketplaceBuyIntentStatus = (preflight: Awaited<ReturnType<TransferService["preflightTransfer"]>>) => {
    const buyer = preflight.recipient;
    if (!buyer.identityExists && buyer.blockers.some((item) => item.includes("FID"))) {
      return "ACTION_REQUIRED_BUYER_FID";
    }
    if (
      preflight.requiredClaimTopics.includes("1") &&
      buyer.blockers.some((item) => item.includes("topic 1"))
    ) {
      return "PENDING_KYC";
    }
    if (
      preflight.requiredClaimTopics.includes("2") &&
      buyer.blockers.some((item) => item.includes("topic 2"))
    ) {
      return "PENDING_AML";
    }
    if (!buyer.identityExists) return "PENDING_ISSUER_WHITELIST";
    if (!buyer.identityActive) return "PENDING_ISSUER_ACTIVATION";
    if (preflight.ok) return "READY_FOR_SELLER_ACCEPTANCE";
    return preflight.status;
  };

  const recheckBuyerIntentEligibility = async (intent: TokenBuyIntent) => {
    if (!anchorProvider || !address || address !== intent.buyerWallet) {
      toast.error("Connect the buyer wallet to recheck eligibility.");
      return;
    }
    setProcessingBuyIntentId(intent.id);
    const loadingToast = toast.loading("Rechecking buyer eligibility...");
    try {
      const asset =
        assetsByRequestKey.get(intent.tokenContract) ||
        (intent.assetId ? assetsByRequestKey.get(intent.assetId) : undefined);
      const decimals = Number(asset?.metadata?.decimals ?? 6);
      const service = new TransferService(anchorProvider.connection, anchorProvider);
      const preflight = await service.preflightTransfer(
        new PublicKey(intent.tokenContract),
        new PublicKey(intent.sellerWallet),
        new PublicKey(intent.buyerWallet),
        BigInt(intent.amountBaseUnits),
        decimals,
      );
      const status = getMarketplaceBuyIntentStatus(preflight);
      const updated = await apiFetch<TokenBuyIntent>(
        `/token-listings/buy-intents/${intent.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            reviewerWallet: address,
            preflightFailure: preflight.blockers.join("\n") || undefined,
            simulationError: preflight.simulation?.error || undefined,
          }),
        },
      );
      setBuyerBuyIntents((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Eligibility rechecked.", { id: loadingToast });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to recheck eligibility.", {
        id: loadingToast,
      });
    } finally {
      setProcessingBuyIntentId(null);
    }
  };

  const acceptAndTransferBuyIntent = async (intent: TokenBuyIntent) => {
    if (!anchorProvider || !address || address !== intent.sellerWallet) {
      toast.error("Connect the seller wallet to accept this request.");
      return;
    }
    setProcessingBuyIntentId(intent.id);
    const loadingToast = toast.loading("Simulating compliant transfer...");
    try {
      const asset = assetsByRequestKey.get(intent.tokenContract) || (intent.assetId ? assetsByRequestKey.get(intent.assetId) : undefined);
      const decimals = Number(asset?.metadata?.decimals ?? 6);
      const amount = BigInt(intent.amountBaseUnits);
      const service = new TransferService(anchorProvider.connection, anchorProvider);
      const simulation = await service.buildAndSimulateTransfer(
        new PublicKey(intent.tokenContract),
        new PublicKey(intent.sellerWallet),
        new PublicKey(intent.buyerWallet),
        amount,
        decimals,
      );
      if (!simulation.success) {
        await apiFetch(`/token-listings/buy-intents/${intent.id}/status`, {
          method: "PATCH",
          body: JSON.stringify({
            status: "TRANSFER_SIMULATION_FAILED",
            reviewerWallet: address,
            simulationError: simulation.error || "Transfer simulation failed.",
          }),
        });
        throw new Error(simulation.error || "Transfer simulation failed.");
      }

      await apiFetch(`/token-listings/buy-intents/${intent.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "READY_TO_TRANSFER", reviewerWallet: address }),
      });
      const result = await service.executeTransfer(
        new PublicKey(intent.tokenContract),
        new PublicKey(intent.sellerWallet),
        new PublicKey(intent.buyerWallet),
        amount,
        decimals,
      );
      if (!result.success) throw new Error(result.error || "Transfer failed.");
      await apiFetch(`/token-listings/buy-intents/${intent.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "TRANSFERRED",
          reviewerWallet: address,
          transferTxHash: result.signature,
        }),
      });
      setSellerBuyIntents((current) => current.filter((item) => item.id !== intent.id));
      setBuyerBuyIntents((current) =>
        current.map((item) =>
          item.id === intent.id
            ? { ...item, status: "TRANSFERRED", transferTxHash: result.signature || null }
            : item,
        ),
      );
      toast.success("Transfer submitted.", {
        id: loadingToast,
        description: <TransactionToastLink signature={result.signature} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to complete transfer.", {
        id: loadingToast,
      });
    } finally {
      setProcessingBuyIntentId(null);
    }
  };

  const totalValue = useMemo(
    () => holdings.reduce((sum, row) => sum + row.value, 0),
    [holdings],
  );
  const totalTokens = useMemo(
    () => holdings.reduce((sum, row) => sum + row.balance, 0),
    [holdings],
  );
  const assetsByRequestKey = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    assetsByRequestKey.set(asset.id, asset);
    assetsByRequestKey.set(asset.tokenContractAddress, asset);
    assetsByRequestKey.set(asset.contractAddress, asset);
  }
  const directTransferHolding = useMemo(
    () =>
      holdings.find((holding) => holding.tokenContract === directTransferTokenContract) ??
      null,
    [directTransferTokenContract, holdings],
  );
  const directTransferAsset = directTransferHolding
    ? assetsByRequestKey.get(directTransferHolding.assetId) ??
      assetsByRequestKey.get(directTransferHolding.tokenContract) ??
      null
    : null;
  const directTransferDecimals = Number(
    directTransferAsset?.metadata?.decimals ?? 6,
  );
  let directTransferAmountBaseUnits = 0n;
  if (directTransferAmount) {
    try {
      directTransferAmountBaseUnits = BigInt(
        parseTokenAmount(directTransferAmount, directTransferDecimals),
      );
    } catch {
      directTransferAmountBaseUnits = 0n;
    }
  }

  useEffect(() => {
    if (!isOwnInvestorPage) return;
    const nextTokenContract =
      holdings.length === 0
        ? ""
        : !directTransferTokenContract ||
            !holdings.some(
              (holding) => holding.tokenContract === directTransferTokenContract,
            )
          ? holdings[0].tokenContract
          : directTransferTokenContract;

    if (nextTokenContract === directTransferTokenContract) return;

    const timeoutId = window.setTimeout(() => {
      setDirectTransferTokenContract(nextTokenContract);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [directTransferTokenContract, holdings, isOwnInvestorPage]);

  const openCreateListing = (holding: HoldingRow) => {
    setListingHolding(holding);
    setListingAmount(String(holding.balance));
    setListingPrice("");
    setListingTerms("Off-chain settlement between buyer and seller.");
    setListingExpiry("");
    setListingAudience("public");
    setListingTargetBuyer("");
  };

  const runDirectTransferPreflight = useCallback(async () => {
    if (!anchorProvider || !address || !isOwnInvestorPage) {
      toast.error("Connect the investor wallet first.");
      return null;
    }
    if (!directTransferHolding) {
      toast.error("Select a token from your holdings.");
      return null;
    }
    if (!directTransferRecipient) {
      toast.error("Enter a recipient wallet.");
      return null;
    }
    if (directTransferAmountBaseUnits <= 0n) {
      toast.error("Enter a valid transfer amount.");
      return null;
    }

    setDirectTransferChecking(true);
    setDirectTransferPreflight(null);
    try {
      const service = new TransferService(
        anchorProvider.connection,
        anchorProvider,
      );
      const result = await service.preflightTransfer(
        new PublicKey(directTransferHolding.tokenContract),
        new PublicKey(address),
        new PublicKey(directTransferRecipient),
        directTransferAmountBaseUnits,
        directTransferDecimals,
      );
      setDirectTransferPreflight(result);
      if (!result.ok) {
        toast.error(result.blockers[0] || "Transfer is not compliant.");
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Transfer preflight failed.";
      toast.error(message);
      return null;
    } finally {
      setDirectTransferChecking(false);
    }
  }, [
    address,
    anchorProvider,
    directTransferAmountBaseUnits,
    directTransferDecimals,
    directTransferHolding,
    directTransferRecipient,
    isOwnInvestorPage,
  ]);

  const sendDirectTransfer = useCallback(async () => {
    if (!anchorProvider || !address || !isOwnInvestorPage) {
      toast.error("Connect the investor wallet first.");
      return;
    }
    if (!directTransferHolding) {
      toast.error("Select a token from your holdings.");
      return;
    }

    const preflight =
      directTransferPreflight &&
      directTransferPreflight.sender.wallet === address &&
      directTransferPreflight.recipient.wallet === directTransferRecipient &&
      directTransferPreflight.sourceAta
        ? directTransferPreflight
        : await runDirectTransferPreflight();

    if (!preflight?.ok) {
      return;
    }

    setDirectTransferSending(true);
    try {
      const service = new TransferService(
        anchorProvider.connection,
        anchorProvider,
      );
      const result = await service.executeTransfer(
        new PublicKey(directTransferHolding.tokenContract),
        new PublicKey(address),
        new PublicKey(directTransferRecipient),
        directTransferAmountBaseUnits,
        directTransferDecimals,
      );
      if (!result.success) {
        throw new Error(result.error || "Transfer failed.");
      }
      await apiFetch("/token-transfer-requests", {
        method: "POST",
        body: JSON.stringify({
          assetId: directTransferHolding.assetId,
          tokenContract: directTransferHolding.tokenContract,
          fromWallet: address,
          toWallet: directTransferRecipient,
          amount: Number(directTransferAmount),
          status: "TRANSFERRED",
          requiredClaimTopics: [],
          transferTxHash: result.signature,
        }),
      }).catch(() => null);
      toast.success("Transfer submitted.", {
        description: <TransactionToastLink signature={result.signature} />,
      });
      setDirectTransferRecipient("");
      setDirectTransferAmount("");
      setDirectTransferPreflight(null);
      await loadAssets();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer failed.");
    } finally {
      setDirectTransferSending(false);
    }
  }, [
    address,
    anchorProvider,
    directTransferAmount,
    directTransferAmountBaseUnits,
    directTransferDecimals,
    directTransferHolding,
    directTransferPreflight,
    directTransferRecipient,
    isOwnInvestorPage,
    loadAssets,
    runDirectTransferPreflight,
  ]);

  const createListing = async () => {
    if (!listingHolding || !anchorProvider || !address || !isOwnInvestorPage) return;
    setCreatingListing(true);
    const loadingToast = toast.loading("Checking transferable balance...");
    try {
      const decimals = 6;
      const amountBaseUnits = BigInt(parseTokenAmount(listingAmount, decimals));
      let targetBuyerWallet: string | undefined;
      if (listingAudience === "wallet") {
        targetBuyerWallet = new PublicKey(listingTargetBuyer.trim()).toBase58();
        if (targetBuyerWallet === address) {
          throw new Error("The reserved buyer wallet must be different from the seller wallet.");
        }
      }
      const service = new TransferService(anchorProvider.connection, anchorProvider);
      const capacity = await service.checkSellerListingCapacity(
        new PublicKey(listingHolding.tokenContract),
        new PublicKey(address),
        amountBaseUnits,
      );
      if (!capacity.ok) {
        throw new Error(capacity.blockers[0] || "Listing amount is not transferable.");
      }

      await apiFetch("/token-listings", {
        method: "POST",
        body: JSON.stringify({
          assetId: listingHolding.assetId,
          tokenContract: listingHolding.tokenContract,
          sellerWallet: address,
          targetBuyerWallet,
          amountBaseUnits: amountBaseUnits.toString(),
          price: listingPrice ? Number(listingPrice) : undefined,
          currency: listingPrice ? "USD" : undefined,
          settlementTerms: listingTerms,
          expiresAt: listingExpiry ? new Date(listingExpiry).toISOString() : undefined,
        }),
      });
      toast.success("Listing created.", { id: loadingToast });
      setListingHolding(null);
      const updatedListings = await apiFetch<TokenSellListing[]>(
        `/token-listings?${new URLSearchParams({ sellerWallet: address }).toString()}`,
      );
      setSellerListings(updatedListings);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create listing.", {
        id: loadingToast,
      });
    } finally {
      setCreatingListing(false);
    }
  };

  const cancelListing = async (listing: TokenSellListing) => {
    if (!address || address !== listing.sellerWallet) {
      toast.error("Connect the seller wallet to cancel this listing.");
      return;
    }
    setProcessingListingId(listing.id);
    try {
      const updated = await apiFetch<TokenSellListing>(`/token-listings/${listing.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED", reason: "Seller cancelled listing." }),
      });
      setSellerListings((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      toast.success("Listing cancelled.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel listing.");
    } finally {
      setProcessingListingId(null);
    }
  };

  const deletePurchaseRequest = async (request: TokenPurchaseRequest) => {
    if (!address || address !== request.investorWallet) {
      toast.error("Connect the investor wallet that created this request.");
      return;
    }

    const confirmed = window.confirm(
      "Delete this token purchase request? This removes it from your dashboard, the claim provider queue, and the issuer minting queue.",
    );
    if (!confirmed) return;

    setDeletingPurchaseRequestId(request.id);
    try {
      await apiFetch<TokenPurchaseRequest>(`/token-purchase-requests/${request.id}`, {
        method: "DELETE",
      });
      setPurchaseRequests((current) =>
        current.filter((item) => item.id !== request.id),
      );
      toast.success("Token purchase request deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete token purchase request.",
      );
    } finally {
      setDeletingPurchaseRequestId(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-8 glass-panel rounded-[22px]">
        <div className="text-center py-12">
          <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Investor Dashboard</h1>
          <p className="text-muted-foreground mb-6">
            Connect your wallet to load portfolio data.
          </p>
          <Button
            onClick={connectWallet}
            size="lg"
            className="bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]"
          >
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 glass-panel rounded-[22px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Investor Portfolio</h1>
            <p className="text-sm text-gray-600">
              Wallet:{" "}
              <span className="font-mono text-xs break-all">
                {investorWallet}
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            loadAssets();
          }}
          disabled={assetsLoading || loadingHoldings}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${
              assetsLoading || loadingHoldings
                ? "animate-spin"
                : ""
            }`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Portfolio Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatCurrency(totalValue)}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated based on token price
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Tokens Held
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {totalTokens.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {holdings.length} assets
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Asset Exposure
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-600" />
            <span className="text-xl font-semibold">{holdings.length}</span>
            <span className="text-xs text-muted-foreground">
              active holdings
            </span>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white rounded-2xl">
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
          <CardDescription>
            Token balances for assets in your wallet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assetsLoading || loadingHoldings ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading portfolio...
            </div>
          ) : holdings.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No token holdings found for this wallet.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Token Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((row) => (
                    <TableRow key={row.tokenContract}>
                      <TableCell className="font-medium">
                        {row.assetName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.symbol}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.balance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(row.tokenPrice || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-blue-600" />
                          {formatCurrency(row.value)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9"
                            onClick={() =>
                              window.open(`/assets/${row.assetId}`, "_self")
                            }
                          >
                            View Asset
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-9 bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]"
                            onClick={() =>
                              window.open(
                                `/transfer?asset=${encodeURIComponent(
                                  row.assetId,
                                )}&symbol=${encodeURIComponent(row.symbol)}`,
                                "_self",
                              )
                            }
                          >
                            Transfer Tokens
                          </Button>
                          {isOwnInvestorPage ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-9"
                              onClick={() => openCreateListing(row)}
                            >
                              Create Listing
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwnInvestorPage ? (
        <Card className="mt-6 rounded-2xl bg-white">
          <CardHeader>
            <CardTitle>Direct Transfer</CardTitle>
            <CardDescription>
              Send tokens directly from your holdings. The app will run token compliance
              preflight first and only submit if both wallets are eligible.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {holdings.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                You need token holdings before you can send a transfer.
              </div>
            ) : (
              <>
                <div className="grid gap-4 lg:grid-cols-[1fr_1fr_180px]">
                  <div className="space-y-2">
                    <Label htmlFor="direct-transfer-token">Token</Label>
                    <Select
                      value={directTransferTokenContract}
                      onValueChange={(value) => {
                        setDirectTransferTokenContract(value);
                        setDirectTransferPreflight(null);
                      }}
                    >
                      <SelectTrigger
                        id="direct-transfer-token"
                        className="bg-white"
                      >
                        <SelectValue placeholder="Select a token from holdings" />
                      </SelectTrigger>
                      <SelectContent>
                        {holdings.map((holding) => (
                          <SelectItem
                            key={holding.tokenContract}
                            value={holding.tokenContract}
                          >
                            {holding.assetName} ({holding.symbol}) ·{" "}
                            {holding.balance.toLocaleString(undefined, {
                              maximumFractionDigits: 6,
                            })}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="direct-transfer-recipient">
                      Recipient wallet
                    </Label>
                    <Input
                      id="direct-transfer-recipient"
                      value={directTransferRecipient}
                      onChange={(event) => {
                        setDirectTransferRecipient(event.target.value.trim());
                        setDirectTransferPreflight(null);
                      }}
                      placeholder="Recipient Solana wallet address"
                      className="bg-white font-mono text-sm"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="direct-transfer-amount">Amount</Label>
                    <Input
                      id="direct-transfer-amount"
                      inputMode="decimal"
                      value={directTransferAmount}
                      onChange={(event) => {
                        setDirectTransferAmount(event.target.value);
                        setDirectTransferPreflight(null);
                      }}
                      placeholder="0.0"
                      className="bg-white"
                    />
                  </div>
                </div>

                {directTransferHolding ? (
                  <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700 md:grid-cols-3">
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Selected token
                      </div>
                      <div className="mt-1 font-medium">
                        {directTransferHolding.assetName} ({directTransferHolding.symbol})
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Wallet balance
                      </div>
                      <div className="mt-1 font-medium">
                        {directTransferHolding.balance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        Token contract
                      </div>
                      <div
                        className="mt-1 truncate font-mono text-xs"
                        title={directTransferHolding.tokenContract}
                      >
                        {directTransferHolding.tokenContract}
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="outline"
                    disabled={directTransferChecking || directTransferSending}
                    onClick={() => void runDirectTransferPreflight()}
                  >
                    {directTransferChecking ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Checking
                      </>
                    ) : (
                      <>
                        <ShieldAlert className="mr-2 h-4 w-4" />
                        Run Compliance Check
                      </>
                    )}
                  </Button>
                  <Button
                    className="bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]"
                    disabled={!directTransferPreflight?.ok || directTransferSending}
                    onClick={() => void sendDirectTransfer()}
                  >
                    {directTransferSending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending
                      </>
                    ) : (
                      <>
                        <Send className="mr-2 h-4 w-4" />
                        Send Tokens
                      </>
                    )}
                  </Button>
                </div>

                {directTransferPreflight ? (
                  <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge
                        variant={directTransferPreflight.ok ? "default" : "secondary"}
                      >
                        {directTransferPreflight.ok
                          ? "Ready to send"
                          : directTransferPreflight.status.replaceAll("_", " ")}
                      </Badge>
                      <span className="text-sm text-slate-600">
                        Source balance:{" "}
                        {directTransferPreflight.sourceBalance.toLocaleString()}
                      </span>
                      <span className="text-sm text-slate-600">
                        Transferable:{" "}
                        {directTransferPreflight.transferableBalance.toLocaleString()}
                      </span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      {[
                        { label: "Sender", side: directTransferPreflight.sender },
                        { label: "Recipient", side: directTransferPreflight.recipient },
                      ].map(({ label, side }) => (
                        <div
                          key={label}
                          className="rounded-lg border border-slate-200 bg-white p-4"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900">
                              {label}
                            </div>
                            <Badge
                              variant={side.blockers.length === 0 ? "default" : "secondary"}
                            >
                              {side.blockers.length === 0 ? "Eligible" : "Blocked"}
                            </Badge>
                          </div>
                          <div className="mt-2 font-mono text-xs text-slate-500">
                            {side.wallet}
                          </div>
                          <div className="mt-3 space-y-2 text-sm text-slate-600">
                            <div>
                              FID: {side.identityExists ? "present" : "missing"}
                            </div>
                            <div>
                              IRS identity: {side.identityActive ? "active" : "inactive"}
                            </div>
                            {side.blockers.length > 0 ? (
                              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
                                {side.blockers[0]}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-emerald-700">
                                <CheckCircle2 className="h-4 w-4" />
                                Identity and claim checks passed
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {directTransferPreflight.simulation &&
                    !directTransferPreflight.simulation.success ? (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm text-orange-950">
                        <div className="font-medium">Transfer hook simulation failed</div>
                        <div className="mt-1">
                          {directTransferPreflight.simulation.error ||
                            "The token's transfer hook rejected the transaction after wallet identity checks passed."}
                        </div>
                        <div className="mt-2 text-orange-900/80">
                          This usually means an issuer-side rule is blocking the transfer,
                          such as max transfer, max investors, lockup, daily limit, country
                          restrictions, or another bound compliance module.
                        </div>
                      </div>
                    ) : null}

                    {directTransferPreflight.blockers.length > 0 ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        {directTransferPreflight.blockers[0]}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-white rounded-2xl mt-6">
        <CardHeader>
          <CardTitle>Token Purchase Requests</CardTitle>
          <CardDescription>
            Your ongoing and historical requests to buy tokens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRequests ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading requests...
            </div>
          ) : purchaseRequests.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No purchase requests found.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token Name</TableHead>
                    <TableHead>Token Contract</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseRequests.map((req) => {
                    const asset =
                      (req.assetId && assetsByRequestKey.get(req.assetId)) ||
                      assetsByRequestKey.get(req.tokenContract);
                    const tokenName = asset
                      ? `${asset.name} (${asset.symbol})`
                      : "Unknown Token";

                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">
                          {tokenName}
                        </TableCell>
                        <TableCell>
                          <a
                            className="inline-flex items-center gap-1 font-mono text-xs text-[#172E7F] underline-offset-4 hover:underline"
                            href={solscanTokenUrl(req.tokenContract)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {shortAddress(req.tokenContract)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>{req.amount}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              req.status === "MINTED" ||
                              req.status === "APPROVED_FOR_MINT"
                                ? "default"
                                : req.status === "REJECTED"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {req.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(req.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={deletingPurchaseRequestId === req.id}
                            onClick={() => void deletePurchaseRequest(req)}
                          >
                            {deletingPurchaseRequestId === req.id ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="mr-2 h-4 w-4" />
                            )}
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwnInvestorPage ? (
        <Card className="bg-white rounded-2xl mt-6">
          <CardHeader>
            <CardTitle>Marketplace Buy Requests</CardTitle>
            <CardDescription>
              Your requests to buy listed tokens from other investors.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {buyerBuyIntents.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No marketplace buy requests found.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead>Seller</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {buyerBuyIntents.map((intent) => {
                      const asset =
                        assetsByRequestKey.get(intent.tokenContract) ||
                        (intent.assetId ? assetsByRequestKey.get(intent.assetId) : undefined);
                      return (
                        <TableRow key={intent.id}>
                          <TableCell className="font-medium">
                            {asset ? `${asset.name} (${asset.symbol})` : shortAddress(intent.tokenContract)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {shortAddress(intent.sellerWallet)}
                          </TableCell>
                          <TableCell>{intent.amountBaseUnits} base units</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{intent.status.replaceAll("_", " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {[
                              "ACTION_REQUIRED_BUYER_FID",
                              "PENDING_KYC",
                              "PENDING_AML",
                              "PENDING_ISSUER_WHITELIST",
                              "PENDING_ISSUER_ACTIVATION",
                              "TRANSFER_SIMULATION_FAILED",
                            ].includes(intent.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={processingBuyIntentId === intent.id}
                                onClick={() => void recheckBuyerIntentEligibility(intent)}
                              >
                                {processingBuyIntentId === intent.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Recheck Eligibility
                              </Button>
                            ) : intent.transferTxHash ? (
                              <a
                                href={`https://solscan.io/tx/${intent.transferTxHash}?cluster=devnet`}
                                rel="noreferrer"
                                target="_blank"
                                className="text-sm text-[#172E7F] underline"
                              >
                                View Tx
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground">Waiting</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {isOwnInvestorPage ? (
        <Card className="bg-white rounded-2xl mt-6">
          <CardHeader>
            <CardTitle>My Marketplace Listings</CardTitle>
            <CardDescription>
              Active and historical secondary-market listings created from this wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sellerListings.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No marketplace listings created yet.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead>Listed</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellerListings.map((listing) => {
                      const asset =
                        assetsByRequestKey.get(listing.tokenContract) ||
                        (listing.assetId ? assetsByRequestKey.get(listing.assetId) : undefined);
                      return (
                        <TableRow key={listing.id}>
                          <TableCell className="font-medium">
                            {asset ? `${asset.name} (${asset.symbol})` : shortAddress(listing.tokenContract)}
                          </TableCell>
                          <TableCell>{listing.amountBaseUnits} base units</TableCell>
                          <TableCell>{listing.amountRemaining} base units</TableCell>
                          <TableCell className="font-mono text-xs">
                            {listing.targetBuyerWallet
                              ? shortAddress(listing.targetBuyerWallet)
                              : "Anybody"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary">{listing.status.replaceAll("_", " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            {["LISTED", "PARTIALLY_FILLED"].includes(listing.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={processingListingId === listing.id}
                                onClick={() => void cancelListing(listing)}
                              >
                                {processingListingId === listing.id ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : null}
                                Cancel
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">Closed</span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {isOwnInvestorPage ? (
        <Card className="bg-white rounded-2xl mt-6">
          <CardHeader>
            <CardTitle>Eligible Buyer Requests</CardTitle>
            <CardDescription>
              Buyers who completed eligibility for your listings. Accepting will simulate and execute the compliant Token-2022 transfer from your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sellerBuyIntents.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No eligible buyer requests awaiting seller action.
              </div>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Token</TableHead>
                      <TableHead>Buyer</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sellerBuyIntents.map((intent) => {
                      const asset =
                        assetsByRequestKey.get(intent.tokenContract) ||
                        (intent.assetId ? assetsByRequestKey.get(intent.assetId) : undefined);
                      return (
                        <TableRow key={intent.id}>
                          <TableCell className="font-medium">
                            {asset ? `${asset.name} (${asset.symbol})` : shortAddress(intent.tokenContract)}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {shortAddress(intent.buyerWallet)}
                          </TableCell>
                          <TableCell>{intent.amountBaseUnits} base units</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{intent.status.replaceAll("_", " ")}</Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              className="bg-[#172E7F] hover:bg-[#24469E]"
                              disabled={processingBuyIntentId === intent.id}
                              onClick={() => void acceptAndTransferBuyIntent(intent)}
                            >
                              {processingBuyIntentId === intent.id ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              ) : null}
                              Accept & Transfer
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={Boolean(listingHolding)} onOpenChange={(open) => !open && setListingHolding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Secondary Market Listing</DialogTitle>
            <DialogDescription>
              List tokens for a buyer-driven secondary transfer. Settlement/payment remains off-chain.
            </DialogDescription>
          </DialogHeader>
          {listingHolding ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                FRACKS verifies eligibility and executes the compliant token transfer only. Buyer payment and settlement terms are handled off-chain between parties.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Token</Label>
                  <Input value={`${listingHolding.assetName} (${listingHolding.symbol})`} disabled className="mt-2" />
                </div>
                <div>
                  <Label>Available balance</Label>
                  <Input value={listingHolding.balance.toString()} disabled className="mt-2" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="listing-audience">Who can request to buy?</Label>
                <Select
                  value={listingAudience}
                  onValueChange={(value: "public" | "wallet") => setListingAudience(value)}
                >
                  <SelectTrigger id="listing-audience" className="mt-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Anybody</SelectItem>
                    <SelectItem value="wallet">Specific wallet address</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {listingAudience === "wallet" ? (
                <div>
                  <Label htmlFor="listing-target-buyer">Buyer wallet address</Label>
                  <Input
                    id="listing-target-buyer"
                    value={listingTargetBuyer}
                    onChange={(event) => setListingTargetBuyer(event.target.value)}
                    placeholder="Enter the wallet allowed to request this listing"
                    className="mt-2 font-mono text-sm"
                  />
                </div>
              ) : null}
              <div>
                <Label htmlFor="listing-amount">Amount to list</Label>
                <Input
                  id="listing-amount"
                  type="number"
                  min="0"
                  step="0.000001"
                  value={listingAmount}
                  onChange={(event) => setListingAmount(event.target.value)}
                  className="mt-2"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="listing-price">Indicative price (USD)</Label>
                  <Input
                    id="listing-price"
                    type="number"
                    min="0"
                    value={listingPrice}
                    onChange={(event) => setListingPrice(event.target.value)}
                    placeholder="Optional"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="listing-expiry">Expiry</Label>
                  <Input
                    id="listing-expiry"
                    type="datetime-local"
                    value={listingExpiry}
                    onChange={(event) => setListingExpiry(event.target.value)}
                    className="mt-2"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="listing-terms">Settlement terms</Label>
                <Textarea
                  id="listing-terms"
                  value={listingTerms}
                  onChange={(event) => setListingTerms(event.target.value)}
                  rows={3}
                  className="mt-2"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setListingHolding(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createListing()}
              disabled={creatingListing || !listingAmount || (listingAudience === "wallet" && !listingTargetBuyer.trim())}
              className="bg-[#172E7F] hover:bg-[#24469E]"
            >
              {creatingListing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create Listing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="bg-white rounded-2xl mt-6">
        <CardHeader>
          <CardTitle>Token Transfer Requests</CardTitle>
          <CardDescription>
            Secondary transfer onboarding and transfer history for this wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transferRequests.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No transfer requests found.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferRequests.map((req) => {
                    const outgoing = req.fromWallet === investorWallet;
                    const counterparty = outgoing ? req.toWallet : req.fromWallet;
                    const asset =
                      (req.assetId && assetsByRequestKey.get(req.assetId)) ||
                      assetsByRequestKey.get(req.tokenContract);
                    return (
                      <TableRow key={req.id}>
                        <TableCell>{outgoing ? "Outgoing" : "Incoming"}</TableCell>
                        <TableCell className="font-medium">
                          {asset ? `${asset.name} (${asset.symbol})` : shortAddress(req.tokenContract)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortAddress(counterparty)}
                        </TableCell>
                        <TableCell>{req.amount ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={req.status === "TRANSFERRED" ? "default" : "secondary"}>
                            {req.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {req.transferTxHash ? (
                            <a
                              className="inline-flex items-center gap-1 text-xs text-[#172E7F] hover:underline"
                              href={`https://solscan.io/tx/${req.transferTxHash}?cluster=devnet`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
