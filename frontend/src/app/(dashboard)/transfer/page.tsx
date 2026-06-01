"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { ArrowLeft, CheckCircle2, Loader2, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useConnection } from "@solana/wallet-adapter-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";
import { formatTokenAmount, parseTokenAmount } from "@/lib/token-utils";
import { TransferService, type TransferPreflightResult } from "@/services/transfer";

type EligibilityCard = TransferPreflightResult["sender"];

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getTrustedProvider(asset: any, topic: string) {
  const issuers = asset?.metadata?.trustedIssuers || [];
  return issuers.find((issuer: any) =>
    (issuer.topics || []).map(String).includes(topic),
  )?.walletAddress || null;
}

function getTransferOnboardingStatus(preflight: TransferPreflightResult) {
  const recipientBlockers = preflight.recipient.blockers;
  if (!preflight.recipient.identityExists && recipientBlockers.some((item) => item.includes("FID"))) {
    return "ACTION_REQUIRED_RECIPIENT_FID";
  }
  if (preflight.requiredClaimTopics.includes("1") && recipientBlockers.some((item) => item.includes("topic 1"))) {
    return "PENDING_KYC";
  }
  if (preflight.requiredClaimTopics.includes("2") && recipientBlockers.some((item) => item.includes("topic 2"))) {
    return "PENDING_AML";
  }
  if (!preflight.recipient.identityExists) {
    return "PENDING_ISSUER_WHITELIST";
  }
  if (!preflight.recipient.identityActive) {
    return "PENDING_ISSUER_ACTIVATION";
  }
  return preflight.status;
}

function TransferPageContent() {
  const searchParams = useSearchParams();
  const { connection } = useConnection();
  const provider = useAnchorProvider();
  const { address } = useWallet();
  const { assets, loading } = useAssetsContext();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [preflight, setPreflight] = useState<TransferPreflightResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingRequest, setIsCreatingRequest] = useState(false);

  const requestedAssetId = searchParams.get("asset");
  const requestedSymbol = searchParams.get("symbol");
  const asset = useMemo(() => {
    if (!requestedAssetId && !requestedSymbol) return null;
    return assets.find(
      (item) =>
        item.id === requestedAssetId ||
        String(item.factoryAssetId ?? "") === requestedAssetId ||
        item.symbol === requestedSymbol,
    );
  }, [assets, requestedAssetId, requestedSymbol]);

  const tokenDecimals = Number(asset?.metadata?.decimals ?? 6);
  const tokenMint = asset?.contractAddress || asset?.tokenContractAddress || "";
  const amountBaseUnits = amount ? BigInt(parseTokenAmount(amount, tokenDecimals)) : 0n;

  const runPreflight = async () => {
    if (!provider || !address) {
      toast.error("Connect Investor A wallet first.");
      return;
    }
    if (!asset || !tokenMint) {
      toast.error("Select a valid asset.");
      return;
    }
    if (!recipient) {
      toast.error("Enter Investor B wallet.");
      return;
    }
    if (amountBaseUnits <= 0n) {
      toast.error("Enter a valid transfer amount.");
      return;
    }

    setIsChecking(true);
    setPreflight(null);
    try {
      const service = new TransferService(connection, provider);
      const result = await service.preflightTransfer(
        new PublicKey(tokenMint),
        new PublicKey(address),
        new PublicKey(recipient),
        amountBaseUnits,
        tokenDecimals,
      );
      setPreflight(result);
      if (result.ok) toast.success("Transfer is compliant and ready to send.");
      else toast.error(result.blockers[0] || "Transfer is not ready.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer preflight failed.");
    } finally {
      setIsChecking(false);
    }
  };

  const startRecipientOnboarding = async () => {
    if (!asset || !address || !preflight) return;
    setIsCreatingRequest(true);
    try {
      const requiredTopics = preflight.requiredClaimTopics;
      const status = getTransferOnboardingStatus(preflight);
      await apiFetch("/token-transfer-requests", {
        method: "POST",
        body: JSON.stringify({
          assetId: asset.id,
          tokenContract: tokenMint,
          fromWallet: address,
          toWallet: recipient,
          amount: Number(amount),
          status,
          requiredClaimTopics: requiredTopics,
          kycProvider: getTrustedProvider(asset, "1"),
          amlProvider: getTrustedProvider(asset, "2"),
          issuerWallet: asset.issuerAddress || asset.issuer,
          preflightFailure: preflight.blockers.join("\n"),
        }),
      });
      toast.success("Recipient onboarding request created.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create transfer request.");
    } finally {
      setIsCreatingRequest(false);
    }
  };

  const sendTransfer = async () => {
    if (!provider || !address || !asset || !preflight?.ok) return;
    setIsSending(true);
    try {
      const service = new TransferService(connection, provider);
      const result = await service.executeTransfer(
        new PublicKey(tokenMint),
        new PublicKey(address),
        new PublicKey(recipient),
        amountBaseUnits,
        tokenDecimals,
      );
      if (!result.success) throw new Error(result.error || "Transfer failed.");
      await apiFetch("/token-transfer-requests", {
        method: "POST",
        body: JSON.stringify({
          assetId: asset.id,
          tokenContract: tokenMint,
          fromWallet: address,
          toWallet: recipient,
          amount: Number(amount),
          status: "TRANSFERRED",
          requiredClaimTopics: preflight.requiredClaimTopics,
          issuerWallet: asset.issuerAddress || asset.issuer,
          transferTxHash: result.signature,
        }),
      }).catch(() => null);
      toast.success("Transfer submitted.", {
        description: <TransactionToastLink signature={result.signature} />,
      });
      setPreflight(null);
      setRecipient("");
      setAmount("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer failed.");
    } finally {
      setIsSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 glass-panel rounded-[22px] space-y-5">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="p-8 glass-panel rounded-[22px]">
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>Token not found. Open transfer from your portfolio holding.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const senderBlocked = preflight?.status.startsWith("SENDER_") || preflight?.status === "INSUFFICIENT_TRANSFERABLE_BALANCE";
  const canOnboard = preflight && !preflight.ok && !senderBlocked;

  return (
    <div className="p-8 glass-panel rounded-[22px] space-y-6">
      <div>
        <Button variant="ghost" size="sm" onClick={() => history.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-950">Transfer Tokens</h1>
            <p className="mt-2 text-sm text-slate-600">
              Secondary transfers require both wallets to pass token-specific RWA compliance.
            </p>
          </div>
          <Badge variant="outline" className="w-fit">
            {asset.name} ({asset.symbol})
          </Badge>
        </div>
      </div>

      <Card className="bg-white">
        <CardHeader>
          <CardTitle>Transfer Details</CardTitle>
          <CardDescription>
            Investor A signs the transfer. Issuers and providers only handle eligibility onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div>
              <Label>Investor A wallet</Label>
              <Input value={address || "Connect wallet"} disabled className="mt-2 font-mono" />
            </div>
            <div>
              <Label htmlFor="recipient">Investor B wallet</Label>
              <Input
                id="recipient"
                value={recipient}
                onChange={(event) => {
                  setRecipient(event.target.value.trim());
                  setPreflight(null);
                }}
                placeholder="Recipient Solana wallet address"
                className="mt-2 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="amount">Amount</Label>
              <Input
                id="amount"
                type="number"
                min="0"
                step="0.000001"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setPreflight(null);
                }}
                placeholder="0.00"
                className="mt-2"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={runPreflight} disabled={isChecking || isSending}>
                {isChecking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                Run Transfer Preflight
              </Button>
              {preflight?.ok ? (
                <Button onClick={sendTransfer} disabled={isSending} className="bg-[#172E7F] hover:bg-[#24469E]">
                  {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                  Send Transfer
                </Button>
              ) : canOnboard ? (
                <Button onClick={startRecipientOnboarding} disabled={isCreatingRequest} className="bg-[#172E7F] hover:bg-[#24469E]">
                  {isCreatingRequest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Start Recipient Onboarding
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm">
            <div className="font-semibold text-slate-900">Asset Summary</div>
            <div className="mt-3 space-y-2 text-slate-600">
              <div className="flex justify-between gap-3">
                <span>Token</span>
                <span className="font-mono">{shortAddress(tokenMint)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Decimals</span>
                <span>{tokenDecimals}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>Raw amount</span>
                <span>{amountBaseUnits.toString()}</span>
              </div>
              {preflight ? (
                <>
                  <div className="flex justify-between gap-3">
                    <span>Source balance</span>
                    <span>{formatTokenAmount(preflight.sourceBalance, tokenDecimals)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span>Transferable</span>
                    <span>{formatTokenAmount(preflight.transferableBalance, tokenDecimals)}</span>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {preflight ? (
        <Card className="bg-white">
          <CardHeader>
            <CardTitle>Compliance Preview</CardTitle>
            <CardDescription>Status: {preflight.status.replaceAll("_", " ")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-2">
            {([
              ["Sender", preflight.sender],
              ["Recipient", preflight.recipient],
            ] as Array<[string, EligibilityCard]>).map(([label, wallet]) => (
              <div key={label} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div className="font-semibold">{label}</div>
                  <Badge className={wallet.blockers.length === 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"} variant="secondary">
                    {wallet.blockers.length === 0 ? "Eligible" : "Blocked"}
                  </Badge>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <div>Wallet: <span className="font-mono">{shortAddress(wallet.wallet)}</span></div>
                  <div>Identity: {wallet.identityExists ? "Registered" : "Missing"}</div>
                  <div>Activation: {wallet.identityActive ? "Active" : "Inactive"}</div>
                  <div>FID: {wallet.fid ? shortAddress(wallet.fid) : "Missing"}</div>
                  <div>Country: {wallet.country ?? "Unknown"}</div>
                </div>
                {wallet.blockers.length > 0 ? (
                  <ul className="mt-3 list-disc space-y-1 pl-4 text-xs text-red-700">
                    {wallet.blockers.map((blocker: string) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ))}
            <div className="lg:col-span-2 rounded-xl border border-slate-200 p-4 text-sm">
              <div className="font-semibold">Required Topics</div>
              <div className="mt-2 text-slate-600">
                {preflight.requiredClaimTopics.length ? preflight.requiredClaimTopics.join(", ") : "None"}
              </div>
              {preflight.blockers.length > 0 ? (
                <Alert className="mt-4 border-red-200 bg-red-50">
                  <ShieldAlert className="h-4 w-4 text-red-600" />
                  <AlertDescription className="text-red-700">
                    {preflight.blockers[0]}
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="mt-4 border-emerald-200 bg-emerald-50">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <AlertDescription className="text-emerald-700">
                    Simulation passed. Investor A can sign the transfer.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

export default function TransferPage() {
  return (
    <Suspense fallback={<div className="p-8 glass-panel rounded-[22px]">Loading transfer...</div>}>
      <TransferPageContent />
    </Suspense>
  );
}
