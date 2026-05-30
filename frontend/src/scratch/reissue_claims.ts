import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import fs from "node:fs";
import path from "node:path";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { IdentityService } from "../services/identity";

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

async function main() {
  loadEnvFile(path.resolve(process.cwd(), ".env.local"));
  loadEnvFile(path.resolve(process.cwd(), "..", "backend", ".env"));

  const rpc = process.env.NEXT_PUBLIC_SOLANA_RPC_URL1 || "https://api.testnet.solana.com";
  const connection = new Connection(rpc, "confirmed");

  // Load the admin/KYC provider keypair from the test environment or local config
  const secretKeyPath = path.resolve(process.cwd(), "..", "backend", "test-keys", "admin.json");
  let secretKey: Uint8Array;
  if (fs.existsSync(secretKeyPath)) {
      secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(secretKeyPath, "utf-8")));
  } else {
      console.error("No admin key found. Cannot reissue automatically.");
      return;
  }
  
  const keypair = Keypair.fromSecretKey(secretKey);
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  const identityService = new IdentityService(provider);

  const investors = [
    new PublicKey("G6cmAAxENSv34357yZfW75hcWewasVdcEXKjdmqANRpt"),
    new PublicKey("J487tPjxoZLSvm2LVARjZz8nbgtezvQPmVvQZki3GfK7")
  ];

  for (const investor of investors) {
    console.log(`\nProcessing investor: ${investor.toBase58()}`);
    try {
      console.log("Revoking old claim for topic 1...");
      const revokeSig = await identityService.revokeActiveClaimForTopic(investor, 1n);
      console.log("Revoked:", revokeSig);
    } catch (e: any) {
      console.log("Revoke skipped or failed:", e.message);
    }

    try {
      console.log("Issuing fresh claim for topic 1...");
      const issueSig = await identityService.issueClaim(investor, 1n);
      console.log("Issued:", issueSig);
    } catch (e: any) {
      console.log("Issue failed:", e.message);
    }
  }
  
  console.log("\nDone!");
}

main().catch(console.error);
