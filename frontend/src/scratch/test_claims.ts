import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import anchor from "@coral-xyz/anchor";
const { BN } = anchor;

const BACKEND_URL = "http://localhost:4000";
const RPC_URL = "https://api.testnet.solana.com";

// Constants/Program IDs matching frontend/src/lib/constants.ts and token.ts
const FID_PROGRAM_ID = new PublicKey("EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB");
const IRS_PROGRAM_ID = new PublicKey("GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ");
const TIR_PROGRAM_ID = new PublicKey("8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ");
const CTR_PROGRAM_ID = new PublicKey("12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS");
const TOKEN_PROGRAM_ID = new PublicKey("92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s");

const CLAIM_ACCOUNT_SIZE = 230;

function parseClaimAccount(data: Buffer) {
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
  offset += 32; // data_hash
  const signerKey = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 64; // signature
  offset += 8; // issued_at
  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;
  const revoked = data.readUInt8(offset) === 1;

  return { fid, claimId, topic, issuerFid, signerKey, revoked, expiresAt };
}

function parseCtrTopics(data: Buffer): bigint[] {
  if (data.length < 8 + 32 + 32 + 4) {
    return [];
  }
  let offset = 8 + 32 + 32;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;

  const topics: bigint[] = [];
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) break;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }
  return topics;
}

function parseIssuerEntry(data: Buffer) {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return null;

  let accountOffset = 8;
  const issuerFid = new PublicKey(data.subarray(accountOffset, accountOffset + 32));
  accountOffset += 32;
  const tir = new PublicKey(data.subarray(accountOffset, accountOffset + 32));

  const topicsLength = data.readUInt32LE(offset);
  offset += 4;

  const topics: bigint[] = [];
  for (let index = 0; index < topicsLength; index += 1) {
    if (data.length < offset + 8) return null;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }

  if (data.length < offset + 1) return null;
  const isActive = data.readUInt8(offset) === 1;
  return { issuerFid, tir, topics, isActive };
}

async function run() {
  console.log("Fetching purchase requests from backend...");
  let requests = [];
  try {
    const res = await axios.get(`${BACKEND_URL}/token-purchase-requests`);
    requests = res.data;
  } catch (err: any) {
    console.error("Failed to fetch requests:", err.message);
    return;
  }

  console.log(`Found ${requests.length} purchase requests.`);
  const activeRequests = requests.filter((r: any) =>
    ["APPROVED_FOR_MINT", "PENDING_ISSUER_REVIEW"].includes(r.status)
  );

  if (activeRequests.length === 0) {
    console.log("No requests in APPROVED_FOR_MINT or PENDING_ISSUER_REVIEW status.");
    if (requests.length > 0) {
      console.log("Using the latest request for diagnosis instead:");
      activeRequests.push(requests[requests.length - 1]);
    } else {
      return;
    }
  }

  const connection = new Connection(RPC_URL, "confirmed");

  for (const request of activeRequests) {
    console.log("\n====================================================");
    console.log(`DIAGNOSING REQUEST: ${request.id}`);
    console.log(`Status: ${request.status}`);
    console.log(`Token Contract: ${request.tokenContract}`);
    console.log(`Investor Wallet: ${request.investorWallet}`);
    console.log(`Amount: ${request.amount}`);
    console.log("====================================================");

    const mint = new PublicKey(request.tokenContract);
    const recipient = new PublicKey(request.investorWallet);

    // 1. Check CTR topics (Required claim topics for token)
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), mint.toBuffer()],
      CTR_PROGRAM_ID
    );
    console.log(`CTR State PDA: ${ctrState.toBase58()}`);
    const ctrInfo = await connection.getAccountInfo(ctrState, "confirmed");
    if (!ctrInfo) {
      console.error("❌ CTR State account is missing on-chain!");
      continue;
    }
    const requiredTopics = parseCtrTopics(ctrInfo.data);
    console.log(`Required Claim Topics from CTR: [${requiredTopics.map(String).join(", ")}]`);

    // 2. Check Wallet Identity in IRS
    // We need the IRS State PDA first. Since we don't have the IRP Program easily,
    // let's derive the IRS State PDA which is: seeds = [b"irs_state", mint] under IRS_PROGRAM_ID
    const [irsState] = PublicKey.findProgramAddressSync(
      [Buffer.from("irs_state"), mint.toBuffer()],
      IRS_PROGRAM_ID
    );
    console.log(`IRS State PDA: ${irsState.toBase58()}`);

    const [walletIdentity] = PublicKey.findProgramAddressSync(
      [Buffer.from("wallet_identity"), irsState.toBuffer(), recipient.toBuffer()],
      IRS_PROGRAM_ID
    );
    console.log(`Wallet Identity PDA: ${walletIdentity.toBase58()}`);
    const identityInfo = await connection.getAccountInfo(walletIdentity, "confirmed");
    if (!identityInfo) {
      console.log("❌ Wallet Identity account is missing on-chain!");
    } else {
      // Parse wallet identity fields
      // WalletIdentity layout: disc(8) + wallet(32) + fid(32) + country(2) + irs(32) + isActive(1)
      const walletKey = new PublicKey(identityInfo.data.slice(8, 40));
      const fidKey = new PublicKey(identityInfo.data.slice(40, 72));
      const country = identityInfo.data.readUInt16LE(72);
      const irsKey = new PublicKey(identityInfo.data.slice(74, 106));
      const isActive = identityInfo.data.readUInt8(106) === 1;
      console.log(`✅ Wallet Identity parsed:`);
      console.log(`   - Wallet: ${walletKey.toBase58()}`);
      console.log(`   - FID: ${fidKey.toBase58()}`);
      console.log(`   - Country: ${country}`);
      console.log(`   - IRS: ${irsKey.toBase58()}`);
      console.log(`   - Is Active: ${isActive}`);
    }

    // 3. Check Investor FID Account
    const [investorFidPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), recipient.toBuffer()],
      FID_PROGRAM_ID
    );
    console.log(`Investor FID PDA (from recipient wallet): ${investorFidPda.toBase58()}`);
    const fidInfo = await connection.getAccountInfo(investorFidPda, "confirmed");
    if (!fidInfo) {
      console.log("❌ Investor FID account is missing on-chain!");
    } else {
      // FID layout: disc(8) + owner(32) + managementKey(32) + signerKey(32) + claimCount(4) + isIssuer(1) + country(2)
      const owner = new PublicKey(fidInfo.data.slice(8, 40));
      const claimCount = fidInfo.data.readUInt32LE(104);
      const isIssuer = fidInfo.data.readUInt8(108) === 1;
      console.log(`✅ Investor FID parsed:`);
      console.log(`   - Owner: ${owner.toBase58()}`);
      console.log(`   - Claim Count: ${claimCount}`);
      console.log(`   - Is Issuer: ${isIssuer}`);
    }

    // 4. Check Investor Claim Accounts
    console.log("Scanning for Claim accounts belonging to Investor's FID...");
    const claimAccounts = await connection.getProgramAccounts(FID_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: CLAIM_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: investorFidPda.toBase58() } },
      ],
    });
    console.log(`Found ${claimAccounts.length} claim accounts on-chain.`);
    const now = BigInt(Math.floor(Date.now() / 1000));

    for (const { pubkey, account } of claimAccounts) {
      const claim = parseClaimAccount(account.data);
      if (!claim) {
        console.log(`   - Account ${pubkey.toBase58()}: Malformed`);
        continue;
      }
      console.log(`   - Claim PDA: ${pubkey.toBase58()}`);
      console.log(`     Topic: ${claim.topic}`);
      console.log(`     Claim ID: ${claim.claimId}`);
      console.log(`     Issuer FID: ${claim.issuerFid.toBase58()}`);
      console.log(`     Signer Key: ${claim.signerKey.toBase58()}`);
      console.log(`     Revoked: ${claim.revoked}`);
      console.log(`     Expires At: ${claim.expiresAt === 0n ? "Never" : new Date(Number(claim.expiresAt) * 1000).toLocaleString()}`);
      const isExpired = claim.expiresAt !== 0n && claim.expiresAt < now;
      console.log(`     Is Expired: ${isExpired}`);

      // Verify TIR Entry for this issuer and topic
      const [tirState] = PublicKey.findProgramAddressSync(
        [Buffer.from("tir_state"), mint.toBuffer()],
        TIR_PROGRAM_ID
      );
      const [issuerEntryPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("issuer_entry"), tirState.toBuffer(), claim.issuerFid.toBuffer()],
        TIR_PROGRAM_ID
      );
      console.log(`     Issuer Entry PDA: ${issuerEntryPda.toBase58()}`);
      const entryInfo = await connection.getAccountInfo(issuerEntryPda, "confirmed");
      if (!entryInfo) {
        console.log(`     ❌ Issuer Entry is MISSING from TIR registry!`);
      } else {
        const entry = parseIssuerEntry(entryInfo.data);
        if (entry) {
          console.log(`     ✅ Issuer Entry found in TIR:`);
          console.log(`        - Is Active: ${entry.isActive}`);
          console.log(`        - Allowed Topics: [${entry.topics.map(String).join(", ")}]`);
          const allowed = entry.topics.includes(claim.topic);
          console.log(`        - Allowed for Topic ${claim.topic}: ${allowed}`);
        } else {
          console.log(`     ❌ Issuer Entry found but could not be parsed.`);
        }
      }
    }
  }
}

run();
