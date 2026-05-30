import { PublicKey } from "@solana/web3.js";

export type ClaimSignVariant = {
  label: string;
  bytes: Uint8Array;
};

type SignResult = {
  success: boolean;
  method: string;
  variant: string;
  adapterOrProvider: string;
  signatureLength?: number;
  error?: string;
};

type WalletLikeSignMessage = (message: Uint8Array) => Promise<Uint8Array>;

type BrowserSolanaProvider = {
  isPhantom?: boolean;
  publicKey?: PublicKey;
  signMessage?: (
    message: Uint8Array,
    display?: "utf8" | "hex",
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

declare global {
  interface Window {
    phantom?: {
      solana?: BrowserSolanaProvider;
    };
    solana?: BrowserSolanaProvider;
    __fracksClaimSignSmokeTest?: () => Promise<void>;
  }
}

function ensureExactBytes(bytes: Uint8Array) {
  return new Uint8Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
}

export function buildClaimSignVariants(message: Uint8Array): ClaimSignVariant[] {
  const exact = ensureExactBytes(message);
  const fromArray = Uint8Array.from(Array.from(exact));
  const bufferLike =
    typeof Buffer !== "undefined" ? Uint8Array.from(Buffer.from(exact)) : exact;
  const sliced = new Uint8Array(exact.buffer.slice(0));

  return [
    { label: "original", bytes: exact },
    { label: "uint8array-copy", bytes: new Uint8Array(exact) },
    { label: "uint8array-from", bytes: fromArray },
    { label: "buffer-roundtrip", bytes: bufferLike },
    { label: "arraybuffer-sliced", bytes: sliced },
  ];
}

function getProviderResultSignature(
  result: { signature: Uint8Array } | Uint8Array,
): Uint8Array {
  return result instanceof Uint8Array ? result : result.signature;
}

async function trySigner(
  method: string,
  adapterOrProvider: string,
  signer: (message: Uint8Array) => Promise<Uint8Array>,
  variants: ClaimSignVariant[],
): Promise<SignResult[]> {
  const results: SignResult[] = [];
  for (const variant of variants) {
    try {
      const signature = await signer(variant.bytes);
      results.push({
        success: true,
        method,
        variant: variant.label,
        adapterOrProvider,
        signatureLength: signature.length,
      });
    } catch (error) {
      results.push({
        success: false,
        method,
        variant: variant.label,
        adapterOrProvider,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

export async function runClaimSignSmokeTest(args: {
  adapterName?: string | null;
  connectedWallet?: string | null;
  providerFid?: string | null;
  providerSignerKey?: string | null;
  adapterSignMessage?: WalletLikeSignMessage;
  message: Uint8Array;
}) {
  const variants = buildClaimSignVariants(args.message);
  const phantomProvider = window.phantom?.solana;
  const directSolana = window.solana;
  const results: SignResult[] = [];

  if (args.adapterSignMessage) {
    results.push(
      ...(await trySigner(
        "adapter.signMessage",
        args.adapterName ?? "unknown-adapter",
        async (bytes) => args.adapterSignMessage!(bytes),
        variants,
      )),
    );
  } else {
    results.push({
      success: false,
      method: "adapter.signMessage",
      variant: "n/a",
      adapterOrProvider: args.adapterName ?? "unknown-adapter",
      error: "signMessage is not available on the wallet adapter",
    });
  }

  if (phantomProvider?.signMessage) {
    results.push(
      ...(await trySigner(
        "window.phantom.solana.signMessage",
        "window.phantom.solana",
        async (bytes) => {
          const res = await phantomProvider.signMessage!(bytes, "hex");
          return getProviderResultSignature(res);
        },
        variants,
      )),
    );
  } else {
    results.push({
      success: false,
      method: "window.phantom.solana.signMessage",
      variant: "n/a",
      adapterOrProvider: "window.phantom.solana",
      error: "window.phantom.solana.signMessage is not available",
    });
  }

  if (directSolana?.signMessage) {
    results.push(
      ...(await trySigner(
        "window.solana.signMessage",
        "window.solana",
        async (bytes) => {
          const res = await directSolana.signMessage!(bytes, "hex");
          return getProviderResultSignature(res);
        },
        variants,
      )),
    );
  } else {
    results.push({
      success: false,
      method: "window.solana.signMessage",
      variant: "n/a",
      adapterOrProvider: "window.solana",
      error: "window.solana.signMessage is not available",
    });
  }

  console.info("[CLAIM SIGN SMOKE TEST]", {
    walletAdapterName: args.adapterName ?? null,
    connectedWallet: args.connectedWallet ?? null,
    providerFid: args.providerFid ?? null,
    providerSignerKey: args.providerSignerKey ?? null,
    messageLength: args.message.length,
    messageHex: Buffer.from(args.message).toString("hex"),
    messageBase64: Buffer.from(args.message).toString("base64"),
    results,
  });

  return results;
}

export async function tryDirectPhantomClaimSign(message: Uint8Array): Promise<Uint8Array | null> {
  if (typeof window === "undefined") return null;
  const phantomProvider = window.phantom?.solana;
  if (!phantomProvider?.signMessage) return null;

  const variants = buildClaimSignVariants(message);
  let lastError: unknown = null;
  for (const variant of variants) {
    for (const display of [undefined, "utf8", "hex"] as const) {
      try {
        const result = await phantomProvider.signMessage(variant.bytes, display);
        return getProviderResultSignature(result);
      } catch (error) {
        lastError = error;
      }
    }
  }

  if (lastError) throw lastError;
  return null;
}
