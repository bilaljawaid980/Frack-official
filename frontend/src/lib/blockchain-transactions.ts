import { apiFetch } from "@/lib/backend";
import type { Connection } from "@solana/web3.js";

type BlockchainTransactionInput = {
  txHash: string;
  actionType: string;
  actorWallet?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  tokenContract?: string | null;
  metadata?: Record<string, unknown>;
  networkFeeLamports?: string | null;
  rentDepositLamports?: string | null;
  rentRefundLamports?: string | null;
  netSolChangeLamports?: string | null;
  occurredAt?: string;
};

type SolBalanceImpact = {
  networkFeeLamports: string | null;
  rentDepositLamports: string | null;
  rentRefundLamports: string | null;
  netSolChangeLamports: string | null;
};

const EMPTY_SOL_BALANCE_IMPACT: SolBalanceImpact = {
  networkFeeLamports: null,
  rentDepositLamports: null,
  rentRefundLamports: null,
  netSolChangeLamports: null,
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getTransactionSolBalanceImpact(
  connection: Connection,
  signature: string,
  walletAddress: string,
): Promise<SolBalanceImpact> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const transaction = await connection.getParsedTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!transaction?.meta) {
      await wait(400);
      continue;
    }

    const accountIndex = transaction.transaction.message.accountKeys.findIndex(
      (account) => account.pubkey.toBase58() === walletAddress,
    );
    if (accountIndex < 0) return EMPTY_SOL_BALANCE_IMPACT;

    const preBalance = transaction.meta.preBalances[accountIndex];
    const postBalance = transaction.meta.postBalances[accountIndex];
    if (preBalance === undefined || postBalance === undefined) {
      return EMPTY_SOL_BALANCE_IMPACT;
    }

    const networkFee = BigInt(transaction.meta.fee ?? 0);
    const netSolChange = BigInt(postBalance) - BigInt(preBalance);
    const nonFeeChange = netSolChange + networkFee;
    const rentDeposit = nonFeeChange < BigInt(0) ? -nonFeeChange : BigInt(0);
    const rentRefund = nonFeeChange > BigInt(0) ? nonFeeChange : BigInt(0);

    return {
      networkFeeLamports: networkFee.toString(),
      rentDepositLamports: rentDeposit.toString(),
      rentRefundLamports: rentRefund.toString(),
      netSolChangeLamports: netSolChange.toString(),
    };
  }

  return EMPTY_SOL_BALANCE_IMPACT;
}

export async function recordBlockchainTransactionWithSolBalanceImpact(
  input: BlockchainTransactionInput,
  connection: Connection,
  walletAddress: string,
) {
  const solBalanceImpact = await getTransactionSolBalanceImpact(
    connection,
    input.txHash,
    walletAddress,
  );

  return recordBlockchainTransaction({
    ...input,
    ...solBalanceImpact,
    metadata: {
      ...input.metadata,
      solBalanceImpact,
    },
  });
}

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
