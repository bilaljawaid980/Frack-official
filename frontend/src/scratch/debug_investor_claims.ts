import { Connection, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";

type ProgramIds = {
  factory: PublicKey;
  token: PublicKey;
  fid: PublicKey;
  irp: PublicKey;
  irs: PublicKey;
  tir: PublicKey;
  ctr: PublicKey;
  compliance: PublicKey;
};

const CLAIM_ACCOUNT_SIZE =
  8 + 32 + 4 + 8 + 32 + 32 + 32 + 64 + 8 + 8 + 1 + 1;
const CLAIM_ACCOUNT_DISCRIMINATOR = Buffer.from([
  113, 109, 47, 96, 242, 219, 61, 165,
]);

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return;
  const contents = fs.readFileSync(file, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed
      .slice(index + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

function requiredArg(name: string) {
  const value = arg(name);
  if (!value) {
    throw new Error(`Missing --${name}. Example: --${name} <base58>`);
  }
  return value;
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function u32Le(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value, 0);
  return bytes;
}

function ownerLabel(info: Awaited<ReturnType<Connection["getAccountInfo"]>>) {
  return info ? info.owner.toBase58() : "missing";
}

function derive(seed: string, values: PublicKey[], programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...values.map((value) => value.toBuffer())],
    programId,
  )[0];
}

function parseFactoryState(data: Buffer) {
  let offset = 8;
  const owner = readPubkey(data, offset);
  offset += 32;
  const token = readPubkey(data, offset);
  offset += 32;
  const fid = readPubkey(data, offset);
  offset += 32;
  const irp = readPubkey(data, offset);
  offset += 32;
  const irs = readPubkey(data, offset);
  offset += 32;
  const tir = readPubkey(data, offset);
  offset += 32;
  const ctr = readPubkey(data, offset);
  offset += 32;
  const compliance = readPubkey(data, offset);
  return { owner, token, fid, irp, irs, tir, ctr, compliance };
}

function parseTokenState(data: Buffer) {
  let offset = 8;
  const tokenMint = readPubkey(data, offset);
  offset += 32;
  const identityRegistry = readPubkey(data, offset);
  offset += 32;
  const compliance = readPubkey(data, offset);
  offset += 32;
  const paused = data.readUInt8(offset) === 1;
  offset += 1;
  const decimals = data.readUInt8(offset);
  return { tokenMint, identityRegistry, compliance, paused, decimals };
}

function parseIrpState(data: Buffer) {
  return {
    tokenMint: readPubkey(data, 8),
    owner: readPubkey(data, 40),
    irsState: readPubkey(data, 72),
  };
}

function parseOwnerState(data: Buffer) {
  return {
    owner: readPubkey(data, 8),
    tokenMint: readPubkey(data, 40),
  };
}

function parseWalletIdentity(data: Buffer) {
  return {
    wallet: readPubkey(data, 8),
    fid: readPubkey(data, 40),
    country: data.readUInt16LE(72),
    irs: readPubkey(data, 74),
    isActive: data.length > 106 ? data.readUInt8(106) === 1 : false,
    activatedBy: data.length >= 139 ? readPubkey(data, 107) : null,
  };
}

function parseCtrTopics(data: Buffer) {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return [];
  const count = data.readUInt32LE(offset);
  offset += 4;
  const topics: bigint[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.length < offset + 8) break;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }
  return topics;
}

function parseFid(data: Buffer) {
  return {
    owner: readPubkey(data, 8),
    managementKey: readPubkey(data, 40),
    signerKey: readPubkey(data, 72),
    claimCount: data.readUInt32LE(104),
    isIssuer: data.readUInt8(108) === 1,
    country: data.readUInt16LE(109),
  };
}

function parseClaim(data: Buffer) {
  if (
    data.length < CLAIM_ACCOUNT_SIZE ||
    !data.subarray(0, 8).equals(CLAIM_ACCOUNT_DISCRIMINATOR)
  ) {
    return null;
  }
  let offset = 8;
  const fid = readPubkey(data, offset);
  offset += 32;
  const claimId = data.readUInt32LE(offset);
  offset += 4;
  const topic = data.readBigUInt64LE(offset);
  offset += 8;
  const issuerFid = readPubkey(data, offset);
  offset += 32 + 32;
  const signerKey = readPubkey(data, offset);
  offset += 32 + 64 + 8;
  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;
  const revoked = data.readUInt8(offset) === 1;
  return { fid, claimId, topic, issuerFid, signerKey, expiresAt, revoked };
}

function parseIssuerEntry(data: Buffer, topic: bigint) {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return { active: false, hasTopic: false };
  const count = data.readUInt32LE(offset);
  offset += 4;
  let hasTopic = false;
  const topics: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.length < offset + 8) break;
    const entryTopic = data.readBigUInt64LE(offset);
    topics.push(entryTopic.toString());
    if (entryTopic === topic) hasTopic = true;
    offset += 8;
  }
  const active = data.length > offset && data.readUInt8(offset) === 1;
  return { active, hasTopic, topics };
}

async function resolveProgramIds(connection: Connection, factory: PublicKey): Promise<ProgramIds> {
  const fallback = {
    factory,
    token: new PublicKey(
      process.env.NEXT_PUBLIC_TOKEN_PROGRAM_ID ??
        "92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s",
    ),
    fid: new PublicKey(
      process.env.NEXT_PUBLIC_FID_PROGRAM_ID ??
        "EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB",
    ),
    irp: new PublicKey(
      process.env.NEXT_PUBLIC_IRP_PROGRAM_ID ??
        "C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o",
    ),
    irs: new PublicKey(
      process.env.NEXT_PUBLIC_IRS_PROGRAM_ID ??
        "GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ",
    ),
    tir: new PublicKey(
      process.env.NEXT_PUBLIC_TIR_PROGRAM_ID ??
        "8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ",
    ),
    ctr: new PublicKey(
      process.env.NEXT_PUBLIC_CTR_PROGRAM_ID ??
        "12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS",
    ),
    compliance: new PublicKey(
      process.env.NEXT_PUBLIC_COMPLIANCE_PROGRAM_ID ??
        "FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj",
    ),
  };
  const factoryState = derive("factory_state", [], factory);
  const info = await connection.getAccountInfo(factoryState, "confirmed");
  if (!info) return fallback;
  const parsed = parseFactoryState(info.data);
  return { factory, ...parsed };
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "..", "backend", ".env"));

  const tokenMint = new PublicKey(requiredArg("token"));
  const wallet = new PublicKey(requiredArg("wallet"));
  const rpc =
    arg("rpc") ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL1 ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    process.env.SOLANA_RPC_URL1 ??
    "https://devnet.helius-rpc.com/?api-key=f2852f85-8a60-4eaf-bbe7-009aa1b9e41f/";
  const factory = new PublicKey(
    arg("factory") ??
      process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID ??
      "6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe",
  );
  const connection = new Connection(rpc, "confirmed");
  const ids = await resolveProgramIds(connection, factory);

  const tokenState = derive("token_state", [tokenMint], ids.token);
  const tokenStateInfo = await connection.getAccountInfo(tokenState, "confirmed");
  if (!tokenStateInfo) {
    throw new Error(`Token state not found: ${tokenState.toBase58()}`);
  }
  const token = parseTokenState(tokenStateInfo.data);
  const irpInfo = await connection.getAccountInfo(token.identityRegistry, "confirmed");
  if (!irpInfo) throw new Error(`IRP state not found: ${token.identityRegistry.toBase58()}`);
  const irp = parseIrpState(irpInfo.data);
  const irsInfo = await connection.getAccountInfo(irp.irsState, "confirmed");
  const tirState = derive("tir_state", [tokenMint], ids.tir);
  const ctrState = derive("ctr_state", [tokenMint], ids.ctr);
  const [fid] = PublicKey.findProgramAddressSync(
    [Buffer.from("fid"), wallet.toBuffer()],
    ids.fid,
  );
  const [walletIdentity] = PublicKey.findProgramAddressSync(
    [Buffer.from("wallet_identity"), irp.irsState.toBuffer(), wallet.toBuffer()],
    ids.irs,
  );

  const [fidInfo, walletIdentityInfo, ctrInfo] = await connection.getMultipleAccountsInfo(
    [fid, walletIdentity, ctrState],
    "confirmed",
  );
  const fidParsed = fidInfo ? parseFid(fidInfo.data) : null;
  const identityParsed = walletIdentityInfo ? parseWalletIdentity(walletIdentityInfo.data) : null;
  const requiredTopics = ctrInfo ? parseCtrTopics(ctrInfo.data) : [];
  const claims = fidParsed
    ? await connection.getProgramAccounts(ids.fid, {
        commitment: "confirmed",
        filters: [
          { dataSize: CLAIM_ACCOUNT_SIZE },
          { memcmp: { offset: 8, bytes: fid.toBase58() } },
        ],
      })
    : [];
  const parsedClaims = claims
    .map(({ pubkey, account }) => ({ pubkey, account, parsed: parseClaim(account.data) }))
    .filter((item) => item.parsed !== null);
  const now = BigInt(Math.floor(Date.now() / 1000));

  console.log("\n=== FRACKS Investor Claim Debug ===");
  console.log("RPC:", rpc);
  console.log("Token mint:", tokenMint.toBase58());
  console.log("Investor wallet:", wallet.toBase58());
  console.log("\nProgram IDs:");
  console.table({
    factory: ids.factory.toBase58(),
    token: ids.token.toBase58(),
    fid: ids.fid.toBase58(),
    irp: ids.irp.toBase58(),
    irs: ids.irs.toBase58(),
    tir: ids.tir.toBase58(),
    ctr: ids.ctr.toBase58(),
    compliance: ids.compliance.toBase58(),
  });

  console.log("\nToken registry:");
  console.table({
    tokenState: tokenState.toBase58(),
    tokenStateOwner: ownerLabel(tokenStateInfo),
    irpState: token.identityRegistry.toBase58(),
    irpOwner: irp.owner.toBase58(),
    irsState: irp.irsState.toBase58(),
    irsOwner: irsInfo ? parseOwnerState(irsInfo.data).owner.toBase58() : "missing",
    tirState: tirState.toBase58(),
    ctrState: ctrState.toBase58(),
    complianceState: token.compliance.toBase58(),
    tokenPaused: String(token.paused),
    decimals: String(token.decimals),
    requiredTopics: requiredTopics.map(String).join(", ") || "(none)",
  });

  console.log("\nInvestor identity:");
  console.table({
    fid: fid.toBase58(),
    fidExists: String(Boolean(fidInfo)),
    fidOwnerProgram: ownerLabel(fidInfo),
    fidOwnerWallet: fidParsed?.owner.toBase58() ?? "missing",
    fidSignerKey: fidParsed?.signerKey.toBase58() ?? "missing",
    fidClaimCount: fidParsed?.claimCount?.toString() ?? "0",
    fidIsIssuer: fidParsed ? String(fidParsed.isIssuer) : "missing",
    fidCountry: fidParsed?.country?.toString() ?? "missing",
    walletIdentity: walletIdentity.toBase58(),
    walletIdentityExists: String(Boolean(walletIdentityInfo)),
    walletIdentityOwnerProgram: ownerLabel(walletIdentityInfo),
    walletIdentityActive: identityParsed ? String(identityParsed.isActive) : "missing",
    walletIdentityCountry: identityParsed?.country?.toString() ?? "missing",
    walletIdentityFid: identityParsed?.fid.toBase58() ?? "missing",
  });

  console.log("\nClaims:");
  if (parsedClaims.length === 0) {
    console.log("No ClaimAccount PDAs found for this investor FID.");
  }
  for (const { pubkey, account, parsed } of parsedClaims) {
    if (!parsed) continue;
    const issuerEntry = derive("issuer_entry", [tirState, parsed.issuerFid], ids.tir);
    const [claimTopicIndex] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_topic_index"),
        fid.toBuffer(),
        parsed.issuerFid.toBuffer(),
        (() => {
          const bytes = Buffer.alloc(8);
          bytes.writeBigUInt64LE(parsed.topic, 0);
          return bytes;
        })(),
      ],
      ids.fid,
    );
    const [issuerFidInfo, issuerEntryInfo, indexInfo] =
      await connection.getMultipleAccountsInfo(
        [parsed.issuerFid, issuerEntry, claimTopicIndex],
        "confirmed",
      );
    const issuerFid = issuerFidInfo ? parseFid(issuerFidInfo.data) : null;
    const entry = issuerEntryInfo
      ? parseIssuerEntry(issuerEntryInfo.data, parsed.topic)
      : null;
    const expired = parsed.expiresAt !== 0n && parsed.expiresAt < now;
    const signerMatches = issuerFid?.signerKey.equals(parsed.signerKey) ?? false;
    const trusted = Boolean(entry?.active && entry.hasTopic);
    const topicRequired = requiredTopics.some((topic) => topic === parsed.topic);
    const valid = topicRequired && !parsed.revoked && !expired && trusted && signerMatches;

    console.table({
      claim: pubkey.toBase58(),
      claimOwnerProgram: account.owner.toBase58(),
      claimId: parsed.claimId.toString(),
      topic: parsed.topic.toString(),
      topicRequired: String(topicRequired),
      revoked: String(parsed.revoked),
      expired: String(expired),
      expiresAt: parsed.expiresAt.toString(),
      issuerFid: parsed.issuerFid.toBase58(),
      issuerFidExists: String(Boolean(issuerFidInfo)),
      issuerFidIsIssuer: issuerFid ? String(issuerFid.isIssuer) : "missing",
      claimSignerKey: parsed.signerKey.toBase58(),
      issuerFidSignerKey: issuerFid?.signerKey.toBase58() ?? "missing",
      signerMatches: String(signerMatches),
      issuerEntry: issuerEntry.toBase58(),
      issuerEntryExists: String(Boolean(issuerEntryInfo)),
      issuerEntryTopics: entry?.topics?.join(", ") ?? "missing",
      issuerEntryActive: entry ? String(entry.active) : "missing",
      trustedForTopic: String(trusted),
      claimTopicIndex: claimTopicIndex.toBase58(),
      claimTopicIndexExists: String(Boolean(indexInfo)),
      validForThisToken: String(valid),
    });
  }

  console.log("\nTopic verdict:");
  for (const topic of requiredTopics) {
    const matches = parsedClaims.filter((item) => item.parsed?.topic === topic);
    if (matches.length === 0) {
      console.log(`- Topic ${topic}: MISSING`);
      continue;
    }
    console.log(`- Topic ${topic}: ${matches.length} claim(s) found. Inspect validForThisToken above.`);
  }
  console.log("\nRun this for both sender and recipient when a transfer fails.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
