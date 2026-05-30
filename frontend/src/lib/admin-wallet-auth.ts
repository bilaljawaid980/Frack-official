type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;

type AdminWalletHeadersArgs = {
  body?: string;
  method: string;
  path: string;
  signMessage?: SignMessage;
  walletAddress: string;
};

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

async function sha256Hex(value: string) {
  const hash = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function buildAdminWalletHeaders({
  body,
  method,
  path,
  signMessage,
  walletAddress,
}: AdminWalletHeadersArgs): Promise<Record<string, string>> {
  if (!signMessage) {
    throw new Error("Connected wallet does not support message signing.");
  }

  const timestamp = Date.now().toString();
  const nonce = window.crypto.randomUUID();
  const bodyHash = await sha256Hex(body ?? "{}");
  const message = [
    "FRACKS_ADMIN_REQUEST",
    method.toUpperCase(),
    path,
    timestamp,
    nonce,
    bodyHash,
  ].join("\n");
  const signature = await signMessage(new TextEncoder().encode(message));

  return {
    "X-Admin-Wallet": walletAddress,
    "X-Admin-Timestamp": timestamp,
    "X-Admin-Nonce": nonce,
    "X-Admin-Signature": bytesToBase64(signature),
  };
}
