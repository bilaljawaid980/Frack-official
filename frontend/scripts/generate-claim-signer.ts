import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

const kp = Keypair.generate();

console.log("\n=== FRACKS Claim Signer Keypair ===");
console.log("Paste these into frontend/.env.local:\n");
console.log(`PROVIDER_CLAIM_SIGNER_PUBLIC=${kp.publicKey.toBase58()}`);
console.log(`PROVIDER_CLAIM_SIGNER_SECRET=${bs58.encode(kp.secretKey)}`);
console.log("PROVIDER_CLAIM_SIGNER_PROVIDER_WALLET=");
console.log(`NEXT_PUBLIC_PROVIDER_CLAIM_SIGNER_PUBLIC=${kp.publicKey.toBase58()}`);
console.log("\nWARNING: Keep the SECRET key safe.");
console.log("For production, use KMS/HSM instead of env vars.\n");
