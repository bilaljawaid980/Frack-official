"use client";

import { useEffect, useState } from "react";
import {
  useConnection,
  useWallet as useSolanaWallet,
} from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getExplorerAccountUrl } from "@/lib/constants";
import { createAnchorProvider } from "@/lib/anchor";
import { fetchFactoryStateAccount } from "@/lib/solana";
import { TransactionToastLink } from "@/lib/solscan";
import { copyToClipboard } from "@/lib/utils";
import { IdentityService } from "@/services/identity";
import { toast } from "sonner";
import { ProviderSignerConfig } from "@/components/trex/provider-signer-config";

const DEPLOYED_FID_PROGRAM_ID = new PublicKey(
  "Fb2roXDWjEaZwWJvxAWJTCRsK4Hy4V64MuCwoGXWMUtW",
);

async function getActiveFidProgramId() {
  const factoryState = await fetchFactoryStateAccount().catch(() => null);
  return factoryState?.fidProgramId ?? DEPLOYED_FID_PROGRAM_ID;
}

function deriveFid(wallet: PublicKey, fidProgramId: PublicKey) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("fid"), wallet.toBuffer()],
    fidProgramId,
  )[0];
}

export default function ProviderFidPage() {
  const { publicKey, signTransaction, signAllTransactions } = useSolanaWallet();
  const { connection } = useConnection();
  const [fidExists, setFidExists] = useState<boolean | null>(null);
  const [fidAddress, setFidAddress] = useState("");
  const [creatingFid, setCreatingFid] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      if (!publicKey) {
        if (!cancelled) {
          setFidExists(null);
          setFidAddress("");
        }
        return;
      }

      setFidAddress("");
      setFidExists(null);

      getActiveFidProgramId()
        .then(async (fidProgramId) => {
          const fid = deriveFid(publicKey, fidProgramId);
          if (!cancelled) setFidAddress(fid.toBase58());
          return connection.getAccountInfo(fid, "confirmed");
        })
        .then((info) => {
          if (!cancelled) setFidExists(info !== null);
        })
        .catch(() => {
          if (!cancelled) setFidExists(null);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [connection, publicKey]);

  const handleCreateFid = async () => {
    if (!publicKey || !signTransaction || !signAllTransactions) {
      toast.error("Connect the provider wallet first");
      return;
    }

    setCreatingFid(true);
    try {
      const provider = createAnchorProvider(connection, {
        publicKey,
        signTransaction,
        signAllTransactions,
      });
      const service = new IdentityService(provider);
      const tx = await service.ensureOwnFid(0, true, "provider");
      const fidProgramId = await getActiveFidProgramId();
      const fidPda = deriveFid(publicKey, fidProgramId);

      setFidAddress(fidPda.toBase58());
      setFidExists(true);
      toast.success("Provider FID registered successfully", {
        description: tx ? <TransactionToastLink signature={tx} /> : undefined,
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to register FID";
      if (
        message.includes("already in use") ||
        message.includes("already initialized")
      ) {
        setFidExists(true);
        toast.info("FID already registered");
      } else {
        toast.error(message.length > 160 ? `${message.slice(0, 160)}...` : message);
      }
    } finally {
      setCreatingFid(false);
    }
  };

  const handleCopy = async (text: string) => {
    if (await copyToClipboard(text)) toast.success("Copied");
  };

  return (
    <div className="space-y-6">
      <Card className="border border-slate-200/70 bg-white/80 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            Provider FID
          </CardTitle>
          <CardDescription>
            Register the connected wallet as a FRACKS Identity before it is used
            as a trusted claim provider.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!publicKey ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Connect the provider wallet to check or register its FID.
            </div>
          ) : (
            <>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Provider Wallet
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">
                      {publicKey.toBase58()}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(publicKey.toBase58())}
                      className="text-slate-400 hover:text-slate-700"
                      aria-label="Copy provider wallet"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                  <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
                    Derived FID PDA
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-700">
                      {fidAddress}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(fidAddress)}
                      className="text-slate-400 hover:text-slate-700"
                      aria-label="Copy FID PDA"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                    <a
                      href={getExplorerAccountUrl(fidAddress)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-slate-400 hover:text-slate-700"
                      aria-label="Open FID PDA in explorer"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </div>
              </div>

              {fidExists === null ? (
                <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking FID status...
                </div>
              ) : fidExists ? (
                <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                  <div>
                    <div className="text-sm font-semibold text-emerald-800">
                      FID registered
                    </div>
                    <div className="text-xs text-emerald-700">
                      This wallet can be used as a trusted claim provider in
                      token deployments.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-start gap-3">
                    <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <div>
                      <div className="text-sm font-semibold text-amber-900">
                        FID not registered
                      </div>
                      <div className="text-xs text-amber-800">
                        Register this wallet before adding it to deployments as
                        a trusted issuer.
                      </div>
                    </div>
                  </div>
                  <Button onClick={handleCreateFid} disabled={creatingFid}>
                    {creatingFid ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Registering...
                      </>
                    ) : (
                      "Register Provider FID"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {publicKey ? (
        <ProviderSignerConfig
          walletAddress={publicKey.toBase58()}
          onRotated={() => {
            void getActiveFidProgramId().then((fidProgramId) => {
              const fid = deriveFid(publicKey, fidProgramId);
              setFidAddress(fid.toBase58());
            });
          }}
        />
      ) : null}
    </div>
  );
}
