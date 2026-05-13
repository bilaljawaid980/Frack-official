const fs = require("fs");
const nacl = require("tweetnacl");
const crypto = require("crypto");
const { PublicKey } = require("@solana/web3.js");

const issuerFid = new PublicKey(process.argv[2]);
const holderFid = new PublicKey(process.argv[3]);
const topic = BigInt(process.argv[4]);
const dataHashHex = process.argv[5].replace("0x", "");
const expires = BigInt(process.argv[6]);

const secret = JSON.parse(fs.readFileSync("issuer.json"));

const keypair = nacl.sign.keyPair.fromSecretKey(
  Uint8Array.from(secret)
);

const payload = Buffer.concat([
  issuerFid.toBuffer(),
  holderFid.toBuffer(),
  (() => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(topic);
    return b;
  })(),
  Buffer.from(dataHashHex, "hex"),
  (() => {
    const b = Buffer.alloc(8);
    b.writeBigInt64LE(expires);
    return b;
  })(),
]);

const messageHash = crypto
  .createHash("sha256")
  .update(payload)
  .digest();

const sig = nacl.sign.detached(
  messageHash,
  keypair.secretKey
);

console.log(
  "0x" + Buffer.from(sig).toString("hex")
);
