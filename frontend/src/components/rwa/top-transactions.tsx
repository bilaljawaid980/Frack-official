"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Clock,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { apiFetch } from "@/lib/backend";
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

function shorten(value?: string | null) {
  if (!value) return "system";
  if (value.length <= 14) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function txUrl(hash: string) {
  const cluster = process.env.NEXT_PUBLIC_SOLANA_CLUSTER || "devnet";
  const query = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${hash}${query}`;
}

function requestAssetLabel(request: TokenPurchaseRequest) {
  return request.assetId || shorten(request.tokenContract);
}

function buildRequestTransactions(
  requests: TokenPurchaseRequest[],
): Transaction[] {
  return requests.flatMap((request) => {
    const timestamp = new Date(request.updatedAt || request.createdAt);
    const asset = requestAssetLabel(request);
    const rows: Transaction[] = [];

    if (request.mintTxHash) {
      rows.push({
        hash: request.mintTxHash,
        type: "mint",
        label: "Minted Tokens",
        from: request.issuerWallet || "Issuer",
        to: request.investorWallet,
        amount: `${Number(request.amount || 0).toLocaleString()} tokens`,
        timestamp,
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
        timestamp,
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
        timestamp,
        asset,
      });
    }

    return rows;
  });
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

export function TopTransactions({ limit = 5 }: TopTransactionsProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const fetchTransactions = async () => {
      setLoading(true);
      try {
        const [requests, logs] = await Promise.all([
          apiFetch<TokenPurchaseRequest[]>("/token-purchase-requests").catch(
            () => [],
          ),
          apiFetch<ActivityLog[]>("/activity-logs?limit=100").catch(() => []),
        ]);

        const merged = [
          ...buildRequestTransactions(requests),
          ...buildActivityTransactions(logs),
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

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
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
    <div className="space-y-3">
      {transactions.slice(0, limit).map((tx, index) => (
        <motion.div
          key={tx.hash}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: index * 0.06 }}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-slate-200/80 p-3 transition-colors hover:bg-blue-50/40"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="shrink-0 rounded-lg bg-[#2A5FA6]/10 p-2">
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
              <div className="flex items-center gap-2">
                <p className="max-w-32 truncate text-sm font-medium xl:max-w-40">
                  {tx.label}
                </p>
                <span className="min-w-0 truncate text-xs text-gray-500">
                  {tx.asset}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span className="min-w-0 truncate">{shorten(tx.from)}</span>
                <span className="shrink-0">-&gt;</span>
                <span className="min-w-0 truncate">{shorten(tx.to)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-right">
            <a
              href={txUrl(tx.hash)}
              target="_blank"
              rel="noreferrer"
              className="hidden rounded-lg border border-slate-200 p-2 text-[#2A5FA6] transition-colors hover:bg-blue-50 2xl:inline-flex"
              aria-label="Open transaction"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <div className="w-24">
              <p className="truncate text-sm font-semibold">{tx.amount}</p>
              <p className="text-xs text-gray-500">
                {formatDistanceToNow(tx.timestamp, { addSuffix: true })}
              </p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}
