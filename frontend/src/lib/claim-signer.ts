import { Keypair, PublicKey } from "@solana/web3.js";

export type ClaimSignerMode =
  | "wallet-backed"
  | "browser-local"
  | "unavailable";

export type ClaimSignatureResult = {
  signature: Uint8Array;
  signerPublicKey: string;
  mode: ClaimSignerMode;
  message: Uint8Array;
};

type BrowserLocalSigner = Pick<Keypair, "publicKey" | "secretKey">;

export function detectClaimSignerMode(args: {
  onChainSignerKey: PublicKey;
  connectedWallet: PublicKey;
  localSigner?: BrowserLocalSigner | null;
}): ClaimSignerMode {
  if (args.onChainSignerKey.equals(args.connectedWallet)) {
    return "wallet-backed";
  }

  if (args.localSigner && args.onChainSignerKey.equals(args.localSigner.publicKey)) {
    return "browser-local";
  }

  return "unavailable";
}

export async function signClaimWithWallet(args: {
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;
  message: Uint8Array;
}): Promise<ClaimSignatureResult> {
  if (typeof args.signMessage !== "function") {
    throw new Error("Wallet does not support signMessage.");
  }

  try {
    const signature = await args.signMessage(args.message);
    return {
      signature: new Uint8Array(signature),
      signerPublicKey: "",
      mode: "wallet-backed",
      message: new Uint8Array(args.message),
    };
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function signClaimWithBackendProviderWallet(args: {
  providerWallet: string;
  providerFid: string;
  targetWallet?: string;
  targetFid: string;
  topic: string;
  expiresAt: string;
  dataHash: Uint8Array;
  message: Uint8Array;
}): Promise<ClaimSignatureResult> {
  const response = await fetch("/api/provider/sign-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerWallet: args.providerWallet,
      providerFid: args.providerFid,
      targetWallet: args.targetWallet ?? null,
      targetFid: args.targetFid,
      topic: args.topic,
      expiresAt: args.expiresAt,
      dataHash: Array.from(args.dataHash),
      message: Array.from(args.message),
    }),
  });

  const payload = (await response.json()) as {
    error?: string;
    signature?: number[];
    signerPublicKey?: string;
    message?: number[];
  };

  if (!response.ok) {
    throw new Error(payload.error || "Backend provider signer failed.");
  }

  if (!payload.signature || !payload.signerPublicKey || !payload.message) {
    throw new Error("Backend provider signer returned an incomplete response.");
  }

  return {
    signature: Uint8Array.from(payload.signature),
    signerPublicKey: payload.signerPublicKey,
    mode: "wallet-backed",
    message: Uint8Array.from(payload.message),
  };
}
