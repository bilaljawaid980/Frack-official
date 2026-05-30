import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import { BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

import { createKeypairProvider } from "../lib/anchor";
import { RPC_URL, TIR_PROGRAM_ID } from "../lib/constants";
import tirIdl from "../idl/fracks_tir.json";

const EXPECTED_ISSUER_ENTRY_SPACE = 8 + 32 + 32 + 4 + 8 * 20 + 1 + 4 + 64 + 1;

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const contents = fs.readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadKeypair(secretPath: string): Keypair {
  const raw = fs.readFileSync(secretPath, "utf8").trim();
  if (!raw) throw new Error(`Keypair file is empty: ${secretPath}`);
  if (raw.startsWith("[")) {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw) as
      | { privateKey?: string; secretKey?: string; address?: string }
      | number[];
    if (Array.isArray(parsed)) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
    const encodedSecret = parsed.privateKey ?? parsed.secretKey;
    if (!encodedSecret) {
      throw new Error(
        `JSON keypair file must contain "privateKey" or "secretKey": ${secretPath}`,
      );
    }
    const keypair = Keypair.fromSecretKey(bs58.decode(encodedSecret));
    if (parsed.address && keypair.publicKey.toBase58() !== parsed.address) {
      throw new Error(
        `Keypair address mismatch in ${secretPath}. Expected ${parsed.address}, derived ${keypair.publicKey.toBase58()}.`,
      );
    }
    return keypair;
  }
  return Keypair.fromSecretKey(bs58.decode(raw));
}

function decodeSimulatedDataLength(
  account:
    | {
        data?: [string, string] | string;
      }
    | null
    | undefined,
): number {
  if (!account?.data) return 0;
  if (Array.isArray(account.data) && typeof account.data[0] === "string") {
    return Buffer.from(account.data[0], "base64").length;
  }
  if (typeof account.data === "string") {
    return Buffer.from(account.data, "base64").length;
  }
  return 0;
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "..", "backend", ".env"));

  const rpc = getArg("--rpc") ?? process.env.NEXT_PUBLIC_SOLANA_RPC_URL1 ?? RPC_URL;
  const keypairPath =
    getArg("--keypair") ??
    process.env.HOOK_DEBUG_KEYPAIR ??
    path.resolve(process.cwd(), "platform-admin-wallet.json");
  const issuerFidArg =
    getArg("--issuer-fid") ??
    process.env.NEXT_PUBLIC_KYC_PROVIDER_FID ??
    "GrdbmXVyofRxQdko1HVZhU7PHNjthJmWnQyZWJgiZDeL";
  const label = getArg("--label") ?? "KYC";
  const topic = new BN(getArg("--topic") ?? "1");

  const payer = loadKeypair(keypairPath);
  const connection = new Connection(rpc, "confirmed");
  const provider = createKeypairProvider(connection, payer);
  const tirProgram = new Program(tirIdl as Idl, provider);

  const tokenMint = Keypair.generate().publicKey;
  const issuerFid = new PublicKey(issuerFidArg);
  const [tirState] = PublicKey.findProgramAddressSync(
    [Buffer.from("tir_state"), tokenMint.toBuffer()],
    TIR_PROGRAM_ID,
  );
  const [issuerEntry] = PublicKey.findProgramAddressSync(
    [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
    TIR_PROGRAM_ID,
  );

  const payerBalance = await connection.getBalance(payer.publicKey, "confirmed");
  const issuerEntryBefore = await connection.getAccountInfo(issuerEntry, "confirmed");
  const expectedRent = await connection.getMinimumBalanceForRentExemption(
    EXPECTED_ISSUER_ENTRY_SPACE,
    "confirmed",
  );

  console.log("=== FRACKS TIR Issuer Entry Debug ===");
  console.log("RPC:", rpc);
  console.log("Payer pubkey:", payer.publicKey.toBase58());
  console.log("Payer balance:", payerBalance);
  console.log("Token mint:", tokenMint.toBase58());
  console.log("TIR state:", tirState.toBase58());
  console.log("Issuer FID:", issuerFid.toBase58());
  console.log("Issuer entry PDA:", issuerEntry.toBase58());
  console.log("accountInfo before:", issuerEntryBefore);
  console.log("expectedAccountSize:", EXPECTED_ISSUER_ENTRY_SPACE);
  console.log("rentExemptLamports:", expectedRent);

  await (tirProgram.methods as unknown as {
    initializeTir: (
      tokenMint: PublicKey,
    ) => {
      accounts: (accounts: Record<string, unknown>) => { rpc(): Promise<string> };
    };
  })
    .initializeTir(tokenMint)
    .accounts({
      owner: payer.publicKey,
      tirState,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const addTrustedIssuerIx = await (tirProgram.methods as unknown as {
    addTrustedIssuer: (
      issuerFid: PublicKey,
      topics: BN[],
      label: string,
    ) => {
      accounts: (accounts: Record<string, unknown>) => {
        instruction(): Promise<import("@solana/web3.js").TransactionInstruction>;
      };
    };
  })
    .addTrustedIssuer(issuerFid, [topic], label)
    .accounts({
      owner: payer.publicKey,
      tirState,
      issuerEntry,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [addTrustedIssuerIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  tx.sign([payer]);

  const simulation = await (
    connection.simulateTransaction as unknown as (
      transaction: VersionedTransaction,
      config: {
        sigVerify: boolean;
        commitment: "confirmed";
        replaceRecentBlockhash: boolean;
        accounts: {
          addresses: string[];
          encoding: "base64";
        };
      },
    ) => Promise<{
      value: {
        err: unknown;
        logs?: string[] | null;
        accounts?: Array<{
          lamports: number;
          owner: string;
          executable: boolean;
          data?: [string, string] | string;
          rentEpoch?: number;
          space?: number;
        } | null>;
      };
    }>
  )(tx, {
    sigVerify: false,
    commitment: "confirmed",
    replaceRecentBlockhash: true,
    accounts: {
      addresses: [payer.publicKey.toBase58(), issuerEntry.toBase58()],
      encoding: "base64",
    },
  });

  const simulatedPayer = simulation.value.accounts?.[0] ?? null;
  const simulatedIssuerEntry = simulation.value.accounts?.[1] ?? null;
  const simulatedDataLength = decodeSimulatedDataLength(simulatedIssuerEntry);
  const simulatedRent =
    simulatedDataLength > 0
      ? await connection.getMinimumBalanceForRentExemption(
          simulatedDataLength,
          "confirmed",
        )
      : 0;

  console.log("\n=== AddTrustedIssuer Simulation ===");
  console.log("err:", simulation.value.err);
  console.log("logs:\n" + (simulation.value.logs?.join("\n") ?? "(no logs)"));
  console.log("post-sim payer:", simulatedPayer);
  console.log("post-sim issuer_entry:", simulatedIssuerEntry);
  console.log("post-sim issuer_entry data length:", simulatedDataLength);
  console.log("post-sim issuer_entry rent minimum:", simulatedRent);
  console.log(
    "post-sim issuer_entry rent satisfied:",
    simulatedIssuerEntry ? simulatedIssuerEntry.lamports >= simulatedRent : false,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
