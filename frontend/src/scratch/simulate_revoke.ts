import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import bs58 from "bs58";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { IdentityService } from "../services/identity";

const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL1 || "https://api.testnet.solana.com";
const connection = new Connection(rpc, "confirmed");

// Mock wallet
const wallet = new Wallet(Keypair.generate());
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
const identityService = new IdentityService(provider);

async function main() {
  const targetWallet = new PublicKey("J487tPjxoZLSvm2LVARjZz8nbgtezvQPmVvQZki3GfK7");
  const issuerOwner = new PublicKey("D8rtGy7jJSwCgdMio4rkoynF2dWVgD7Yvn9ENWkzTFYA");
  const topic = 1n;

  const ids = await identityService.getProgramIds();
  const [issuerFid] = identityService.findFidPda(issuerOwner, ids.fid);
  const [targetFid] = identityService.findFidPda(targetWallet, ids.fid);
  const [claimTopicIndex] = identityService.findClaimTopicIndexPda(
    targetFid,
    issuerFid,
    topic,
    ids.fid,
  );

  const indexInfo = await connection.getAccountInfo(claimTopicIndex, "confirmed");
  if (!indexInfo) {
    console.log("No claimTopicIndex found");
    return;
  }
  const claim = new PublicKey(indexInfo.data.subarray(80, 112));

  const REVOKE_CLAIM_DISCRIMINATOR = Buffer.from([182, 1, 142, 33, 207, 153, 37, 132]);

  // RemoveClaim IDL accounts:
  // RemoveClaim IDL accounts:
  // authority, fid, claim, claim_topic_index
  const REMOVE_CLAIM_DISCRIMINATOR = Buffer.from([224, 18, 14, 252, 222, 196, 60, 48]); // sha256("global:remove_claim")[..8] (I will calculate it)

  const revokeIx = new TransactionInstruction({
    programId: ids.fid,
    keys: [
      { pubkey: issuerOwner, isSigner: true, isWritable: true },
      { pubkey: issuerFid, isSigner: false, isWritable: false },
      { pubkey: claimTopicIndex, isSigner: false, isWritable: true }, // passed claimTopicIndex
      { pubkey: claimTopicIndex, isSigner: false, isWritable: true }, // passed claimTopicIndex
    ],
    data: REVOKE_CLAIM_DISCRIMINATOR,
  });

  const tx = new Transaction().add(revokeIx);
  tx.feePayer = issuerOwner;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  try {
    const res = await connection.simulateTransaction(tx, undefined, { sigVerify: false });
    console.log("Simulation result:", JSON.stringify(res.value, null, 2));
  } catch (err: any) {
    console.log("Error:", err.message);
  }
}

main().catch(console.error);
