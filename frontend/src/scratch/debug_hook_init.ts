import fs from "node:fs";
import path from "node:path";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { Idl, Program } from "@coral-xyz/anchor";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeTransferHookInstruction,
  getMintLen,
} from "@solana/spl-token";

import { createKeypairProvider } from "../lib/anchor";
import {
  COMPLIANCE_PROGRAM_ID,
  RPC_URL,
  SEED_COMPLIANCE_STATE,
  SEED_EXTRA_ACCOUNT_METAS,
  SEED_OWNER,
  SEED_TOKEN_STATE,
  TOKEN_HOOK_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "../lib/constants";
import tokenIdl from "../idl/fracks_token.json";
import complianceIdl from "../idl/fracks_compliance.json";
import hookIdl from "../idl/fracks_token_hook.json";

const EXPECTED_ACCOUNT_SIZE = 2291;

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

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadKeypair(secretPath: string): Keypair {
  const raw = fs.readFileSync(secretPath, "utf8").trim();
  if (!raw) {
    throw new Error(`Keypair file is empty: ${secretPath}`);
  }

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

  if (!fs.existsSync(keypairPath)) {
    throw new Error(
      `Keypair file not found: ${keypairPath}. Pass --keypair <path> for the deploy/admin wallet.`,
    );
  }

  const connection = new Connection(rpc, "confirmed");
  const payer = loadKeypair(keypairPath);
  const provider = createKeypairProvider(connection, payer);

  const tokenProgram = new Program(tokenIdl as Idl, provider);
  const complianceProgram = new Program(complianceIdl as Idl, provider);
  const hookProgram = new Program(hookIdl as Idl, provider);

  const tokenMint = Keypair.generate();
  const [tokenState] = PublicKey.findProgramAddressSync(
    [SEED_TOKEN_STATE, tokenMint.publicKey.toBuffer()],
    TOKEN_PROGRAM_ID,
  );
  const [ownerState] = PublicKey.findProgramAddressSync(
    [SEED_OWNER, tokenMint.publicKey.toBuffer()],
    TOKEN_PROGRAM_ID,
  );
  const [complianceState] = PublicKey.findProgramAddressSync(
    [SEED_COMPLIANCE_STATE, tokenMint.publicKey.toBuffer()],
    COMPLIANCE_PROGRAM_ID,
  );
  const [extraAccountMetas] = PublicKey.findProgramAddressSync(
    [SEED_EXTRA_ACCOUNT_METAS, tokenMint.publicKey.toBuffer()],
    TOKEN_HOOK_PROGRAM_ID,
  );

  const payerBalance = await connection.getBalance(payer.publicKey, "confirmed");
  const extraAccountInfoBefore = await connection.getAccountInfo(extraAccountMetas, "confirmed");
  const expectedRent = await connection.getMinimumBalanceForRentExemption(
    EXPECTED_ACCOUNT_SIZE,
    "confirmed",
  );

  console.log("=== FRACKS Hook Init Debug ===");
  console.log("RPC:", rpc);
  console.log("Payer pubkey:", payer.publicKey.toBase58());
  console.log("Payer balance:", payerBalance);
  console.log("Token mint:", tokenMint.publicKey.toBase58());
  console.log("Token state:", tokenState.toBase58());
  console.log("Owner state:", ownerState.toBase58());
  console.log("Compliance state:", complianceState.toBase58());
  console.log("extra_account_metas PDA:", extraAccountMetas.toBase58());
  console.log("accountInfo before:", extraAccountInfoBefore);
  console.log("expectedAccountSize:", EXPECTED_ACCOUNT_SIZE);
  console.log("rentExemptLamports:", expectedRent);

  const mintLen = getMintLen([
    ExtensionType.MetadataPointer,
    ExtensionType.TransferHook,
    ExtensionType.PermanentDelegate,
  ]);
  const mintLamports = await connection.getMinimumBalanceForRentExemption(
    mintLen,
    "confirmed",
  );

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: tokenMint.publicKey,
      space: mintLen,
      lamports: mintLamports,
      programId: SPL_TOKEN_2022,
    }),
    createInitializeTransferHookInstruction(
      tokenMint.publicKey,
      payer.publicKey,
      TOKEN_HOOK_PROGRAM_ID,
      SPL_TOKEN_2022,
    ),
    createInitializeMetadataPointerInstruction(
      tokenMint.publicKey,
      payer.publicKey,
      tokenMint.publicKey,
      SPL_TOKEN_2022,
    ),
    createInitializePermanentDelegateInstruction(
      tokenMint.publicKey,
      tokenState,
      SPL_TOKEN_2022,
    ),
    createInitializeMintInstruction(
      tokenMint.publicKey,
      6,
      tokenState,
      null,
      SPL_TOKEN_2022,
    ),
  );
  await provider.sendAndConfirm(createMintTx, [tokenMint]);

  await (tokenProgram.methods as unknown as {
    initializeToken: (
      tokenMint: PublicKey,
      name: string,
      symbol: string,
      decimals: number,
      isin: string,
      identityRegistry: PublicKey,
      compliance: PublicKey,
    ) => {
      accounts: (accounts: Record<string, unknown>) => { rpc(): Promise<string> };
    };
  })
    .initializeToken(
      tokenMint.publicKey,
      "Hook Debug Token",
      "HDBG",
      6,
      "US0000000000",
      payer.publicKey,
      complianceState,
    )
    .accounts({
      owner: payer.publicKey,
      tokenState,
      ownerState,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await (complianceProgram.methods as unknown as {
    initializeCompliance: (
      tokenMint: PublicKey,
    ) => {
      accounts: (accounts: Record<string, unknown>) => { rpc(): Promise<string> };
    };
  })
    .initializeCompliance(tokenMint.publicKey)
    .accounts({
      owner: payer.publicKey,
      complianceState,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const hookIx = await (hookProgram.methods as unknown as {
    initializeExtraAccountMetas: () => {
      accounts: (accounts: Record<string, unknown>) => {
        remainingAccounts: (
          accounts: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }>,
        ) => { instruction(): Promise<import("@solana/web3.js").TransactionInstruction> };
        instruction(): Promise<import("@solana/web3.js").TransactionInstruction>;
      };
    };
  })
    .initializeExtraAccountMetas()
    .accounts({
      payer: payer.publicKey,
      tokenState,
      ownerState,
      complianceState,
      tokenMintAccount: tokenMint.publicKey,
      extraAccountMetas,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const hookMessage = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latestBlockhash.blockhash,
    instructions: [hookIx],
  }).compileToV0Message();
  const hookTx = new VersionedTransaction(hookMessage);
  hookTx.sign([payer]);

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
        } | null>;
      };
    }>
  )(hookTx, {
    sigVerify: false,
    commitment: "confirmed",
    replaceRecentBlockhash: true,
    accounts: {
      addresses: [payer.publicKey.toBase58(), extraAccountMetas.toBase58()],
      encoding: "base64",
    },
  });

  const simulatedPayer = simulation.value.accounts?.[0] ?? null;
  const simulatedExtra = simulation.value.accounts?.[1] ?? null;
  const simulatedExtraDataLen = decodeSimulatedDataLength(simulatedExtra);
  const simulatedExtraRent =
    simulatedExtraDataLen > 0
      ? await connection.getMinimumBalanceForRentExemption(
          simulatedExtraDataLen,
          "confirmed",
        )
      : 0;

  console.log("\n=== Hook Init Simulation ===");
  console.log("err:", simulation.value.err);
  console.log("logs:\n" + (simulation.value.logs?.join("\n") ?? "(no logs)"));
  console.log("post-sim payer:", simulatedPayer);
  console.log("post-sim extra_account_metas:", simulatedExtra);
  console.log("post-sim extra_account_metas data length:", simulatedExtraDataLen);
  console.log("post-sim extra_account_metas rent minimum:", simulatedExtraRent);
  console.log(
    "post-sim extra_account_metas rent satisfied:",
    simulatedExtra ? simulatedExtra.lamports >= simulatedExtraRent : false,
  );

  if (hasFlag("--execute") && !simulation.value.err) {
    const executeTx = new Transaction().add(hookIx);
    const signature = await provider.sendAndConfirm(executeTx);
    const created = await connection.getAccountInfo(extraAccountMetas, "confirmed");
    console.log("\n=== Hook Init Execution ===");
    console.log("signature:", signature);
    console.log(
      "persisted extra_account_metas:",
      created
        ? {
            lamports: created.lamports,
            dataLength: created.data.length,
            owner: created.owner.toBase58(),
            executable: created.executable,
          }
        : null,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
