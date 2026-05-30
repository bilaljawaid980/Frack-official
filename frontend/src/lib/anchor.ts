import { AnchorProvider, Program, Idl, setProvider } from "@coral-xyz/anchor";
// Import the provider-level Wallet *interface* (not the NodeWallet class)
// directly from the provider module to avoid the NodeWallet constraint.
import type { Wallet as AnchorWallet } from "@coral-xyz/anchor/dist/cjs/provider";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";

// ─── Wallet Adapter Shim ─────────────────────────────────────────────────────
// Provides a looser adapter interface that matches @solana/wallet-adapter-base
// without requiring that UI package directly.

/** Subset of @solana/wallet-adapter-base's WalletAdapter that Anchor needs. */
export interface WalletAdapter {
  publicKey: PublicKey | null;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]>;
}

// ─── Dummy (read-only) wallet ─────────────────────────────────────────────────

/**
 * A no-op wallet used for read-only providers that never need to sign.
 * Signing methods throw deliberately so callers surface clear errors
 * instead of silent no-ops.
 */
class ReadonlyWallet implements AnchorWallet {
  readonly publicKey: PublicKey;

  constructor() {
    // Use the system-program pubkey as a deterministic placeholder so
    // PDA derivations in simulations are stable.
    this.publicKey = new PublicKey("11111111111111111111111111111111");
  }

  signTransaction<T extends Transaction | VersionedTransaction>(_tx: T): Promise<T> {
    return Promise.reject(
      new Error("ReadonlyWallet cannot sign transactions. Connect a wallet first.")
    );
  }

  signAllTransactions<T extends Transaction | VersionedTransaction>(_txs: T[]): Promise<T[]> {
    return Promise.reject(
      new Error("ReadonlyWallet cannot sign transactions. Connect a wallet first.")
    );
  }
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Adapts a WalletAdapter (publicKey may be null) into the Anchor Wallet
 * interface (requires a non-null publicKey). Throws if disconnected.
 */
function toAnchorWallet(adapter: WalletAdapter): AnchorWallet {
  if (!adapter.publicKey) {
    throw new Error("Wallet is not connected. publicKey is null.");
  }
  // The runtime shape is compatible – cast is safe after the null check.
  return adapter as unknown as AnchorWallet;
}

// ─── Provider Factories ───────────────────────────────────────────────────────

/**
 * Creates an AnchorProvider backed by a live wallet adapter.
 * Suitable for all write operations (send transactions).
 *
 * @param connection  - Solana RPC connection
 * @param wallet      - Connected wallet adapter (must have a public key)
 * @param commitment  - Confirmation commitment level (default: "confirmed")
 */
export function createAnchorProvider(
  connection: Connection,
  wallet: WalletAdapter,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): AnchorProvider {
  const anchorWallet = toAnchorWallet(wallet);

  const provider = new AnchorProvider(connection, anchorWallet, {
    commitment,
    preflightCommitment: commitment,
    skipPreflight: false,
  });

  setProvider(provider);
  return provider;
}

/**
 * Creates a read-only AnchorProvider using a dummy wallet.
 * Use this for fetching on-chain accounts without requiring a wallet connection.
 *
 * @param connection - Solana RPC connection
 * @param commitment - Confirmation commitment level (default: "confirmed")
 */
export function createReadonlyProvider(
  connection: Connection,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): AnchorProvider {
  const dummyWallet = new ReadonlyWallet();

  return new AnchorProvider(connection, dummyWallet, {
    commitment,
    preflightCommitment: commitment,
    skipPreflight: false,
  });
}

/**
 * Creates a provider from a raw Keypair.  Useful in scripts and tests.
 *
 * @param connection - Solana RPC connection
 * @param keypair    - Keypair that will sign transactions
 * @param commitment - Confirmation commitment level (default: "confirmed")
 */
export function createKeypairProvider(
  connection: Connection,
  keypair: Keypair,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): AnchorProvider {
  const wallet: AnchorWallet = {
    publicKey: keypair.publicKey,

    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (tx instanceof Transaction) {
        tx.partialSign(keypair);
      } else {
        (tx as VersionedTransaction).sign([keypair]);
      }
      return tx;
    },

    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      for (const tx of txs) {
        if (tx instanceof Transaction) {
          tx.partialSign(keypair);
        } else {
          (tx as VersionedTransaction).sign([keypair]);
        }
      }
      return txs;
    },
  };
  // Attach payer so Anchor's NodeWallet-aware code paths can use it
  (wallet as AnchorWallet & { payer: Keypair }).payer = keypair;

  return new AnchorProvider(connection, wallet, {
    commitment,
    preflightCommitment: commitment,
    skipPreflight: false,
  });
}

// ─── Program Factory ──────────────────────────────────────────────────────────

/**
 * Instantiates an Anchor Program from an IDL, program address, and provider.
 *
 * @param idl       - The program's IDL object (imported JSON)
 * @param programId - On-chain program address
 * @param provider  - AnchorProvider to use for RPC calls and signing
 */
export function getProgram<T extends Idl>(
  idl: T,
  programId: PublicKey,
  provider: AnchorProvider
): Program<T> {
  return new Program<T>(idl, provider);
}

/**
 * Convenience wrapper: creates a readonly provider and returns a Program
 * instance.  Ideal for data-fetching hooks that run before a wallet connects.
 *
 * @param idl        - The program's IDL object
 * @param programId  - On-chain program address (for documentation / logging)
 * @param connection - Solana RPC connection
 */
export function getReadonlyProgram<T extends Idl>(
  idl: T,
  programId: PublicKey,
  connection: Connection
): Program<T> {
  const provider = createReadonlyProvider(connection);
  return getProgram(idl, programId, provider);
}

// ─── Connection Factory ───────────────────────────────────────────────────────

/**
 * Creates a Solana Connection with sensible defaults for the FRACKS frontend.
 *
 * @param rpcUrl    - RPC endpoint URL
 * @param commitment - Confirmation commitment (default: "confirmed")
 */
export function createConnection(
  rpcUrl: string,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed"
): Connection {
  return new Connection(rpcUrl, {
    commitment,
    wsEndpoint: rpcUrl.replace(/^http/, "ws"),
    disableRetryOnRateLimit: false,
    confirmTransactionInitialTimeout: 60_000,
  });
}
