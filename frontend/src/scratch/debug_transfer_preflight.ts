import { Connection, PublicKey } from "@solana/web3.js";
import { createReadonlyProvider } from "../lib/anchor";
import { TransferService } from "../services/transfer";

async function main() {
  const args = process.argv.slice(2);
  const getArg = (flag: string) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const mintArg = getArg("--token");
  const senderArg = getArg("--from");
  const recipientArg = getArg("--to");
  const amountArg = getArg("--amount");
  const decimalsArg = getArg("--decimals") ?? "6";
  const rpcArg =
    getArg("--rpc") ??
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
    process.env.SOLANA_RPC_URL ??
    "https://solana-testnet-rpc.publicnode.com";

  if (!mintArg || !senderArg || !recipientArg || !amountArg) {
    throw new Error(
      "Usage: npx tsx src/scratch/debug_transfer_preflight.ts --token <mint> --from <wallet> --to <wallet> --amount <baseUnits> [--decimals 6] [--rpc <url>]",
    );
  }

  const connection = new Connection(rpcArg, "confirmed");
  const provider = createReadonlyProvider(connection);
  const service = new TransferService(connection, provider);

  const result = await service.preflightTransfer(
    new PublicKey(mintArg),
    new PublicKey(senderArg),
    new PublicKey(recipientArg),
    BigInt(amountArg),
    Number(decimalsArg),
  );

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
