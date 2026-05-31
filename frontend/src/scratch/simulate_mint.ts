import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { MOD_COUNTRY_CAP, RPC_URL } from "../lib/constants";
import { createReadonlyProvider } from "../lib/anchor";
import { fetchFactoryStateAccount } from "../lib/solana";
import { TokenService } from "../services/token";

const BACKEND_URL =
  process.env.BACKEND_URL ?? process.env.NEXT_PUBLIC_BACKEND_URL;
const CLAIM_ACCOUNT_SIZE = 230;
const MINT_DISCRIMINATOR = Buffer.from([51, 57, 225, 47, 182, 146, 137, 166]);

type CliArgs = {
  token?: string;
  investor?: string;
  issuer?: string;
  amount?: string;
};

type ParsedClaim = {
  pubkey: PublicKey;
  fid: PublicKey;
  claimId: number;
  topic: bigint;
  issuerFid: PublicKey;
  signerKey: PublicKey;
  revoked: boolean;
  expiresAt: bigint;
};

function parseArgs(): CliArgs {
  const args: CliArgs = {};
  for (let idx = 2; idx < process.argv.length; idx += 1) {
    const key = process.argv[idx];
    const value = process.argv[idx + 1];
    if (!value) continue;
    if (key === "--token") args.token = value;
    if (key === "--investor") args.investor = value;
    if (key === "--issuer") args.issuer = value;
    if (key === "--amount") args.amount = value;
  }
  return args;
}

function encodeU64(value: bigint): Buffer {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return Buffer.from(bytes);
}

function encodeMintArgs(recipient: PublicKey, amount: bigint, toBalanceAfter: bigint): Buffer {
  return Buffer.concat([
    MINT_DISCRIMINATOR,
    recipient.toBuffer(),
    encodeU64(amount),
    encodeU64(toBalanceAfter),
  ]);
}

function claimIdLeBytes(claimId: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(claimId, 0);
  return bytes;
}

function topicLeBytes(topic: bigint): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(topic);
  return bytes;
}

function amountToBaseUnits(amount: string, decimals: number): bigint {
  const [wholeRaw, fractionRaw = ""] = amount.trim().split(".");
  const whole = wholeRaw || "0";
  const fraction = fractionRaw.padEnd(decimals, "0").slice(0, decimals);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");
}

function parseClaimAccount(pubkey: PublicKey, data: Buffer): ParsedClaim | null {
  const minimumSize = 8 + 32 + 4 + 8 + 32 + 32 + 32 + 64 + 8 + 8 + 1 + 1;
  if (data.length < minimumSize) return null;
  let offset = 8;
  const fid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const claimId = data.readUInt32LE(offset);
  offset += 4;
  const topic = data.readBigUInt64LE(offset);
  offset += 8;
  const issuerFid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 32;
  const signerKey = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32 + 64 + 8;
  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;
  const revoked = data.readUInt8(offset) === 1;
  return { pubkey, fid, claimId, topic, issuerFid, signerKey, revoked, expiresAt };
}

function parseIssuerEntryForTopic(data: Buffer, topic: bigint): boolean {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return false;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;
  let hasTopic = false;
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) return false;
    if (data.readBigUInt64LE(offset) === topic) hasTopic = true;
    offset += 8;
  }
  return data.length >= offset + 1 && data.readUInt8(offset) === 1 && hasTopic;
}

function parseFidSigner(data: Buffer): { isIssuer: boolean; signerKey: PublicKey } | null {
  if (data.length < 8 + 32 + 32 + 32 + 4 + 1) return null;
  const signerKey = new PublicKey(data.subarray(72, 104));
  const isIssuer = data.readUInt8(108) === 1;
  return { isIssuer, signerKey };
}

async function loadRealRequestFromBackend(): Promise<CliArgs | null> {
  const response = await axios.get(`${BACKEND_URL}/token-purchase-requests`, { timeout: 5000 });
  const requests = Array.isArray(response.data) ? response.data : [];
  const request = requests.find((entry) =>
    ["APPROVED_FOR_MINT", "PENDING_ISSUER_REVIEW"].includes(entry.status),
  );
  if (!request?.tokenContract || !request?.investorWallet || !request?.issuerWallet || !request?.amount) {
    return null;
  }
  return {
    token: request.tokenContract,
    investor: request.investorWallet,
    issuer: request.issuerWallet,
    amount: String(request.amount),
  };
}

async function main() {
  const cliArgs = parseArgs();
  const hasCliArgs = Boolean(cliArgs.token || cliArgs.investor || cliArgs.issuer || cliArgs.amount);
  let args = cliArgs;

  if (!hasCliArgs) {
    try {
      const backendArgs = await loadRealRequestFromBackend();
      if (backendArgs) args = backendArgs;
    } catch {
      args = {};
    }
  }

  if (!args.token || !args.investor || !args.issuer || !args.amount) {
    throw new Error(
      "No explicit CLI args were provided and no real backend token purchase request was found. Cannot simulate mint with dummy data.",
    );
  }

  const connection = new Connection(RPC_URL, "confirmed");
  const provider = createReadonlyProvider(connection);
  const tokenService = new TokenService(provider);
  const factoryState = await fetchFactoryStateAccount();
  if (!factoryState) {
    throw new Error("Factory state could not be fetched. Cannot derive token-specific program IDs.");
  }

  // --token is the Token-2022 mint / backend tokenContract, not token_state.
  const mint = new PublicKey(args.token);
  const investor = new PublicKey(args.investor);
  const issuer = new PublicKey(args.issuer);

  const tokenStateData = await tokenService.fetchTokenState(mint);
  const amount = amountToBaseUnits(args.amount, tokenStateData.decimals);
  const destinationTokenAccount = getAssociatedTokenAddressSync(
    mint,
    investor,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const sharedPreflight = await tokenService.verifyRecipientMintPreflight(
    mint,
    investor,
    destinationTokenAccount,
  );

  const [tokenState] = tokenService.findTokenStatePda(mint, factoryState.tokenProgramId);
  const [ownerState] = tokenService.findOwnerStatePda(mint, factoryState.tokenProgramId);
  const [agentRole] = tokenService.findAgentRolePda(mint, issuer, factoryState.tokenProgramId);
  const [toFrozen] = tokenService.findFrozenWalletPda(mint, investor, factoryState.tokenProgramId);
  const toFrozenInfo = await connection.getAccountInfo(toFrozen, "confirmed");
  const toFrozenAccount =
    toFrozenInfo && toFrozenInfo.owner.equals(factoryState.tokenProgramId) && toFrozenInfo.data.length > 0
      ? toFrozen
      : SystemProgram.programId;

  const irpState = sharedPreflight.registry.irpState;
  const irp = {
    owner: sharedPreflight.registry.irpOwner,
    irsState: sharedPreflight.registry.irsState,
    tirState: sharedPreflight.registry.tirState,
    ctrState: sharedPreflight.registry.ctrState,
  };
  const walletIdentity = sharedPreflight.registry.walletIdentity;
  const walletIdentityData = sharedPreflight.registry.walletIdentityData;
  const requiredTopics = sharedPreflight.registry.requiredTopics;
  const claimAccounts = await connection.getProgramAccounts(factoryState.fidProgramId, {
    commitment: "confirmed",
    filters: [
      { dataSize: CLAIM_ACCOUNT_SIZE },
      { memcmp: { offset: 8, bytes: walletIdentityData.fid.toBase58() } },
    ],
  });
  const claims = claimAccounts
    .map(({ pubkey, account }) => parseClaimAccount(pubkey, account.data))
    .filter((claim): claim is ParsedClaim => claim !== null);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const validClaimAccounts: PublicKey[] = [];
  const claimTopicIndexes: PublicKey[] = [];
  const trustedIssuerEntries: PublicKey[] = [];
  const issuerFids: PublicKey[] = [];

  for (const topic of requiredTopics) {
    const topicClaims = claims.filter((claim) => claim.topic === topic);
    if (topicClaims.length === 0) {
      throw new Error(`Investor is missing claim for required topic ${topic}.`);
    }

    let valid = false;
    for (const claim of topicClaims) {
      const expired = claim.expiresAt !== 0n && claim.expiresAt < now;
      if (claim.revoked || expired) continue;
      const [expectedClaim] = PublicKey.findProgramAddressSync(
        [Buffer.from("claim"), walletIdentityData.fid.toBuffer(), claimIdLeBytes(claim.claimId)],
        factoryState.fidProgramId,
      );
      if (!claim.pubkey.equals(expectedClaim)) continue;
      const [claimTopicIndex] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("claim_topic_index"),
          walletIdentityData.fid.toBuffer(),
          claim.issuerFid.toBuffer(),
          topicLeBytes(topic),
        ],
        factoryState.fidProgramId,
      );

      const [issuerEntry] = PublicKey.findProgramAddressSync(
        [Buffer.from("issuer_entry"), irp.tirState.toBuffer(), claim.issuerFid.toBuffer()],
        factoryState.tirProgramId,
      );
      const [issuerEntryInfo, issuerFidInfo] = await connection.getMultipleAccountsInfo(
        [issuerEntry, claim.issuerFid],
        "confirmed",
      );
      const fidSigner = issuerFidInfo ? parseFidSigner(issuerFidInfo.data) : null;
      if (
        issuerEntryInfo &&
        parseIssuerEntryForTopic(issuerEntryInfo.data, topic) &&
        fidSigner?.isIssuer &&
        fidSigner.signerKey.equals(claim.signerKey)
      ) {
        valid = true;
        validClaimAccounts.push(claim.pubkey);
        claimTopicIndexes.push(claimTopicIndex);
        trustedIssuerEntries.push(issuerEntry);
        issuerFids.push(claim.issuerFid);
        break;
      }
    }

    if (!valid) {
      throw new Error(`Investor has no valid, unrevoked, unexpired, trusted claim for required topic ${topic}.`);
    }
  }

  const setupInstructions: TransactionInstruction[] = [];
  let toBalanceBefore = 0n;
  try {
    const ata = await getAccount(connection, destinationTokenAccount, "confirmed", TOKEN_2022_PROGRAM_ID);
    toBalanceBefore = ata.amount;
  } catch {
    setupInstructions.push(
      createAssociatedTokenAccountIdempotentInstruction(
        issuer,
        destinationTokenAccount,
        investor,
        mint,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  const toBalanceAfter = toBalanceBefore + amount;

  const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
  const seen = new Set<string>();
  const push = (pubkey: PublicKey, isWritable = false) => {
    const key = pubkey.toBase58();
    if (seen.has(key)) return;
    seen.add(key);
    remainingAccounts.push({ pubkey, isSigner: false, isWritable });
  };
  for (let index = 0; index < validClaimAccounts.length; index += 1) {
    push(validClaimAccounts[index]);
    push(claimTopicIndexes[index]);
    push(trustedIssuerEntries[index]);
    push(issuerFids[index]);
  }

  const complianceInfo = await connection.getAccountInfo(new PublicKey(tokenStateData.compliance), "confirmed");
  if (complianceInfo && complianceInfo.data.length >= 78) {
    let offset = 76;
    const moduleCount = complianceInfo.data.readUInt32LE(72);
    const modules: PublicKey[] = [];
    for (let index = 0; index < moduleCount; index += 1) {
      modules.push(new PublicKey(complianceInfo.data.subarray(offset, offset + 32)));
      offset += 32;
    }
    const moduleInfos = await connection.getMultipleAccountsInfo(modules, "confirmed");
    for (const [index, module] of modules.entries()) {
      push(module, true);
      const moduleInfo = moduleInfos[index];
      if (!moduleInfo) continue;
      push(moduleInfo.owner);
      if (moduleInfo.owner.equals(MOD_COUNTRY_CAP)) {
        const countryBytes = Buffer.alloc(2);
        countryBytes.writeUInt16LE(walletIdentityData.country);
        const [countryCount] = PublicKey.findProgramAddressSync(
          [Buffer.from("country_count"), module.toBuffer(), countryBytes],
          MOD_COUNTRY_CAP,
        );
        push(countryCount, true);
      }
    }
  }

  const finalAccounts = [
    { pubkey: issuer, isSigner: true, isWritable: true },
    { pubkey: tokenState, isSigner: false, isWritable: false },
    { pubkey: ownerState, isSigner: false, isWritable: false },
    { pubkey: agentRole, isSigner: false, isWritable: false },
    { pubkey: irpState, isSigner: false, isWritable: false },
    { pubkey: irp.irsState, isSigner: false, isWritable: false },
    { pubkey: irp.tirState, isSigner: false, isWritable: false },
    { pubkey: irp.ctrState, isSigner: false, isWritable: false },
    { pubkey: new PublicKey(tokenStateData.compliance), isSigner: false, isWritable: false },
    { pubkey: factoryState.complianceProgramId, isSigner: false, isWritable: false },
    { pubkey: walletIdentity, isSigner: false, isWritable: false },
    { pubkey: toFrozenAccount, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: true },
    { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
    { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ...remainingAccounts,
  ];

  const mintIx = new TransactionInstruction({
    programId: factoryState.tokenProgramId,
    keys: finalAccounts,
    data: encodeMintArgs(investor, amount, toBalanceAfter),
  });

  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: issuer,
    recentBlockhash: latest.blockhash,
  }).add(...setupInstructions, mintIx);
  const versioned = new VersionedTransaction(tx.compileMessage());
  const simulation = await connection.simulateTransaction(versioned, { sigVerify: false });

  console.log("\n[MINT SIMULATION SUMMARY]");
  console.log(`RPC: ${connection.rpcEndpoint}`);
  console.log(`Token: ${mint.toBase58()} (${tokenStateData.name} / ${tokenStateData.symbol})`);
  console.log(`Issuer: ${issuer.toBase58()}`);
  console.log(`Investor wallet owner: ${investor.toBase58()}`);
  console.log(`Amount base units: ${amount.toString()}`);
  console.log(`Recipient ATA: ${destinationTokenAccount.toBase58()}`);
  console.log(`Wallet identity PDA: ${walletIdentity.toBase58()}`);
  console.log(`Wallet identity FID: ${walletIdentityData.fid.toBase58()}`);
  console.log(`Wallet identity active: ${walletIdentityData.isActive}`);
  console.log(`Required topics: [${requiredTopics.map(String).join(", ")}]`);
  console.log(`Valid claims: [${validClaimAccounts.map((key) => key.toBase58()).join(", ")}]`);
  console.log(`Claim topic indexes: [${claimTopicIndexes.map((key) => key.toBase58()).join(", ")}]`);
  console.log(`Trusted issuer entries: [${trustedIssuerEntries.map((key) => key.toBase58()).join(", ")}]`);
  console.log(`Final accounts:`);
  finalAccounts.forEach((account, index) => {
    console.log(
      `  ${index}: ${account.pubkey.toBase58()} signer=${account.isSigner} writable=${account.isWritable}`,
    );
  });
  console.log(`Simulation error: ${JSON.stringify(simulation.value.err)}`);
  console.log(`Simulation logs:\n${(simulation.value.logs ?? []).map((line) => `  ${line}`).join("\n")}`);

  if (simulation.value.err) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
