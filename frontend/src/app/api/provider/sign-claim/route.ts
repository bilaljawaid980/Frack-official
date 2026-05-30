import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { Keypair, PublicKey } from "@solana/web3.js";

const DEFAULT_FID_PROGRAM_ID = "Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW";

function decodeByteArray(value: unknown, label: string, expectedLength: number) {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`${label} must be an array of exactly ${expectedLength} bytes.`);
  }

  for (const byte of value) {
    if (typeof byte !== "number" || !Number.isInteger(byte) || byte < 0 || byte > 255) {
      throw new Error(`${label} contains invalid byte values.`);
    }
  }

  return Uint8Array.from(value);
}

function u64Le(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

function i64Le(value: bigint) {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(value, 0);
  return out;
}

function constructClaimMessage(args: {
  issuerFid: PublicKey;
  targetFid: PublicKey;
  topic: bigint;
  dataHash: Uint8Array;
  expiresAt: bigint;
}) {
  const payload = Buffer.concat([
    args.issuerFid.toBuffer(),
    args.targetFid.toBuffer(),
    u64Le(args.topic),
    Buffer.from(args.dataHash),
    i64Le(args.expiresAt),
  ]);

  return new Uint8Array(createHash("sha256").update(payload).digest());
}

export async function POST(request: NextRequest) {
  try {
    const configuredSecret = process.env.PROVIDER_CLAIM_SIGNER_SECRET?.trim();

    if (!configuredSecret) {
      return NextResponse.json(
        {
          error:
            "Provider claim signer is not configured. Set PROVIDER_CLAIM_SIGNER_SECRET to the provider wallet keypair secret.",
        },
        { status: 500 },
      );
    }

    const secretKey = bs58.decode(configuredSecret);
    const keypair = Keypair.fromSecretKey(secretKey);

    const body = (await request.json()) as {
      providerWallet?: string;
      providerFid?: string;
      targetWallet?: string | null;
      targetFid?: string;
      topic?: string;
      expiresAt?: string;
      dataHash?: number[];
      message?: number[];
    };

    if (
      !body.providerWallet ||
      !body.providerFid ||
      !body.targetFid ||
      !body.topic ||
      !body.expiresAt
    ) {
      return NextResponse.json(
        {
          error:
            "providerWallet, providerFid, targetFid, topic, and expiresAt are required.",
        },
        { status: 400 },
      );
    }

    if (body.providerWallet !== keypair.publicKey.toBase58()) {
      return NextResponse.json(
        {
          error:
            `Configured backend claim signer does not match provider wallet ${body.providerWallet}. ` +
            `Load the same provider wallet keypair into PROVIDER_CLAIM_SIGNER_SECRET.`,
        },
        { status: 403 },
      );
    }

    const dataHash = decodeByteArray(body.dataHash, "dataHash", 32);
    const suppliedMessage = decodeByteArray(body.message, "message", 32);

    const fidProgramId = new PublicKey(
      process.env.NEXT_PUBLIC_FID_PROGRAM_ID || DEFAULT_FID_PROGRAM_ID,
    );
    const providerWallet = new PublicKey(body.providerWallet);
    const providerFid = new PublicKey(body.providerFid);
    const targetFid = new PublicKey(body.targetFid);
    const topic = BigInt(body.topic);
    const expiresAt = BigInt(body.expiresAt);

    const [derivedIssuerFid] = PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), providerWallet.toBuffer()],
      fidProgramId,
    );
    if (!derivedIssuerFid.equals(providerFid)) {
      return NextResponse.json(
        {
          error:
            "providerFid does not match the providerWallet under the configured FID program.",
        },
        { status: 400 },
      );
    }

    if (body.targetWallet) {
      const targetWallet = new PublicKey(body.targetWallet);
      const [derivedTargetFid] = PublicKey.findProgramAddressSync(
        [Buffer.from("fid"), targetWallet.toBuffer()],
        fidProgramId,
      );
      if (!derivedTargetFid.equals(targetFid)) {
        return NextResponse.json(
          {
            error:
              "targetFid does not match the targetWallet under the configured FID program.",
          },
          { status: 400 },
        );
      }
    }

    const reconstructedMessage = constructClaimMessage({
      issuerFid: providerFid,
      targetFid,
      topic,
      dataHash,
      expiresAt,
    });

    if (!Buffer.from(reconstructedMessage).equals(Buffer.from(suppliedMessage))) {
      return NextResponse.json(
        {
          error:
            "Claim message mismatch. The backend provider signer refused to sign a non-canonical digest.",
        },
        { status: 400 },
      );
    }

    const signature = nacl.sign.detached(reconstructedMessage, keypair.secretKey);
    return NextResponse.json({
      signerPublicKey: keypair.publicKey.toBase58(),
      message: Array.from(reconstructedMessage),
      signature: Array.from(signature),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown provider signing error.",
      },
      { status: 500 },
    );
  }
}
