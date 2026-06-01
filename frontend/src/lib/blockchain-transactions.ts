import { apiFetch } from "@/lib/backend";

type BlockchainTransactionInput = {
  txHash: string;
  actionType: string;
  actorWallet?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  tokenContract?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
};

export async function recordBlockchainTransaction(
  input: BlockchainTransactionInput,
) {
  return apiFetch("/blockchain-transactions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function recordBlockchainTransactionSafely(
  input: BlockchainTransactionInput,
) {
  void recordBlockchainTransaction(input).catch((error) => {
    console.error("Failed to persist blockchain transaction:", error);
  });
}
