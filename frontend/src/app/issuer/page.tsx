"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/hooks/use-wallet";
import { useConnection, useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { createAnchorProvider } from "@/lib/anchor";
import { IdentityService } from "@/services/identity";
import { useActiveTokenHolders } from "@/hooks/useBalance";
import {
  useBurnTokens,
  useFreezeWallet,
  useMintTokens,
  useUnfreezeWallet,
} from "@/hooks/useTokenActions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";
import {
  recordBlockchainTransaction,
  recordBlockchainTransactionWithSolBalanceImpact,
  recordBlockchainTransactionSafely,
} from "@/lib/blockchain-transactions";
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
  underlyingValue: number | null;
  createdAt: string;
};

type TokenTransferRequest = {
  id: string;
  listingId?: string;
  assetId?: string | null;
  tokenContract: string;
  fromWallet: string;
  sellerWallet?: string;
  toWallet?: string;
  buyerWallet?: string;
  amount?: number;
  amountBaseUnits?: string;
  status: string;
  issuerWallet?: string | null;
  requiredClaimTopics: string[];
  source?: "direct" | "listing";
};

type WalletIdentityQueueState = {
  exists: boolean;
  isActive: boolean;
  loading: boolean;
  canRegister: boolean;
  canActivate: boolean;
  canRepairRegistry: boolean;
  irsOwner?: string | null;
  irpOwner?: string | null;
  agents?: string[];
};

const RECOVERY_TOOLS_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_RECOVERY_TOOLS === "true";

function transferRequestStatusEndpoint(request: TokenTransferRequest) {
  return request.source === "listing"
    ? `/token-listings/buy-intents/${request.id}/status`
    : `/token-transfer-requests/${request.id}/status`;
}

function transferRecipientWallet(request: TokenTransferRequest) {
  const wallet = request.toWallet || request.buyerWallet;
  if (!wallet) throw new Error("Recipient wallet is missing.");
  return wallet;
}

function hasNonZeroBalance(balance: string) {
  try {
    return BigInt(balance) > BigInt(0);
  } catch {
    return Number(balance) > 0;
  }
}

function formatHolderAmount(amount: bigint, decimals: number) {
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = amount % scale;
  if (decimals === 0 || fraction === BigInt(0)) return whole.toLocaleString();
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toLocaleString()}.${fractionText}`;
}

function parseTokenAmountInput(value: string, decimals: number) {
  const raw = value.trim();
  if (!/^\d+(\.\d+)?$/.test(raw)) {
    throw new Error("Enter a valid burn amount.");
  }

  const [wholePart, fractionPart = ""] = raw.split(".");
  if (fractionPart.length > decimals) {
    throw new Error(`This token supports up to ${decimals} decimal places.`);
  }

  const scale = BigInt(10) ** BigInt(decimals);
  const whole = BigInt(wholePart || "0") * scale;
  const fractionText = fractionPart.padEnd(decimals, "0");
  const fraction = fractionText ? BigInt(fractionText) : BigInt(0);
  const amount = whole + fraction;

  if (amount <= BigInt(0)) {
    throw new Error("Burn amount must be greater than zero.");
  }

  return amount;
}

function formatOptionalCurrency(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `$${value.toLocaleString()}`
    : "Pending admin review";
}

function IssuerAssetHoldersTable({
  tokenContract,
  assetId,
  issuerWallet,
  tokenSymbol,
  fallbackBalances,
  loadingFallback,
}: {
  tokenContract: string;
  assetId?: string | number | null;
  issuerWallet?: string | null;
  tokenSymbol?: string;
  fallbackBalances: IndexedBalance[];
  loadingFallback: boolean;
}) {
  const burnTokens = useBurnTokens();
  const freezeWallet = useFreezeWallet();
  const unfreezeWallet = useUnfreezeWallet();
  const [burnAmounts, setBurnAmounts] = useState<Record<string, string>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const { connection } = useConnection();
  const mint = useMemo(() => {
    try {
      return new PublicKey(tokenContract);
    } catch {
      return null;
    }
  }, [tokenContract]);
  const holdersQuery = useActiveTokenHolders(mint, null);
  const liveHolders = useMemo(
    () => holdersQuery.data ?? [],
    [holdersQuery.data],
  );
  const fallbackHolders = useMemo(
    () =>
      fallbackBalances.filter((entry) => hasNonZeroBalance(entry.balance)),
    [fallbackBalances],
  );
  const isLoading = holdersQuery.isLoading || loadingFallback;
  const fallbackDecimals = liveHolders[0]?.decimals ?? 0;

  const holderRows = useMemo(() => {
    if (liveHolders.length > 0) {
      return liveHolders.map((holder) => ({
        wallet: holder.wallet,
        investorLabel:
          holder.identityStatus === "active" ? "Active investor" : "Investor",
        balanceText: formatHolderAmount(holder.amount, holder.decimals),
        balanceBaseUnits: holder.amount,
        decimals: holder.decimals,
      }));
    }

    return fallbackHolders.map((holder) => {
      let balanceBaseUnits: bigint | null = null;
      try {
        balanceBaseUnits = BigInt(holder.balance);
      } catch {
        balanceBaseUnits = null;
      }

      return {
        wallet: holder.walletAddress,
        investorLabel: "Indexed investor",
        balanceText:
          balanceBaseUnits !== null
            ? formatHolderAmount(balanceBaseUnits, fallbackDecimals)
            : holder.balance,
        balanceBaseUnits,
        decimals: fallbackDecimals,
      };
    });
  }, [fallbackDecimals, fallbackHolders, liveHolders]);

  const recordHolderAction = async ({
    signature,
    actionType,
    wallet,
    amount,
    displayAmount,
  }: {
    signature: string;
    actionType: string;
    wallet: string;
    amount?: bigint;
    displayAmount?: string;
  }) => {
    const input = {
      txHash: signature,
      actionType,
      actorWallet: issuerWallet ?? undefined,
      entityType: "token_holder",
      entityId: wallet,
      assetId:
        assetId === null || assetId === undefined ? undefined : String(assetId),
      tokenContract,
      metadata: {
        holderWallet: wallet,
        tokenSymbol,
        amount: amount?.toString(),
        displayAmount,
      },
    };

    if (issuerWallet) {
      await recordBlockchainTransactionWithSolBalanceImpact(
        input,
        connection,
        issuerWallet,
      );
      return;
    }

    await recordBlockchainTransaction(input);
  };

  const handleBurn = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    const displayAmount = burnAmounts[holder.wallet]?.trim() ?? "";
    try {
      const amount = parseTokenAmountInput(displayAmount, holder.decimals);
      if (
        holder.balanceBaseUnits !== null &&
        amount > holder.balanceBaseUnits
      ) {
        toast.error("Burn amount exceeds the holder balance.");
        return;
      }

      setBusyAction(`burn:${holder.wallet}`);
      const signature = await burnTokens.mutateAsync({
        mint,
        from: new PublicKey(holder.wallet),
        amount,
      });

      try {
        await recordHolderAction({
          signature,
          actionType: "TOKENS_BURNED",
          wallet: holder.wallet,
          amount,
          displayAmount,
        });
      } catch {
        toast.error("Burn succeeded, but failed to save the transaction hash.");
      }
      setBurnAmounts((current) => ({ ...current, [holder.wallet]: "" }));
      await holdersQuery.refetch();
      toast.success("Tokens burned", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to burn tokens");
    } finally {
      setBusyAction(null);
    }
  };

  const handleFreeze = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    try {
      setBusyAction(`freeze:${holder.wallet}`);
      const signature = await freezeWallet.mutateAsync({
        mint,
        wallet: new PublicKey(holder.wallet),
      });
      try {
        await recordHolderAction({
          signature,
          actionType: "WALLET_FROZEN",
          wallet: holder.wallet,
        });
      } catch {
        toast.error("Freeze succeeded, but failed to save the transaction hash.");
      }
      await holdersQuery.refetch();
      toast.success("Wallet frozen", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to freeze wallet");
    } finally {
      setBusyAction(null);
    }
  };

  const handleUnfreeze = async (holder: (typeof holderRows)[number]) => {
    if (!mint) {
      toast.error("Invalid token mint.");
      return;
    }

    try {
      setBusyAction(`unfreeze:${holder.wallet}`);
      const signature = await unfreezeWallet.mutateAsync({
        mint,
        wallet: new PublicKey(holder.wallet),
      });
      try {
        await recordHolderAction({
          signature,
          actionType: "WALLET_UNFROZEN",
          wallet: holder.wallet,
        });
      } catch {
        toast.error(
          "Unfreeze succeeded, but failed to save the transaction hash.",
        );
      }
      await holdersQuery.refetch();
      toast.success("Wallet unfrozen", {
        description: <TransactionToastLink signature={signature} />,
      });
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to unfreeze wallet",
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">
        Burn, Freeze, and Unfreeze are issuer wallet transactions. Freeze creates
        a refundable freeze-state account, Unfreeze closes it and returns the
        rent, and Burn normally only pays the network fee.
      </div>
      <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Investor</TableHead>
          <TableHead>Wallet</TableHead>
          <TableHead className="text-right">Balance</TableHead>
          <TableHead className="text-right">Controls</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {holderRows.length > 0 ? (
          holderRows.map((holder) => (
            <TableRow key={holder.wallet}>
              <TableCell>{holder.investorLabel}</TableCell>
              <TableCell className="font-mono text-xs">
                {holder.wallet}
              </TableCell>
              <TableCell className="text-right font-medium">
                {holder.balanceText}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Input
                    className="h-9 w-28"
                    inputMode="decimal"
                    min="0"
                    placeholder="Amount"
                    value={burnAmounts[holder.wallet] ?? ""}
                    onChange={(event) =>
                      setBurnAmounts((current) => ({
                        ...current,
                        [holder.wallet]: event.target.value,
                      }))
                    }
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={
                      busyAction !== null || burnTokens.isPending || !mint
                    }
                    onClick={() => handleBurn(holder)}
                  >
                    Burn
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyAction !== null || freezeWallet.isPending || !mint
                    }
                    onClick={() => handleFreeze(holder)}
                  >
                    Freeze
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busyAction !== null || unfreezeWallet.isPending || !mint
                    }
                    onClick={() => handleUnfreeze(holder)}
                  >
                    Unfreeze
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))
        ) : (
          <TableRow>
            <TableCell colSpan={4} className="text-sm text-slate-500">
              {isLoading
                ? "Loading holders..."
                : "No current token holders found for this asset."}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
      </Table>
    </div>
  );
}

export default function IssuerPage() {
  const { address: walletAddress } = useWallet();
  const mintTokens = useMintTokens();
  const { publicKey, signTransaction, signAllTransactions } = useSolanaWallet();
  const { connection } = useConnection();
  const [assets, setAssets] = useState<IndexedAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, IndexedBalance[]>>(
    {},
  );
  const [assetRequests, setAssetRequests] = useState<AssetRequest[]>([]);
  const [purchaseRequests, setPurchaseRequests] = useState<TokenPurchaseRequest[]>([]);
  const [transferRequests, setTransferRequests] = useState<TokenTransferRequest[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [walletIdentityMap, setWalletIdentityMap] = useState<
    Record<string, WalletIdentityQueueState>
  >({});

  const identityService = useMemo(() => {
    if (!publicKey || !signTransaction || !signAllTransactions) return null;
    try {
      const provider = createAnchorProvider(connection, {
        publicKey,
        signTransaction,
        signAllTransactions,
      });
      return new IdentityService(provider);
    } catch {
      return null;
    }
  }, [connection, publicKey, signTransaction, signAllTransactions]);

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
        const configuredPlatformOwner =
          process.env.NEXT_PUBLIC_PLATFORM_OWNER?.toLowerCase();
        const isPlatformOwner =
          RECOVERY_TOOLS_ENABLED &&
          configuredPlatformOwner &&
          walletAddress.toLowerCase() === configuredPlatformOwner;
        const params = new URLSearchParams(
          isPlatformOwner ? {} : { issuerWallet: walletAddress },
        );
        const requests = await apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests${params.size ? `?${params.toString()}` : ""}`,
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
    if (!walletAddress) {
      const timeout = window.setTimeout(() => setTransferRequests([]), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      try {
        const [whitelist, activation, listingWhitelist, listingActivation] = await Promise.all([
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_WHITELIST",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_ACTIVATION",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_WHITELIST",
            }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-listings/buy-intents?${new URLSearchParams({
              issuerWallet: walletAddress,
              status: "PENDING_ISSUER_ACTIVATION",
            }).toString()}`,
          ),
        ]);
        if (!cancelled) {
          setTransferRequests([
            ...whitelist.map((request) => ({ ...request, source: "direct" as const })),
            ...activation.map((request) => ({ ...request, source: "direct" as const })),
            ...listingWhitelist.map((request) => ({
              ...request,
              source: "listing" as const,
              fromWallet: request.fromWallet || request.sellerWallet || "",
              toWallet: request.toWallet || request.buyerWallet,
            })),
            ...listingActivation.map((request) => ({
              ...request,
              source: "listing" as const,
              fromWallet: request.fromWallet || request.sellerWallet || "",
              toWallet: request.toWallet || request.buyerWallet,
            })),
          ]);
        }
      } catch {
        if (!cancelled) setTransferRequests([]);
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

  const issuerPurchaseQueue = useMemo(
    () =>
      purchaseRequests.filter((request) =>
        ["PENDING_ISSUER_REVIEW", "APPROVED_FOR_MINT"].includes(request.status),
      ),
    [purchaseRequests],
  );

  // Load wallet identity status for queued purchase requests
  useEffect(() => {
    let cancelled = false;
    if (!identityService) return;
    const load = async () => {
      const next: Record<string, WalletIdentityQueueState> = {};
      await Promise.all(
        issuerPurchaseQueue.map(async (request) => {
          const key = `${request.tokenContract}:${request.investorWallet}`;
          next[key] = {
            loading: true,
            exists: false,
            isActive: false,
            canRegister: false,
            canActivate: false,
            canRepairRegistry: false,
          };
          try {
            const mint = new PublicKey(request.tokenContract);
            const wallet = new PublicKey(request.investorWallet);
            const identity = await identityService.fetchWalletIdentity(mint, wallet);
            const irpState = await identityService.fetchIrpState(mint);
            const irsOwner = await identityService.fetchIrsOwner(mint);
            const targetIssuerLc = request.issuerWallet?.toLowerCase() ?? null;
            const providerKey = identityService['provider'].wallet.publicKey.toBase58();
            // Normalize to lower-case base58 strings for reliable comparison
            const providerKeyLc = providerKey.toLowerCase();
            const agentsLc = (irpState.agents || []).map((a: string) => a.toLowerCase());
            const irpOwnerLc = irpState.owner.toLowerCase();
            const irsOwnerLc = irsOwner ? irsOwner.toLowerCase() : null;
            const isAgent = agentsLc.includes(providerKeyLc);
            const isIrsOwner = irsOwnerLc ? irsOwnerLc === providerKeyLc : false;
            const canRepairRegistry =
              RECOVERY_TOOLS_ENABLED &&
              providerKeyLc === irpOwnerLc &&
              Boolean(targetIssuerLc) &&
              irpOwnerLc !== targetIssuerLc &&
              irsOwnerLc === targetIssuerLc;
            next[key] = {
              loading: false,
              exists: Boolean(identity),
              isActive: Boolean(identity?.isActive),
              canRegister: Boolean(isAgent || isIrsOwner),
              canActivate: Boolean(isIrsOwner),
              canRepairRegistry,
              irsOwner: irsOwnerLc,
              irpOwner: irpOwnerLc,
              agents: agentsLc,
            };
          } catch {
            next[key] = {
              loading: false,
              exists: false,
              isActive: false,
              canRegister: false,
              canActivate: false,
              canRepairRegistry: false,
            };
          }
        }),
      );
      if (!cancelled) setWalletIdentityMap((cur) => ({ ...cur, ...next }));
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [issuerPurchaseQueue, identityService]);

  const visibleRequests = useMemo(() => {
    if (!walletAddress) return [];
    return assetRequests.filter(
      (request) =>
        request.issuerWallet.toLowerCase() === walletAddress.toLowerCase(),
    );
  }, [assetRequests, walletAddress]);

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
      const key = `${request.tokenContract}:${request.investorWallet}`;
      const ident = walletIdentityMap[key];
      if (!ident || !ident.exists) {
        toast.error("Investor wallet is not whitelisted for this token's IRS. Register before minting.");
        return;
      }
      if (!ident.isActive) {
        toast.error("Investor identity is pending activation. Activate before minting.");
        return;
      }
      const baseAmount = BigInt(Math.round(Number(request.amount) * 1_000_000));
      const sig = await mintTokens.mutateAsync({
        mint: new PublicKey(request.tokenContract),
        recipient: new PublicKey(request.investorWallet),
        amount: baseAmount,
      });
      await updatePurchaseRequestStatus(request, "MINTED", { mintTxHash: sig });
      toast.success("Tokens minted to investor wallet", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mint failed";
      if (
        message.includes("invalid issuer FID profile or signer key mismatch") ||
        message.includes("old issuer FID signer key")
      ) {
        try {
          await updatePurchaseRequestStatus(request, "PENDING_KYC");
          toast.error(
            "The existing KYC claim was signed with an old provider signer key. Request sent back to KYC so the provider can revoke and reissue the claim.",
          );
          return;
        } catch {
          toast.error(
            `${message}\n\nSend this request back to KYC, then have the KYC provider approve it again so the stale claim is revoked and reissued.`,
          );
          return;
        }
      }
      toast.error(message);
    }
  };

  const handleRepairRegistryOwnership = async (request: TokenPurchaseRequest) => {
    try {
      if (!identityService) {
        toast.error("Connect the current IRP owner wallet to repair registry ownership.");
        return;
      }

      const mint = new PublicKey(request.tokenContract);
      if (!request.issuerWallet) {
        throw new Error("Cannot repair registry ownership because this request has no issuer wallet.");
      }
      const issuerWallet = request.issuerWallet;
      const issuer = new PublicKey(issuerWallet);
      const sig = await identityService.transferIrpOwnership(mint, issuer);
      recordBlockchainTransactionSafely({
        txHash: sig,
        actionType: "IRP_OWNERSHIP_REPAIRED",
        actorWallet: walletAddress,
        entityType: "token_purchase_request",
        entityId: request.id,
        assetId: request.assetId,
        tokenContract: request.tokenContract,
      });
      const key = `${request.tokenContract}:${request.investorWallet}`;
      setWalletIdentityMap((current) => ({
        ...current,
        [key]: {
          ...current[key],
          irpOwner: issuerWallet.toLowerCase(),
          canRepairRegistry: false,
          canRegister: true,
          canActivate: true,
        },
      }));
      toast.success("IRP ownership repaired.", {
        description: <TransactionToastLink signature={sig} />,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Registry repair failed");
    }
  };

  const handleWhitelistTransferRecipient = async (request: TokenTransferRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const mint = new PublicKey(request.tokenContract);
      const wallet = new PublicKey(transferRecipientWallet(request));
      const existingIdentity = await identityService.fetchWalletIdentity(mint, wallet);
      let whitelistTxHash: string | undefined;
      if (!existingIdentity) {
        const investorFid = identityService.findFidPda(wallet)[0];
        const fidAccount = await identityService.fetchFid(wallet);
        if (!fidAccount) throw new Error("Recipient must register a FID before whitelisting.");
        if (fidAccount.isIssuer) throw new Error("Recipient FID is marked as issuer. Use an investor FID wallet.");
        if (fidAccount.country < 1 || fidAccount.country > 999) {
          throw new Error(`Recipient FID has invalid country code ${fidAccount.country}.`);
        }
        whitelistTxHash = await identityService.registerIdentity(
          mint,
          wallet,
          investorFid,
          fidAccount.country,
        );
      }
      await apiFetch(transferRequestStatusEndpoint(request), {
        method: "PATCH",
        body: JSON.stringify({
          status: "PENDING_ISSUER_ACTIVATION",
          reviewerWallet: walletAddress,
          whitelistTxHash,
        }),
      });
      setTransferRequests((current) =>
        current.map((item) =>
          item.id === request.id ? { ...item, status: "PENDING_ISSUER_ACTIVATION" } : item,
        ),
      );
      toast.success("Transfer recipient whitelisted. Activate next.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Recipient whitelist failed.";
      if (message.includes("WalletAlreadyRegistered") || message.includes("Wallet is already registered")) {
        await apiFetch(transferRequestStatusEndpoint(request), {
          method: "PATCH",
          body: JSON.stringify({
            status: "PENDING_ISSUER_ACTIVATION",
            reviewerWallet: walletAddress,
          }),
        });
        setTransferRequests((current) =>
          current.map((item) =>
            item.id === request.id ? { ...item, status: "PENDING_ISSUER_ACTIVATION" } : item,
          ),
        );
        toast.success("Transfer recipient already whitelisted. Activate next.");
        return;
      }
      toast.error(message);
    }
  };

  const handleActivateTransferRecipient = async (request: TokenTransferRequest) => {
    try {
      if (!identityService) throw new Error("Connect issuer wallet first.");
      const activationTxHash = await identityService.setIdentityActivation(
        new PublicKey(request.tokenContract),
        new PublicKey(transferRecipientWallet(request)),
        true,
      );
      await apiFetch(transferRequestStatusEndpoint(request), {
        method: "PATCH",
        body: JSON.stringify({
          status: request.source === "listing" ? "READY_FOR_SELLER_ACCEPTANCE" : "READY_TO_TRANSFER",
          reviewerWallet: walletAddress,
          activationTxHash,
        }),
      });
      setTransferRequests((current) => current.filter((item) => item.id !== request.id));
      toast.success(
        request.source === "listing"
          ? "Buyer activated. Seller can now accept the listing request."
          : "Transfer recipient activated. Investor A can now send the transfer.",
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Recipient activation failed.");
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
                      {request.assetType.replace("-", " ")} ·{" "}
                      {formatOptionalCurrency(request.underlyingValue)}
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
                        {RECOVERY_TOOLS_ENABLED && (() => {
                          const key = `${request.tokenContract}:${request.investorWallet}`;
                          const info = walletIdentityMap[key];
                          if (!info) return null;
                          return (
                            <div className="mt-2 text-xs text-slate-400">
                              <div>IRS Owner: {info.irsOwner ?? "(unknown)"}</div>
                              <div>IRP Owner: {info.irpOwner ?? "(unknown)"}</div>
                              <div>IRP Agents: {info.agents && info.agents.length ? info.agents.join(", ") : "(none)"}</div>
                              <div>Whitelisted: {info.exists ? "yes" : "no"} - Active: {info.isActive ? "yes" : "no"}</div>
                              <div>Can Register: {info.canRegister ? "yes" : "no"} - Can Activate: {info.canActivate ? "yes" : "no"}</div>
                            </div>
                          );
                        })()}
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

                        {/* Identity state/key for this request */}
                        {(() => {
                          const key = `${request.tokenContract}:${request.investorWallet}`;
                          const info = walletIdentityMap[key];

                          if (!info) {
                            return (
                              <Button disabled>
                                Checking identity...
                              </Button>
                            );
                          }

                          if (
                            info.irpOwner &&
                            info.irsOwner &&
                            info.irpOwner !== info.irsOwner
                          ) {
                            return (
                              <>
                                <div className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                                  Legacy registry mismatch
                                </div>
                                {RECOVERY_TOOLS_ENABLED && info.canRepairRegistry ? (
                                  <Button
                                    onClick={() => handleRepairRegistryOwnership(request)}
                                  >
                                    Repair IRP Owner
                                  </Button>
                                ) : (
                                  <Button disabled>
                                    Admin repair required
                                  </Button>
                                )}
                              </>
                            );
                          }

                          if (!info.exists) {
                            // Not registered yet
                            if (info.canRegister) {
                              return (
                                <Button
                                  onClick={async () => {
                                    try {
                                      if (!identityService) throw new Error("Connect wallet to register identity");
                                      const mint = new PublicKey(request.tokenContract);
                                      const wallet = new PublicKey(request.investorWallet);
                                      const existingIdentity = await identityService.fetchWalletIdentity(mint, wallet);
                                      if (existingIdentity) {
                                        setWalletIdentityMap((cur) => ({
                                          ...cur,
                                          [key]: {
                                            ...cur[key],
                                            exists: true,
                                            isActive: Boolean(existingIdentity.isActive),
                                          },
                                        }));
                                        toast.success(
                                          existingIdentity.isActive
                                            ? "Investor is already whitelisted and active."
                                            : "Investor is already whitelisted. Activate before minting.",
                                        );
                                        return;
                                      }
                                      const investorFid = identityService.findFidPda(wallet)[0];
                                      const fidAccount = await identityService.fetchFid(wallet);
                                      if (!fidAccount) {
                                        throw new Error("Investor must register a FID before they can be whitelisted.");
                                      }
                                      if (fidAccount.isIssuer) {
                                        throw new Error("Investor FID is marked as an issuer FID. Register a non-issuer investor FID for this wallet.");
                                      }
                                      if (fidAccount.country < 1 || fidAccount.country > 999) {
                                        throw new Error(
                                          `Investor FID has invalid country code ${fidAccount.country}. Ask the investor to update their FID country before whitelisting.`,
                                        );
                                      }
                                      const whitelistTxHash = await identityService.registerIdentity(
                                        mint,
                                        wallet,
                                        investorFid,
                                        fidAccount.country,
                                      );
                                      await updatePurchaseRequestStatus(
                                        request,
                                        request.status,
                                        { whitelistTxHash },
                                      );
                                      setWalletIdentityMap((cur) => ({
                                        ...cur,
                                        [key]: { ...cur[key], exists: true, isActive: false },
                                      }));
                                      toast.success("Investor whitelisted (pending activation)");
                                    } catch (err: unknown) {
                                      const message =
                                        err instanceof Error
                                          ? err.message
                                          : "Failed to register identity";
                                      if (message.includes("WalletAlreadyRegistered") || message.includes("Wallet is already registered")) {
                                        try {
                                          const mint = new PublicKey(request.tokenContract);
                                          const wallet = new PublicKey(request.investorWallet);
                                          const existingIdentity = await identityService?.fetchWalletIdentity(mint, wallet);
                                          setWalletIdentityMap((cur) => ({
                                            ...cur,
                                            [key]: {
                                              ...cur[key],
                                              exists: true,
                                              isActive: Boolean(existingIdentity?.isActive),
                                            },
                                          }));
                                          toast.success(
                                            existingIdentity?.isActive
                                              ? "Investor is already whitelisted and active."
                                              : "Investor is already whitelisted. Activate before minting.",
                                          );
                                          return;
                                        } catch {
                                          // Fall through to original error if the follow-up read fails.
                                        }
                                      }
                                      toast.error(message);
                                    }
                                  }}
                                >
                                  Whitelist / Register Investor
                                </Button>
                              );
                            }

                            return (
                              <Button disabled>
                                Connect IRS owner or identity agent to whitelist
                              </Button>
                            );
                          }

                          // Exists but not active
                          if (!info.isActive) {
                            return (
                              <>
                                <div className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                                  Pending Activation
                                </div>
                                {info.canActivate ? (
                                  <Button
                                    onClick={async () => {
                                      try {
                                        if (!identityService) throw new Error("Connect IRS owner to activate identity");
                                        const mint = new PublicKey(request.tokenContract);
                                        const wallet = new PublicKey(request.investorWallet);
                                        const activationTxHash =
                                          await identityService.setIdentityActivation(mint, wallet, true);
                                        await updatePurchaseRequestStatus(
                                          request,
                                          request.status,
                                          { activationTxHash },
                                        );
                                        setWalletIdentityMap((cur) => ({
                                          ...cur,
                                          [key]: { ...cur[key], isActive: true },
                                        }));
                                        toast.success("Identity activated");
                                      } catch (err: unknown) {
                                        toast.error(
                                          err instanceof Error
                                            ? err.message
                                            : "Failed to activate identity",
                                        );
                                      }
                                    }}
                                  >
                                    Activate Identity
                                  </Button>
                                ) : null}
                              </>
                            );
                          }

                          // Exists and active: show mint button
                          return (
                            <Button
                              disabled={
                                request.status !== "APPROVED_FOR_MINT" ||
                                mintTokens.isPending
                              }
                              onClick={() => handleMintPurchaseRequest(request)}
                            >
                              Mint to Investor
                            </Button>
                          );
                        })()}
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
          <CardTitle>Transfer Whitelist Queue</CardTitle>
          <CardDescription>
            Secondary transfer recipients that need this issuer to register or activate token-specific IRS identity.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transferRequests.length === 0 ? (
            <div className="text-sm text-slate-500">
              No transfer recipient onboarding requests awaiting issuer action.
            </div>
          ) : (
            <div className="space-y-3">
              {transferRequests.map((request) => {
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
                        {asset ? `${asset.name} (${asset.symbol})` : "Unknown token"}
                      </div>
                      <div className="mt-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
                          {request.source === "listing" ? "Marketplace buyer" : "Direct transfer recipient"}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-700">
                        {request.amountBaseUnits ?? request.amount ?? "-"} base units requested for secondary transfer
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Sender{" "}
                        <span className="font-mono">
                          {request.fromWallet.slice(0, 6)}...{request.fromWallet.slice(-4)}
                        </span>
                        {" "}to recipient{" "}
                        <span className="font-mono">
                          {transferRecipientWallet(request).slice(0, 6)}...{transferRecipientWallet(request).slice(-4)}
                        </span>
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        Status: {request.status.replaceAll("_", " ")}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {request.status === "PENDING_ISSUER_WHITELIST" ? (
                        <Button onClick={() => void handleWhitelistTransferRecipient(request)}>
                          Whitelist Recipient
                        </Button>
                      ) : request.status === "PENDING_ISSUER_ACTIVATION" ? (
                        <Button onClick={() => void handleActivateTransferRecipient(request)}>
                          Activate Recipient
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
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
                      <IssuerAssetHoldersTable
                        tokenContract={asset.tokenContract}
                        assetId={asset.factoryAssetId ?? asset.id}
                        issuerWallet={walletAddress}
                        tokenSymbol={asset.symbol}
                        fallbackBalances={tokenBalances}
                        loadingFallback={loadingBalances}
                      />
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
