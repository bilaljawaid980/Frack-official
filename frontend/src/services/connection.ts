// ─── Singleton Solana Connection ─────────────────────────────────────────────
//
// Exports a singleton Connection to the FRACKS testnet RPC endpoint.
// Use getConnection() in services, hooks, and providers.
// ─────────────────────────────────────────────────────────────────────────────

import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URLS } from "@/lib/constants";

let _connection: Connection | null = null;
let activeRpcIndex = 0;

function createRpcConnection(rpcUrl: string): Connection {
  return new Connection(rpcUrl, {
    commitment: "confirmed",
    wsEndpoint: rpcUrl.replace(/^http/, "ws"),
    disableRetryOnRateLimit: false,
    confirmTransactionInitialTimeout: 60_000,
  });
}

function isRpcFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("429") ||
    message.includes("Too Many Requests") ||
    message.includes("fetch failed") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError")
  );
}

export function switchToNextRpcEndpoint(): Connection | null {
  if (activeRpcIndex >= RPC_URLS.length - 1) return null;
  activeRpcIndex += 1;
  _connection = createRpcConnection(RPC_URLS[activeRpcIndex]);
  console.warn(
    `[Solana] Switched RPC endpoint to fallback #${activeRpcIndex + 1}`,
  );
  return _connection;
}

/**
 * Returns the singleton Connection to the FRACKS testnet RPC endpoint.
 * The instance is created once and reused for the lifetime of the process.
 */
export function getConnection(): Connection {
  if (_connection === null) {
    _connection = createRpcConnection(RPC_URLS[activeRpcIndex]);
  }
  return _connection;
}

/**
 * Returns the SOL balance (in lamports) for the given public key.
 *
 * @param pubkey - The account public key
 */
export async function getBalance(pubkey: PublicKey): Promise<number> {
  try {
    return await getConnection().getBalance(pubkey, "confirmed");
  } catch (error) {
    const fallback = isRpcFailure(error) ? switchToNextRpcEndpoint() : null;
    if (!fallback) throw error;
    return fallback.getBalance(pubkey, "confirmed");
  }
}
