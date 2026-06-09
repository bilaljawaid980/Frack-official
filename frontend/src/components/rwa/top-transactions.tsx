"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/backend";
import { getSolscanTxUrl } from "@/lib/solscan";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";

interface Transaction {
  hash: string;
  type: "transfer" | "mint" | "burn" | "claim" | "activity";
  from: string;
  to: string;
  amount: string;
  timestamp: Date;
  asset: string;
  label: string;
}

interface TopTransactionsProps {
  limit?: number;
  pageSize?: number;
}

type ActivityLog = {
  id: string;
  actionType: string;
  actorWallet?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  txHash?: string | null;
  createdAt: string;
};

type BlockchainTransaction = {
  id: string;
  txHash: string;
  actionType: string;
  actorWallet?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  tokenContract?: string | null;
  occurredAt: string;
};

type TokenTransferRequest = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  fromWallet: string;
  toWallet: string;
  amount?: number | null;
  status: string;
  kycProvider?: string | null;
  amlProvider?: string | null;
  kycClaimTxHash?: string | null;
  kycClaimedAt?: string | null;
  amlClaimTxHash?: string | null;
  amlClaimedAt?: string | null;
  transferTxHash?: string | null;
  transferredAt?: string | null;
  whitelistTxHash?: string | null;
  whitelistedAt?: string | null;
  activationTxHash?: string | null;
  activatedAt?: string | null;
  updatedAt: string;
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
  kycProvider?: string | null;
  amlProvider?: string | null;
  kycClaimTxHash?: string | null;
  kycClaimedAt?: string | null;
  amlClaimTxHash?: string | null;
  amlClaimedAt?: string | null;
  transferTxHash?: string | null;
  transferredAt?: string | null;
  whitelistTxHash?: string | null;
  whitelistedAt?: string | null;
  activationTxHash?: string | null;
  activatedAt?: string | null;
  updatedAt: string;
  createdAt: string;
};

type IndexedAsset = {
  id: string;
  tokenContract: string;
  name: string;
  symbol: string;
  issuerWallet?: string | null;
  metadata?: unknown;
  deployedAt?: string | null;
  createdAt: string;
};

function shorten(value?: string | null) {
  if (!value) return "system";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function requestAssetLabel(request: TokenPurchaseRequest) {
  return request.assetId || shorten(request.tokenContract);
}

function metadataRecord(metadata: unknown) {
  return metadata && typeof metadata === "object"
    ? (metadata as Record<string, unknown>)
    : {};
}

function buildIdentitySetupTransactions({
  activationTxHash,
  activatedAt,
  asset,
  fallbackTimestamp,
  from,
  to,
  whitelistTxHash,
  whitelistedAt,
}: {
  activationTxHash?: string | null;
  activatedAt?: string | null;
  asset: string;
  fallbackTimestamp: string;
  from?: string | null;
  to: string;
  whitelistTxHash?: string | null;
  whitelistedAt?: string | null;
}): Transaction[] {
  const rows: Transaction[] = [];

  if (whitelistTxHash) {
    rows.push({
      hash: whitelistTxHash,
      type: "claim",
      label: "Investor Whitelisted",
      from: from || "Issuer",
      to,
      amount: "IRS Register",
      timestamp: new Date(whitelistedAt || fallbackTimestamp),
      asset,
    });
  }

  if (activationTxHash) {
    rows.push({
      hash: activationTxHash,
      type: "claim",
      label: "Identity Activated",
      from: from || "Issuer",
      to,
      amount: "IRS Activate",
      timestamp: new Date(activatedAt || fallbackTimestamp),
      asset,
    });
  }

  return rows;
}

function buildTransferEligibilityClaimTransactions({
  amlClaimTxHash,
  amlClaimedAt,
  amlProvider,
  asset,
  fallbackTimestamp,
  kycClaimTxHash,
  kycClaimedAt,
  kycProvider,
  to,
}: {
  amlClaimTxHash?: string | null;
  amlClaimedAt?: string | null;
  amlProvider?: string | null;
  asset: string;
  fallbackTimestamp: string;
  kycClaimTxHash?: string | null;
  kycClaimedAt?: string | null;
  kycProvider?: string | null;
  to: string;
}): Transaction[] {
  const rows: Transaction[] = [];

  if (kycClaimTxHash) {
    rows.push({
      hash: kycClaimTxHash,
      type: "claim",
      label: "Transfer Eligibility KYC Claim",
      from: kycProvider || "KYC provider",
      to,
      amount: "Topic 1",
      timestamp: new Date(kycClaimedAt || fallbackTimestamp),
      asset,
    });
  }

  if (amlClaimTxHash) {
    rows.push({
      hash: amlClaimTxHash,
      type: "claim",
      label: "Transfer Eligibility AML Claim",
      from: amlProvider || "AML provider",
      to,
      amount: "Topic 2",
      timestamp: new Date(amlClaimedAt || fallbackTimestamp),
      asset,
    });
  }

  return rows;
}

function buildRequestTransactions(
  requests: TokenPurchaseRequest[],
): Transaction[] {
  return requests.flatMap((request) => {
    const timestamp = new Date(request.updatedAt || request.createdAt);
    const asset = requestAssetLabel(request);
    const rows: Transaction[] = [];

    rows.push(
      ...buildIdentitySetupTransactions({
        activationTxHash: request.activationTxHash,
        activatedAt: request.activatedAt,
        asset,
        fallbackTimestamp: request.updatedAt || request.createdAt,
        from: request.issuerWallet,
        to: request.investorWallet,
        whitelistTxHash: request.whitelistTxHash,
        whitelistedAt: request.whitelistedAt,
      }),
    );

    if (request.mintTxHash) {
      rows.push({
        hash: request.mintTxHash,
        type: "mint",
        label: "Minted Tokens",
        from: request.issuerWallet || "Issuer",
        to: request.investorWallet,
        amount: `${Number(request.amount || 0).toLocaleString()} tokens`,
        timestamp: request.mintedAt ? new Date(request.mintedAt) : timestamp,
        asset,
      });
    }

    if (request.kycClaimTxHash) {
      rows.push({
        hash: request.kycClaimTxHash,
        type: "claim",
        label: "KYC Claim",
        from: request.kycProvider || "KYC provider",
        to: request.investorWallet,
        amount: "Topic 1",
        timestamp: request.kycApprovedAt ? new Date(request.kycApprovedAt) : timestamp,
        asset,
      });
    }

    if (request.amlClaimTxHash) {
      rows.push({
        hash: request.amlClaimTxHash,
        type: "claim",
        label: "AML Claim",
        from: request.amlProvider || "AML provider",
        to: request.investorWallet,
        amount: "Topic 2",
        timestamp: request.amlApprovedAt ? new Date(request.amlApprovedAt) : timestamp,
        asset,
      });
    }

    return rows;
  });
}

function buildTransferTransactions(
  requests: TokenTransferRequest[],
): Transaction[] {
  return requests
    .flatMap((request) => {
      const asset = request.assetId || shorten(request.tokenContract);
      const fallbackTimestamp = request.updatedAt || request.createdAt;
      const rows = [
        ...buildTransferEligibilityClaimTransactions({
          amlClaimTxHash: request.amlClaimTxHash,
          amlClaimedAt: request.amlClaimedAt,
          amlProvider: request.amlProvider,
          asset,
          fallbackTimestamp,
          kycClaimTxHash: request.kycClaimTxHash,
          kycClaimedAt: request.kycClaimedAt,
          kycProvider: request.kycProvider,
          to: request.toWallet,
        }),
        ...buildIdentitySetupTransactions({
          activationTxHash: request.activationTxHash,
          activatedAt: request.activatedAt,
          asset,
          fallbackTimestamp,
          from: request.fromWallet,
          to: request.toWallet,
          whitelistTxHash: request.whitelistTxHash,
          whitelistedAt: request.whitelistedAt,
        }),
      ];

      if (request.transferTxHash) {
        rows.push({
          hash: request.transferTxHash,
          type: "transfer" as const,
          label: "Token Transfer",
          from: request.fromWallet,
          to: request.toWallet,
          amount: `${Number(request.amount || 0).toLocaleString()} tokens`,
          timestamp: new Date(
            request.transferredAt || request.updatedAt || request.createdAt,
          ),
          asset,
        });
      }

      return rows;
    });
}

function buildBuyIntentTransactions(intents: TokenBuyIntent[]): Transaction[] {
  return intents
    .flatMap((intent) => {
      const asset = intent.assetId || shorten(intent.tokenContract);
      const fallbackTimestamp = intent.updatedAt || intent.createdAt;
      const rows = [
        ...buildTransferEligibilityClaimTransactions({
          amlClaimTxHash: intent.amlClaimTxHash,
          amlClaimedAt: intent.amlClaimedAt,
          amlProvider: intent.amlProvider,
          asset,
          fallbackTimestamp,
          kycClaimTxHash: intent.kycClaimTxHash,
          kycClaimedAt: intent.kycClaimedAt,
          kycProvider: intent.kycProvider,
          to: intent.buyerWallet,
        }),
        ...buildIdentitySetupTransactions({
          activationTxHash: intent.activationTxHash,
          activatedAt: intent.activatedAt,
          asset,
          fallbackTimestamp,
          from: intent.sellerWallet,
          to: intent.buyerWallet,
          whitelistTxHash: intent.whitelistTxHash,
          whitelistedAt: intent.whitelistedAt,
        }),
      ];

      if (intent.transferTxHash) {
        rows.push({
          hash: intent.transferTxHash,
          type: "transfer" as const,
          label: "Marketplace Transfer",
          from: intent.sellerWallet,
          to: intent.buyerWallet,
          amount: `${intent.amountBaseUnits} base units`,
          timestamp: new Date(
            intent.transferredAt || intent.updatedAt || intent.createdAt,
          ),
          asset,
        });
      }

      return rows;
    });
}

function buildAssetTransactions(assets: IndexedAsset[]): Transaction[] {
  return assets.reduce<Transaction[]>((transactions, asset) => {
      const metadata = metadataRecord(asset.metadata);
      const hash =
        typeof metadata.txHash === "string" && metadata.txHash
          ? metadata.txHash
          : null;
      if (!hash) return transactions;

      transactions.push({
        hash,
        type: "activity" as const,
        label: "Token Deployed",
        from: asset.issuerWallet || "Issuer",
        to: asset.tokenContract,
        amount: asset.symbol || "Asset",
        timestamp: new Date(asset.deployedAt || asset.createdAt),
        asset: asset.name || shorten(asset.tokenContract),
      });
      return transactions;
    }, []);
}

function buildActivityTransactions(logs: ActivityLog[]): Transaction[] {
  return logs
    .filter((log) => !!log.txHash)
    .map((log) => ({
      hash: log.txHash as string,
      type: "activity" as const,
      label: log.actionType.replace(/_/g, " "),
      from: log.actorWallet || "system",
      to: log.entityId || log.assetId || log.entityType || "record",
      amount: log.entityType || "Activity",
      timestamp: new Date(log.createdAt),
      asset: log.assetId || log.entityType || "Audit",
    }));
}

function buildLedgerTransactions(entries: BlockchainTransaction[]): Transaction[] {
  return entries.map((entry) => ({
    hash: entry.txHash,
    type: entry.actionType.includes("BURN")
      ? "burn" as const
      : entry.actionType.includes("CLAIM")
        ? "claim" as const
        : "activity" as const,
    label:
      {
        TOKENS_BURNED: "Tokens Burned",
        WALLET_FROZEN: "Wallet Frozen",
        WALLET_UNFROZEN: "Wallet Unfrozen",
        INVESTOR_FID_CREATED: "Investor FID Created",
        INVESTOR_FID_UPDATED: "Investor FID Updated",
        ISSUER_FID_CREATED: "Issuer FID Created",
        ISSUER_FID_UPDATED: "Issuer FID Updated",
        PROVIDER_FID_CREATED: "Provider FID Created",
        PROVIDER_FID_UPDATED: "Provider FID Updated",
      }[entry.actionType] || entry.actionType.replace(/_/g, " "),
    from: entry.actorWallet || "system",
    to: entry.entityId || entry.entityType || "record",
    amount:
      {
        TOKENS_BURNED: "Burn",
        WALLET_FROZEN: "Freeze",
        WALLET_UNFROZEN: "Unfreeze",
      }[entry.actionType] || entry.assetId || "On-chain",
    timestamp: new Date(entry.occurredAt),
    asset: entry.assetId || shorten(entry.tokenContract) || "Ledger",
  }));
}

export function TopTransactions({ limit, pageSize = 10 }: TopTransactionsProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const [requests, transferRequests, buyIntents, assets, logs, ledger] =
          await Promise.all([
          apiFetch<TokenPurchaseRequest[]>("/token-purchase-requests").catch(
            () => [],
          ),
          apiFetch<TokenTransferRequest[]>("/token-transfer-requests").catch(
            () => [],
          ),
          apiFetch<TokenBuyIntent[]>("/token-listings/buy-intents").catch(
            () => [],
          ),
          apiFetch<IndexedAsset[]>("/indexed/assets").catch(() => []),
          apiFetch<ActivityLog[]>("/activity-logs?limit=100").catch(() => []),
          apiFetch<BlockchainTransaction[]>("/blockchain-transactions?limit=250").catch(
            () => [],
          ),
        ]);

        const merged = [
          ...buildRequestTransactions(requests),
          ...buildTransferTransactions(transferRequests),
          ...buildBuyIntentTransactions(buyIntents),
          ...buildAssetTransactions(assets),
          ...buildActivityTransactions(logs),
          ...buildLedgerTransactions(ledger),
        ]
          .filter(
            (tx, index, all) =>
              all.findIndex((candidate) => candidate.hash === tx.hash) ===
              index,
          )
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

        if (!cancelled) {
          setTransactions(merged);
        }
      } catch (error) {
        console.error("Failed to fetch transactions:", error);
        if (!cancelled) {
          setTransactions([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchTransactions();

    return () => {
      cancelled = true;
    };
  }, []);

  const sourceTransactions =
    typeof limit === "number" ? transactions.slice(0, limit) : transactions;
  const totalPages = Math.max(
    1,
    Math.ceil(sourceTransactions.length / pageSize),
  );
  const effectivePage = Math.min(page, totalPages - 1);
  const displayTransactions = sourceTransactions.slice(
    effectivePage * pageSize,
    effectivePage * pageSize + pageSize,
  );

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(pageSize)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    );
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="p-3 rounded-full bg-gray-100 mb-3">
          <Clock className="h-8 w-8 text-gray-400" />
        </div>
        <h3 className="text-lg font-medium text-gray-900 mb-1">
          No Transactions Yet
        </h3>
        <p className="text-sm text-gray-500">
          Transactions will appear here once activity begins
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="space-y-3">
        {displayTransactions.map((tx, index) => (
          <motion.div
            key={tx.hash}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.04 }}
            className="grid min-h-17 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-slate-200/80 px-3 py-2.5 transition-colors hover:bg-blue-50/40"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#2A5FA6]/10">
                {tx.type === "claim" ? (
                  <ShieldCheck className="h-4 w-4 text-[#BC953D]" />
                ) : tx.type === "activity" ? (
                  <BadgeCheck className="h-4 w-4 text-[#2A5FA6]" />
                ) : tx.type === "burn" ? (
                  <ArrowDownLeft className="h-4 w-4 text-red-600" />
                ) : (
                  <ArrowUpRight className="h-4 w-4 text-[#2A5FA6]" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {tx.label}
                </p>
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="min-w-0 truncate">{shorten(tx.from)}</span>
                  <span className="shrink-0">-&gt;</span>
                  <span className="min-w-0 truncate">{shorten(tx.to)}</span>
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-right">
              <div className="min-w-28">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {tx.amount}
                </p>
                <p className="truncate text-xs text-gray-500">
                  {formatDistanceToNow(tx.timestamp, { addSuffix: true })}
                </p>
              </div>
              <a
                href={getSolscanTxUrl(tx.hash)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 p-2 text-[#2A5FA6] transition-colors hover:bg-blue-50"
                aria-label="Open transaction"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </motion.div>
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
          aria-label="Previous transactions page"
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
          aria-label="Next transactions page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
