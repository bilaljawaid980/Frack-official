"use client";

export function getSolscanTxUrl(signature: string) {
  const cluster =
    process.env.NEXT_PUBLIC_SOLANA_CLUSTER ||
    process.env.NEXT_PUBLIC_SOLANA_NETWORK ||
    "devnet";
  const query = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://solscan.io/tx/${signature}${query}`;
}

export function shortTx(signature: string) {
  if (signature.length <= 18) return signature;
  return `${signature.slice(0, 10)}...${signature.slice(-8)}`;
}

export function TransactionToastLink({
  signature,
  label = "View on Solscan",
}: {
  signature: string;
  label?: string;
}) {
  return (
    <a
      className="mt-1 inline-flex max-w-full items-center gap-1 font-mono text-xs text-[#172E7F] underline underline-offset-2"
      href={getSolscanTxUrl(signature)}
      rel="noreferrer"
      target="_blank"
    >
      {label}: {shortTx(signature)}
    </a>
  );
}
