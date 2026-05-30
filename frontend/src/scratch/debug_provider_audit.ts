
// run command
// npx tsx src/scratch/debug_provider_audit.ts --wallet <KYC provider wallet address> --rpc https://capable-sleek-yard.solana-testnet.quiknode.pro/77ac010385eddc54513fc8d3daa9576cf9a93013

import { Connection, PublicKey, AccountInfo } from "@solana/web3.js";
import * as fs from "node:fs";
import * as path from "node:path";

const TOKEN_STATE_DISCRIMINATOR = Buffer.from([218, 112, 6, 149, 55, 186, 168, 163]);
const FACTORY_STATE_DISCRIMINATOR = Buffer.from([91, 157, 184, 99, 123, 112, 102, 7]);
const CLAIM_ACCOUNT_DISCRIMINATOR = Buffer.from([113, 109, 47, 96, 242, 219, 61, 165]);
const ISSUER_ENTRY_DISCRIMINATOR = Buffer.from([11, 211, 245, 253, 249, 156, 104, 93]);
const CLAIM_TOPIC_INDEX_DISCRIMINATOR = Buffer.from([188, 122, 139, 30, 73, 58, 165, 201]);
const CLAIM_ACCOUNT_SIZE = 230;
const TOPIC_KYC = BigInt(1);
const TOPIC_AML = BigInt(2);

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

type TokenRow = {
  mint: PublicKey;
  name: string;
  symbol: string;
  isin: string;
  decimals: number;
  paused: boolean;
  irpState: PublicKey;
  tirState: PublicKey;
  ctrState: PublicKey;
  requiredTopics: string[];
};

type WalletIdentityRow = {
  wallet: PublicKey;
  fid: PublicKey;
  country: number;
  irs: PublicKey;
  isActive: boolean;
};

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

function readU8(data: Buffer, offset: number) {
  return data.readUInt8(offset);
}

function readU16(data: Buffer, offset: number) {
  return data.readUInt16LE(offset);
}

function readU32(data: Buffer, offset: number) {
  return data.readUInt32LE(offset);
}

function readU64(data: Buffer, offset: number) {
  return data.readBigUInt64LE(offset);
}

function readI64(data: Buffer, offset: number) {
  return data.readBigInt64LE(offset);
}

function readString(data: Buffer, offset: number) {
  const length = readU32(data, offset);
  const start = offset + 4;
  const end = start + length;
  return { value: data.subarray(start, end).toString("utf8"), nextOffset: end };
}

function readVecU64(data: Buffer, offset: number) {
  const length = readU32(data, offset);
  let nextOffset = offset + 4;
  const value: bigint[] = [];
  for (let index = 0; index < length; index += 1) {
    value.push(readU64(data, nextOffset));
    nextOffset += 8;
  }
  return { value, nextOffset };
}

function hasDiscriminator(data: Buffer, discriminator: Buffer) {
  return data.length >= 8 && data.subarray(0, 8).equals(discriminator);
}

function derive(seed: string, values: PublicKey[], programId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(seed), ...values.map((value) => value.toBuffer())],
    programId,
  )[0];
}

function parseFactoryState(data: Buffer) {
  if (!hasDiscriminator(data, FACTORY_STATE_DISCRIMINATOR)) return null;
  let offset = 8;
  const owner = readPubkey(data, offset); offset += 32;
  const token = readPubkey(data, offset); offset += 32;
  const fid = readPubkey(data, offset); offset += 32;
  const irp = readPubkey(data, offset); offset += 32;
  const irs = readPubkey(data, offset); offset += 32;
  const tir = readPubkey(data, offset); offset += 32;
  const ctr = readPubkey(data, offset); offset += 32;
  const compliance = readPubkey(data, offset);
  return { owner, token, fid, irp, irs, tir, ctr, compliance };
}

function parseTokenState(data: Buffer) {
  if (!hasDiscriminator(data, TOKEN_STATE_DISCRIMINATOR)) return null;
  let offset = 8;
  const tokenMint = readPubkey(data, offset); offset += 32;
  const identityRegistry = readPubkey(data, offset); offset += 32;
  const compliance = readPubkey(data, offset); offset += 32;
  const paused = readU8(data, offset) === 1; offset += 1;
  const decimals = readU8(data, offset); offset += 1;
  const name = readString(data, offset); offset = name.nextOffset;
  const symbol = readString(data, offset); offset = symbol.nextOffset;
  const isin = readString(data, offset);
  return {
    tokenMint,
    identityRegistry,
    compliance,
    paused,
    decimals,
    name: name.value,
    symbol: symbol.value,
    isin: isin.value,
  };
}

function parseIrpState(data: Buffer) {
  return {
    tokenMint: readPubkey(data, 8),
    owner: readPubkey(data, 40),
    irsState: readPubkey(data, 72),
    tirState: readPubkey(data, 104),
    ctrState: readPubkey(data, 136),
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
    claimCount: readU32(data, 104),
    isIssuer: readU8(data, 108) === 1,
    country: readU16(data, 109),
  };
}

function parseClaim(data: Buffer) {
  if (data.length < CLAIM_ACCOUNT_SIZE || !hasDiscriminator(data, CLAIM_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }
  let offset = 8;
  const fid = readPubkey(data, offset); offset += 32;
  const claimId = readU32(data, offset); offset += 4;
  const topic = readU64(data, offset); offset += 8;
  const issuerFid = readPubkey(data, offset); offset += 32;
  offset += 32; // data_hash
  const signerKey = readPubkey(data, offset); offset += 32;
  offset += 64; // signature
  const issuedAt = readI64(data, offset); offset += 8;
  const expiresAt = readI64(data, offset); offset += 8;
  const revoked = readU8(data, offset) === 1;
  return { fid, claimId, topic, issuerFid, signerKey, issuedAt, expiresAt, revoked };
}

function parseIssuerEntry(data: Buffer) {
  if (!hasDiscriminator(data, ISSUER_ENTRY_DISCRIMINATOR)) return null;
  let offset = 8;
  const issuerFid = readPubkey(data, offset); offset += 32;
  const tir = readPubkey(data, offset); offset += 32;
  const topics = readVecU64(data, offset); offset = topics.nextOffset;
  const isActive = readU8(data, offset) === 1; offset += 1;
  const label = readString(data, offset); offset = label.nextOffset;
  const bump = readU8(data, offset);
  return { issuerFid, tir, topics: topics.value, isActive, label: label.value, bump };
}

function parseClaimTopicIndex(data: Buffer) {
  if (!hasDiscriminator(data, CLAIM_TOPIC_INDEX_DISCRIMINATOR)) return null;
  let offset = 8;
  const targetFid = readPubkey(data, offset); offset += 32;
  const issuerFid = readPubkey(data, offset); offset += 32;
  const topic = readU64(data, offset); offset += 8;
  const activeClaim = readPubkey(data, offset); offset += 32;
  const activeClaimId = readU32(data, offset); offset += 4;
  const isActive = readU8(data, offset) === 1;
  return { targetFid, issuerFid, topic, activeClaim, activeClaimId, isActive };
}

function parseWalletIdentity(data: Buffer) {
  if (data.length < 107) return null;
  let offset = 8;
  const wallet = readPubkey(data, offset); offset += 32;
  const fid = readPubkey(data, offset); offset += 32;
  const country = readU16(data, offset); offset += 2;
  const irs = readPubkey(data, offset); offset += 32;
  const isActive = data.length > 106 ? readU8(data, 106) === 1 : false;
  return { wallet, fid, country, irs, isActive };
}

function formatTopics(topics: bigint[]) {
  return topics.map((topic) => topic.toString()).join(", ") || "(none)";
}

function encodeU64(value: bigint) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value, 0);
  return bytes;
}

function short(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

// ─── Chunk helpers for free-RPC safety ──────────────────────────────────────

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
    arr.slice(i * size, i * size + size)
  );
}

async function getMultipleAccountsInfoChunked(
  connection: Connection,
  pubkeys: PublicKey[],
  commitment: "confirmed" | "finalized" | "processed" = "confirmed",
  chunkSize = 5,
  delayMs = 100,
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (pubkeys.length === 0) return [];
  const chunks = chunkArray(pubkeys, chunkSize);
  const results: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunkResults = await connection.getMultipleAccountsInfo(chunks[i], commitment);
    results.push(...chunkResults);
    if (i < chunks.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────

async function resolveProgramIds(connection: Connection, factory: PublicKey): Promise<ProgramIds> {
  const fallback = {
    factory,
    token: new PublicKey(process.env.NEXT_PUBLIC_TOKEN_PROGRAM_ID ?? "92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s"),
    fid: new PublicKey(process.env.NEXT_PUBLIC_FID_PROGRAM_ID ?? "EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB"),
    irp: new PublicKey(process.env.NEXT_PUBLIC_IRP_PROGRAM_ID ?? "C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o"),
    irs: new PublicKey(process.env.NEXT_PUBLIC_IRS_PROGRAM_ID ?? "GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ"),
    tir: new PublicKey(process.env.NEXT_PUBLIC_TIR_PROGRAM_ID ?? "8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ"),
    ctr: new PublicKey(process.env.NEXT_PUBLIC_CTR_PROGRAM_ID ?? "12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS"),
    compliance: new PublicKey(process.env.NEXT_PUBLIC_COMPLIANCE_PROGRAM_ID ?? "FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj"),
  };
  const factoryState = derive("factory_state", [], factory);
  const info = await connection.getAccountInfo(factoryState, "confirmed");
  if (!info) return fallback;
  const parsed = parseFactoryState(info.data);
  return parsed ? { factory, ...parsed } : fallback;
}

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "..", "backend", ".env"));

  const providerWallet = new PublicKey(requiredArg("wallet"));
  const scopedTokenMintArg = arg("token");
  const rpc =
    arg("rpc") ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL1;
  const factory = new PublicKey(
    arg("factory") ??
      process.env.NEXT_PUBLIC_FACTORY_PROGRAM_ID ??
      "6cGkK5skWBrpFWUvaerXvUejNa7etrWHisgrNjwPjdNe",
  );

  const connection = new Connection(rpc, "confirmed");
  const ids = await resolveProgramIds(connection, factory);
  const providerFid = derive("fid", [providerWallet], ids.fid);
  const providerFidInfo = await connection.getAccountInfo(providerFid, "confirmed");
  const providerFidParsed = providerFidInfo ? parseFid(providerFidInfo.data) : null;
  const now = BigInt(Math.floor(Date.now() / 1000));

  const [tokenAccounts, issuerEntryAccounts, claimAccounts] = await Promise.all([
    connection.getProgramAccounts(ids.token, { commitment: "confirmed" }),
    connection.getProgramAccounts(ids.tir, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 8, bytes: providerFid.toBase58() } }],
    }),
    connection.getProgramAccounts(ids.fid, {
      commitment: "confirmed",
      filters: [
        { dataSize: CLAIM_ACCOUNT_SIZE },
        { memcmp: { offset: 52, bytes: providerFid.toBase58() } },
      ],
    }),
  ]);

  const tokenRows: TokenRow[] = tokenAccounts
    .map(({ account }) => parseTokenState(account.data))
    .filter((row): row is NonNullable<typeof row> => !!row)
    .map((row) => {
      const tirState = derive("tir_state", [row.tokenMint], ids.tir);
      const ctrState = derive("ctr_state", [row.tokenMint], ids.ctr);
      return {
        mint: row.tokenMint,
        name: row.name,
        symbol: row.symbol,
        isin: row.isin,
        decimals: row.decimals,
        paused: row.paused,
        irpState: row.identityRegistry,
        tirState,
        ctrState,
        requiredTopics: [],
      };
    });

  // ─── Chunked getMultipleAccountsInfo call ──────────────────────────────────
  const ctrInfos = tokenRows.length
    ? await getMultipleAccountsInfoChunked(
        connection,
        tokenRows.map((row) => row.ctrState),
        "confirmed",
        5,   // chunk size (QuickNode free limit)
        100, // ms delay between chunks
      )
    : [];
  // ──────────────────────────────────────────────────────────────────────────

  tokenRows.forEach((row, index) => {
    row.requiredTopics = ctrInfos[index] ? parseCtrTopics(ctrInfos[index]!.data).map(String) : [];
  });

  const tokenByTir = new Map(tokenRows.map((row) => [row.tirState.toBase58(), row]));
  const parsedEntries = issuerEntryAccounts
    .map(({ pubkey, account }) => ({ pubkey, parsed: parseIssuerEntry(account.data) }))
    .filter((row): row is { pubkey: PublicKey; parsed: NonNullable<ReturnType<typeof parseIssuerEntry>> } => !!row.parsed);

  const trustAssignments = parsedEntries.map(({ pubkey, parsed }) => {
    const token = tokenByTir.get(parsed.tir.toBase58());
    return {
      issuerEntry: pubkey.toBase58(),
      active: String(parsed.isActive),
      topics: formatTopics(parsed.topics),
      label: parsed.label || "(none)",
      tokenMint: token?.mint.toBase58() ?? "unknown",
      tokenSymbol: token?.symbol ?? "unknown",
      tokenName: token?.name ?? "unknown",
      tokenPaused: token ? String(token.paused) : "unknown",
      requiredTopics: token?.requiredTopics.join(", ") || "(none)",
      roles: [
        parsed.topics.some((topic) => topic === TOPIC_KYC) ? "KYC" : null,
        parsed.topics.some((topic) => topic === TOPIC_AML) ? "AML" : null,
      ].filter(Boolean).join(", ") || "(custom-only)",
    };
  });

  const uniqueTrustedTopics = Array.from(
    new Set(parsedEntries.flatMap((row) => row.parsed.topics.map((topic) => topic.toString()))),
  ).sort((a, b) => Number(a) - Number(b));

  const parsedClaims = claimAccounts
    .map(({ pubkey, account }) => ({ pubkey, account, parsed: parseClaim(account.data) }))
    .filter((row): row is { pubkey: PublicKey; account: typeof claimAccounts[number]["account"]; parsed: NonNullable<ReturnType<typeof parseClaim>> } => !!row.parsed);

  const providerClaimRows = await Promise.all(
    parsedClaims.map(async ({ pubkey, account, parsed }) => {
      const investorFidInfo = await connection.getAccountInfo(parsed.fid, "confirmed");
      const investorFid = investorFidInfo ? parseFid(investorFidInfo.data) : null;
      const claimTopicIndex = PublicKey.findProgramAddressSync(
        [
          Buffer.from("claim_topic_index"),
          parsed.fid.toBuffer(),
          parsed.issuerFid.toBuffer(),
          encodeU64(parsed.topic),
        ],
        ids.fid,
      )[0];
      const indexInfo = await connection.getAccountInfo(claimTopicIndex, "confirmed");
      const parsedIndex = indexInfo ? parseClaimTopicIndex(indexInfo.data) : null;
      const signerMatches = providerFidParsed?.signerKey.equals(parsed.signerKey) ?? false;
      const expired = parsed.expiresAt !== BigInt(0) && parsed.expiresAt < now;
      const tokenCoverage = trustAssignments
        .filter((row) => row.active === "true" && row.topics.split(", ").includes(parsed.topic.toString()))
        .map((row) => `${row.tokenSymbol} ${short(row.tokenMint)}`);
      return {
        claim: pubkey.toBase58(),
        investorWallet: investorFid?.owner.toBase58() ?? "unknown",
        investorFid: parsed.fid.toBase58(),
        topic: parsed.topic.toString(),
        claimId: parsed.claimId.toString(),
        revoked: String(parsed.revoked),
        expired: String(expired),
        issuedAt: parsed.issuedAt.toString(),
        expiresAt: parsed.expiresAt.toString(),
        claimSignerKey: parsed.signerKey.toBase58(),
        issuerSignerKey: providerFidParsed?.signerKey.toBase58() ?? "missing",
        signerMatches: String(signerMatches),
        claimTopicIndex: claimTopicIndex.toBase58(),
        claimTopicIndexExists: String(Boolean(indexInfo)),
        claimTopicIndexActive: parsedIndex ? String(parsedIndex.isActive) : "missing",
        activeClaimMatches: parsedIndex ? String(parsedIndex.activeClaim.equals(pubkey)) : "missing",
        tokenCoverage: tokenCoverage.join(" | ") || "(not trusted in any token entry)",
        accountOwner: account.owner.toBase58(),
      };
    }),
  );

  const investorsWithClaims = Array.from(
    new Set(providerClaimRows.map((row) => row.investorWallet).filter((value) => value !== "unknown")),
  );

  let tokenScopedSummary:
    | {
        token: TokenRow;
        providerEntry: typeof trustAssignments[number] | null;
        investors: Array<{
          investorWallet: string;
          investorFid: string;
          identityActive: string;
          country: string;
          providerClaimCount: string;
          providerTopics: string;
          providerActiveTopics: string;
          signerMismatchClaims: string;
          validForThisTokenTopics: string;
        }>;
      }
    | null = null;

  if (scopedTokenMintArg) {
    const scopedTokenMint = new PublicKey(scopedTokenMintArg);
    const scopedToken =
      tokenRows.find((row) => row.mint.equals(scopedTokenMint)) ??
      (() => {
        const tirState = derive("tir_state", [scopedTokenMint], ids.tir);
        const ctrState = derive("ctr_state", [scopedTokenMint], ids.ctr);
        const tokenState = derive("token_state", [scopedTokenMint], ids.token);
        return {
          mint: scopedTokenMint,
          name: "(unknown)",
          symbol: "(unknown)",
          isin: "",
          decimals: 0,
          paused: false,
          irpState: tokenState,
          tirState,
          ctrState,
          requiredTopics: [],
        } satisfies TokenRow;
      })();

    const irpInfo = await connection.getAccountInfo(scopedToken.irpState, "confirmed");
    if (!irpInfo) {
      throw new Error(`IRP state not found for token ${scopedTokenMint.toBase58()}`);
    }
    const irp = parseIrpState(irpInfo.data);
    const providerEntry = trustAssignments.find((row) => row.tokenMint === scopedTokenMint.toBase58()) ?? null;

    const walletIdentityAccounts = await connection.getProgramAccounts(ids.irs, {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: 74, bytes: irp.irsState.toBase58() } }],
    });
    const identities = walletIdentityAccounts
      .map(({ account }) => parseWalletIdentity(account.data))
      .filter((row): row is WalletIdentityRow => !!row);

    const scopedInvestors = await Promise.all(
      identities.map(async (identity) => {
        const fidInfo = await connection.getAccountInfo(identity.fid, "confirmed");
        const fidParsed = fidInfo ? parseFid(fidInfo.data) : null;
        const claimPdas = fidParsed
          ? Array.from({ length: fidParsed.claimCount }, (_, index) =>
              PublicKey.findProgramAddressSync(
                [Buffer.from("claim"), identity.fid.toBuffer(), (() => {
                  const bytes = Buffer.alloc(4);
                  bytes.writeUInt32LE(index, 0);
                  return bytes;
                })()],
                ids.fid,
              )[0],
            )
          : [];
        const claimInfos = claimPdas.length
          ? await getMultipleAccountsInfoChunked(connection, claimPdas, "confirmed", 10, 50)
          : [];
        const providerClaims = claimInfos
          .map((info, index) => {
            const parsed = info ? parseClaim(info.data) : null;
            return parsed ? { parsed, pubkey: claimPdas[index] } : null;
          })
          .filter((row): row is { parsed: NonNullable<ReturnType<typeof parseClaim>>; pubkey: PublicKey } => !!row)
          .filter((row) => row.parsed.issuerFid.equals(providerFid));

        const providerClaimDetails = await Promise.all(
          providerClaims.map(async ({ parsed, pubkey }) => {
            const claimTopicIndex = PublicKey.findProgramAddressSync(
              [
                Buffer.from("claim_topic_index"),
                parsed.fid.toBuffer(),
                parsed.issuerFid.toBuffer(),
                encodeU64(parsed.topic),
              ],
              ids.fid,
            )[0];
            const indexInfo = await connection.getAccountInfo(claimTopicIndex, "confirmed");
            const parsedIndex = indexInfo ? parseClaimTopicIndex(indexInfo.data) : null;
            const expired = parsed.expiresAt !== BigInt(0) && parsed.expiresAt < now;
            const signerMatches = providerFidParsed?.signerKey.equals(parsed.signerKey) ?? false;
            const topicTrustedForToken = providerEntry
              ? providerEntry.topics.split(", ").includes(parsed.topic.toString()) && providerEntry.active === "true"
              : false;
            const topicRequiredForToken = scopedToken.requiredTopics.includes(parsed.topic.toString());
            const validForThisToken =
              !parsed.revoked &&
              !expired &&
              signerMatches &&
              topicTrustedForToken &&
              topicRequiredForToken &&
              Boolean(parsedIndex?.isActive) &&
              Boolean(parsedIndex?.activeClaim.equals(pubkey));
            return {
              topic: parsed.topic.toString(),
              revoked: parsed.revoked,
              expired,
              signerMatches,
              validForThisToken,
            };
          }),
        );

        const activeTopics = providerClaimDetails
          .filter((row) => !row.revoked && !row.expired)
          .map((row) => row.topic);
        const validTopics = providerClaimDetails
          .filter((row) => row.validForThisToken)
          .map((row) => row.topic);

        return {
          investorWallet: identity.wallet.toBase58(),
          investorFid: identity.fid.toBase58(),
          identityActive: String(identity.isActive),
          country: identity.country.toString(),
          providerClaimCount: providerClaimDetails.length.toString(),
          providerTopics: Array.from(new Set(providerClaimDetails.map((row) => row.topic))).join(", ") || "(none)",
          providerActiveTopics: Array.from(new Set(activeTopics)).join(", ") || "(none)",
          signerMismatchClaims: providerClaimDetails.filter((row) => !row.signerMatches).length.toString(),
          validForThisTokenTopics: Array.from(new Set(validTopics)).join(", ") || "(none)",
        };
      }),
    );

    tokenScopedSummary = {
      token: scopedToken,
      providerEntry,
      investors: scopedInvestors,
    };
  }

  console.log("\n=== FRACKS Provider Audit ===");
  console.log("RPC:", rpc);
  console.log("Provider wallet:", providerWallet.toBase58());
  console.log("Provider FID:", providerFid.toBase58());

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

  console.log("\nProvider FID:");
  console.table({
    fidExists: String(Boolean(providerFidInfo)),
    ownerProgram: providerFidInfo?.owner.toBase58() ?? "missing",
    ownerWallet: providerFidParsed?.owner.toBase58() ?? "missing",
    managementKey: providerFidParsed?.managementKey.toBase58() ?? "missing",
    signerKey: providerFidParsed?.signerKey.toBase58() ?? "missing",
    claimCount: providerFidParsed?.claimCount.toString() ?? "0",
    isIssuer: providerFidParsed ? String(providerFidParsed.isIssuer) : "missing",
    country: providerFidParsed?.country.toString() ?? "missing",
  });

  console.log("\nTrusted Topics Summary:");
  console.table({
    trustedTopics: uniqueTrustedTopics.join(", ") || "(none)",
    isKycProviderAnywhere: String(uniqueTrustedTopics.includes("1")),
    isAmlProviderAnywhere: String(uniqueTrustedTopics.includes("2")),
    trustedTokenCount: trustAssignments.length.toString(),
    issuedClaimCount: providerClaimRows.length.toString(),
    uniqueInvestorsWithClaims: investorsWithClaims.length.toString(),
  });

  console.log("\nTrusted Token Assignments:");
  if (trustAssignments.length === 0) {
    console.log("No on-chain TIR issuer entries found for this provider FID.");
  } else {
    console.table(trustAssignments);
  }

  console.log("\nClaims Issued By This Provider FID:");
  if (providerClaimRows.length === 0) {
    console.log("No ClaimAccount PDAs found with this issuer FID.");
  } else {
    for (const row of providerClaimRows) {
      console.table(row);
    }
  }

  console.log("\nInvestor Summary:");
  if (providerClaimRows.length === 0) {
    console.log("No investors found.");
  } else {
    const summary = investorsWithClaims.map((investorWallet) => {
      const rows = providerClaimRows.filter((row) => row.investorWallet === investorWallet);
      const activeTopics = rows
        .filter((row) => row.revoked === "false" && row.expired === "false")
        .map((row) => row.topic);
      return {
        investorWallet,
        investorFids: Array.from(new Set(rows.map((row) => row.investorFid))).join(", "),
        claimCount: rows.length.toString(),
        activeTopics: Array.from(new Set(activeTopics)).join(", ") || "(none)",
        signerMismatchClaims: rows.filter((row) => row.signerMatches === "false").length.toString(),
      };
    });
    console.table(summary);
  }

  if (tokenScopedSummary) {
    console.log("\nToken-Scoped Exhaustive Audit:");
    console.table({
      tokenMint: tokenScopedSummary.token.mint.toBase58(),
      tokenSymbol: tokenScopedSummary.token.symbol,
      tokenName: tokenScopedSummary.token.name,
      providerTrustedEntry: tokenScopedSummary.providerEntry?.issuerEntry ?? "missing",
      providerTrustedTopics: tokenScopedSummary.providerEntry?.topics ?? "(none)",
      providerEntryActive: tokenScopedSummary.providerEntry?.active ?? "false",
      tokenRequiredTopics: tokenScopedSummary.token.requiredTopics.join(", ") || "(none)",
      tokenPaused: String(tokenScopedSummary.token.paused),
      investorCountInIrs: tokenScopedSummary.investors.length.toString(),
    });
    console.table(tokenScopedSummary.investors);
  }

  console.log("\nRun this when a provider wallet looks misconfigured or a claim was issued but does not verify.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
