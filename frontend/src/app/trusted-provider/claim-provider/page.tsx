"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  CheckCircle2,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import { runClaimSignSmokeTest } from "@/lib/claim-sign-debug";
import { recordBlockchainTransactionSafely } from "@/lib/blockchain-transactions";
import { TransactionToastLink } from "@/lib/solscan";
import { IdentityService } from "@/services/identity";
import { TokenService } from "@/services/token";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";

type ReviewType = "KYC" | "AML";
type TokenTransferRequest = {
  id: string;
  listingId?: string;
  tokenContract: string;
  fromWallet: string;
  sellerWallet?: string;
  toWallet?: string;
  buyerWallet?: string;
  amount?: number;
  amountBaseUnits?: string;
  fullName?: string | null;
  email?: string | null;
  nationality?: string | null;
  country?: string | null;
  idDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
  status: string;
  kycProvider?: string | null;
  amlProvider?: string | null;
  requiredClaimTopics: string[];
  createdAt: string;
  source?: "direct" | "listing";
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function getReviewType(request: TokenPurchaseRequest): ReviewType {
  return request.status === "PENDING_AML" ? "AML" : "KYC";
}

function getReviewTopic(request: TokenPurchaseRequest) {
  return request.status === "PENDING_AML" ? "2" : "1";
}

function getAssignedProviderWallet(
  request: { status: string; kycProvider?: string | null; amlProvider?: string | null },
) {
  return request.status === "PENDING_AML"
    ? request.amlProvider ?? null
    : request.kycProvider ?? null;
}

export default function ClaimProviderPage() {
  const { address, connectWallet, isConnected, isConnecting } = useWallet();
  const { signMessage, wallet: walletAdapterWallet } = useSolanaWallet();
  const anchorProvider = useAnchorProvider();

  const [requests, setRequests] = useState<TokenPurchaseRequest[]>([]);
  const [transferRequests, setTransferRequests] = useState<TokenTransferRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [selectedRequest, setSelectedRequest] =
    useState<TokenPurchaseRequest | null>(null);
  const [selectedTransferRequest, setSelectedTransferRequest] =
    useState<TokenTransferRequest | null>(null);
  const [rejectingRequest, setRejectingRequest] =
    useState<TokenPurchaseRequest | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [claimChecks, setClaimChecks] = useState<Record<string, boolean>>({});
  const [checkingClaims, setCheckingClaims] = useState(false);

  const stats = useMemo(() => {
    const allRequests = [...requests, ...transferRequests];
    const kyc = allRequests.filter((request) => request.status === "PENDING_KYC");
    const aml = allRequests.filter((request) => request.status === "PENDING_AML");
    return {
      total: allRequests.length,
      kyc: kyc.length,
      aml: aml.length,
    };
  }, [requests, transferRequests]);

  const loadRequests = useCallback(async () => {
    if (!address) {
      setRequests([]);
      return;
    }

    setLoading(true);
    try {
      const [kycRequests, amlRequests] = await Promise.all([
        apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests?${new URLSearchParams({
            kycProvider: address,
            status: "PENDING_KYC",
          }).toString()}`,
        ),
        apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests?${new URLSearchParams({
            amlProvider: address,
            status: "PENDING_AML",
          }).toString()}`,
        ),
      ]);
      const [transferKycRequests, transferAmlRequests] = await Promise.all([
        apiFetch<TokenTransferRequest[]>(
          `/token-transfer-requests?${new URLSearchParams({
            kycProvider: address,
            status: "PENDING_KYC",
          }).toString()}`,
        ),
        apiFetch<TokenTransferRequest[]>(
          `/token-transfer-requests?${new URLSearchParams({
            amlProvider: address,
            status: "PENDING_AML",
          }).toString()}`,
        ),
      ]);
      const [listingKycRequests, listingAmlRequests] = await Promise.all([
        apiFetch<TokenTransferRequest[]>(
          `/token-listings/buy-intents?${new URLSearchParams({
            kycProvider: address,
            status: "PENDING_KYC",
          }).toString()}`,
        ),
        apiFetch<TokenTransferRequest[]>(
          `/token-listings/buy-intents?${new URLSearchParams({
            amlProvider: address,
            status: "PENDING_AML",
          }).toString()}`,
        ),
      ]);

      const merged = new Map<string, TokenPurchaseRequest>();
      [...kycRequests, ...amlRequests].forEach((request) => {
        merged.set(request.id, request);
      });
      setRequests([...merged.values()]);
      const transferMerged = new Map<string, TokenTransferRequest>();
      [...transferKycRequests, ...transferAmlRequests].forEach((request) => {
        transferMerged.set(request.id, { ...request, source: "direct" });
      });
      [...listingKycRequests, ...listingAmlRequests].forEach((request) => {
        transferMerged.set(request.id, {
          ...request,
          source: "listing",
          fromWallet: request.fromWallet || request.sellerWallet || "",
          toWallet: request.toWallet || request.buyerWallet,
        });
      });
      setTransferRequests([...transferMerged.values()]);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to load compliance requests",
      );
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadRequests();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadRequests]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (typeof window === "undefined") return;

    window.__fracksClaimSignSmokeTest = async () => {
      if (!anchorProvider || !address) {
        throw new Error("Connect the provider wallet first.");
      }

      const request = selectedRequest ?? requests[0] ?? null;
      if (!request) {
        throw new Error("No KYC request is available to build a claim-sign smoke test.");
      }

      const topic = BigInt(getReviewTopic(request));
      const identityService = new IdentityService(anchorProvider);
      const ctx = await identityService.buildClaimSigningContext(
        new PublicKey(request.investorWallet),
        topic,
      );

      await runClaimSignSmokeTest({
        adapterName: walletAdapterWallet?.adapter.name ?? null,
        connectedWallet: address,
        providerFid: ctx.issuerFid.toBase58(),
        providerSignerKey: ctx.claimSigner.toBase58(),
        adapterSignMessage: signMessage,
        message: ctx.message,
      });
    };

    return () => {
      delete window.__fracksClaimSignSmokeTest;
    };
  }, [address, anchorProvider, requests, selectedRequest, signMessage, walletAdapterWallet]);

  useEffect(() => {
    if (!anchorProvider || !address || requests.length === 0) {
      const timeout = window.setTimeout(() => setClaimChecks({}), 0);
      return () => window.clearTimeout(timeout);
    }

    let cancelled = false;
    const timeout = window.setTimeout(async () => {
      setCheckingClaims(true);
      try {
        const tokenSvc = new TokenService(anchorProvider);
        const entries = await Promise.all(
          requests.map(async (request) => {
            try {
              const mint = new PublicKey(request.tokenContract);
              const check = await tokenSvc.checkTokenScopedClaimForRequest({
                requestId: request.id,
                mint,
                investorWallet: new PublicKey(request.investorWallet),
                providerWallet: new PublicKey(address),
                topic: BigInt(getReviewTopic(request)),
              });
              return [request.id, Boolean(check.ok && check.investorHasActiveClaim)] as const;
            } catch {
              return [request.id, false] as const;
            }
          }),
        );
        if (!cancelled) setClaimChecks(Object.fromEntries(entries));
      } finally {
        if (!cancelled) setCheckingClaims(false);
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [address, anchorProvider, requests]);

  const updateRequestStatus = async (
    request: TokenPurchaseRequest,
    status: TokenPurchaseRequest["status"],
    extra: Record<string, string | undefined> = {},
  ) => {
    await apiFetch(`/token-purchase-requests/${request.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        status,
        reviewerWallet: address,
        ...extra,
      }),
    });
    await loadRequests();
  };

  const approveTransferRequest = async (request: TokenTransferRequest) => {
    if (!anchorProvider || !address) {
      toast.error("Connect the provider wallet first.");
      return;
    }

    const topic = request.status === "PENDING_AML" ? "2" : "1";
    const expectedProvider = getAssignedProviderWallet(request);
    if (
      expectedProvider &&
      address.toLowerCase() !== expectedProvider.toLowerCase()
    ) {
      toast.error(
        `Connect the assigned provider wallet ${shortAddress(expectedProvider)} to review this request.`,
      );
      return;
    }

    const nextStatus =
      topic === "1" && request.requiredClaimTopics.includes("2")
        ? "PENDING_AML"
        : "PENDING_ISSUER_WHITELIST";
    const loadingToast = toast.loading(`Reviewing transfer eligibility topic ${topic}...`);
    setProcessingId(request.id);
    try {
      const identityService = new IdentityService(anchorProvider);
      const tokenService = new TokenService(anchorProvider);
      const mint = new PublicKey(request.tokenContract);
      const providerWallet = new PublicKey(address);
      const recipientWallet = request.toWallet || request.buyerWallet;
      if (!recipientWallet) throw new Error("Transfer recipient wallet is missing.");
      const investorWallet = new PublicKey(recipientWallet);
      const investorFid = await identityService.fetchFid(investorWallet);
      if (!investorFid) {
        await apiFetch(
          request.source === "listing"
            ? `/token-listings/buy-intents/${request.id}/status`
            : `/token-transfer-requests/${request.id}/status`,
          {
          method: "PATCH",
          body: JSON.stringify({
            status: "ACTION_REQUIRED_RECIPIENT_FID",
            reviewerWallet: address,
            preflightFailure: "Recipient must register FID before claim issuance.",
          }),
          },
        );
        toast.error("Recipient must register FID before claim issuance.", { id: loadingToast });
        await loadRequests();
        return;
      }

      const check = await tokenService.checkTokenScopedClaimForRequest({
        requestId: request.id,
        mint,
        investorWallet,
        providerWallet,
        topic: BigInt(topic),
      });

      if (!check.ok) {
        if (!check.providerTrustedForToken) {
          throw new Error(`This wallet is not trusted for transfer claim topic ${topic}.`);
        }
        if (check.investorHasActiveClaim && check.providerSignerValid === false) {
          toast.loading(`Revoking stale transfer recipient claim...`, { id: loadingToast });
          const revokeTxHash = await identityService.revokeActiveClaimForTopic(
            investorWallet,
            BigInt(topic),
          );
          recordBlockchainTransactionSafely({
            txHash: revokeTxHash,
            actionType: "TRANSFER_ELIGIBILITY_STALE_CLAIM_REVOKED",
            actorWallet: address,
            entityType: request.source === "listing" ? "token_buy_intent" : "token_transfer_request",
            entityId: request.id,
            tokenContract: request.tokenContract,
          });
        }
        toast.loading(`Issuing fresh transfer recipient claim...`, { id: loadingToast });
        const signature = await identityService.issueClaim(
          investorWallet,
          BigInt(topic),
          signMessage,
          {
            walletAdapterName: walletAdapterWallet?.adapter.name ?? null,
          },
        );
        await apiFetch(
          request.source === "listing"
            ? `/token-listings/buy-intents/${request.id}/status`
            : `/token-transfer-requests/${request.id}/status`,
          {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus, reviewerWallet: address, claimTxHash: signature }),
          },
        );
        toast.success("Transfer recipient claim issued.", {
          id: loadingToast,
          description: <TransactionToastLink signature={signature} />,
        });
        await loadRequests();
        return;
      }

      await apiFetch(
        request.source === "listing"
          ? `/token-listings/buy-intents/${request.id}/status`
          : `/token-transfer-requests/${request.id}/status`,
        {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, reviewerWallet: address }),
        },
      );
      toast.success("Existing recipient claim accepted. Request forwarded.", { id: loadingToast });
      await loadRequests();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Transfer eligibility approval failed.";
      if (
        message.includes("DuplicateClaimTopicIssuer") ||
        message.includes("active claim already exists")
      ) {
        try {
          await apiFetch(
            request.source === "listing"
              ? `/token-listings/buy-intents/${request.id}/status`
              : `/token-transfer-requests/${request.id}/status`,
            {
              method: "PATCH",
              body: JSON.stringify({
                status: nextStatus,
                reviewerWallet: address,
              }),
            },
          );
          toast.success("Transfer recipient claim already exists. Request forwarded.", {
            id: loadingToast,
          });
          await loadRequests();
          return;
        } catch (statusError) {
          toast.error(
            statusError instanceof Error
              ? statusError.message
              : "Claim exists, but transfer request forwarding failed.",
            { id: loadingToast },
          );
          return;
        }
      }
      toast.error(message, { id: loadingToast });
    } finally {
      setProcessingId(null);
    }
  };

  const approveRequest = async (request: TokenPurchaseRequest) => {
    if (!anchorProvider || !address) {
      toast.error("Connect the provider wallet first.");
      return;
    }

    const topic = getReviewTopic(request);
    const reviewType = getReviewType(request);
    const expectedProvider = getAssignedProviderWallet(request);
    if (
      expectedProvider &&
      address.toLowerCase() !== expectedProvider.toLowerCase()
    ) {
      toast.error(
        `Connect the assigned ${reviewType} provider wallet ${shortAddress(expectedProvider)} to approve this request.`,
      );
      return;
    }

    const nextStatus =
      topic === "1" && request.requiredClaimTopics.includes("2")
        ? "PENDING_AML"
        : "PENDING_ISSUER_REVIEW";
    const loadingToast = toast.loading(`Issuing ${reviewType} claim...`);

    setProcessingId(request.id);
    try {
      const identityService = new IdentityService(anchorProvider);
      const tokenService = new TokenService(anchorProvider);
      const mint = new PublicKey(request.tokenContract);
      const providerWallet = new PublicKey(address);
      const investorWallet = new PublicKey(request.investorWallet);

      // Ensure investor has a FID; if not, prompt investor identity action and stop.
      const investorFid = await identityService.fetchFid(investorWallet);
      if (!investorFid) {
        await updateRequestStatus(request, "ACTION_REQUIRED_INVESTOR_IDENTITY");
        toast.error("Investor must register FID before claim issuance.", {
          id: loadingToast,
        });
        return;
      }

      // Token-scoped validation: required topics, claim existence, revoked/expired, provider trust in TIR
      const check = await tokenService.checkTokenScopedClaimForRequest({
        requestId: request.id,
        mint,
        investorWallet,
        providerWallet,
        topic: BigInt(topic),
      });

      if (!check.ok) {
        // If provider is not trusted for this token/topic, surface explicit error.
        if (!check.providerTrustedForToken) {
          throw new Error(`This wallet is not trusted for ${reviewType} claim topic ${topic}.`);
        }

        // Provider is trusted for this token/topic but token-scoped check failed
        // because the investor has no valid claim. In this case the provider
        // should issue the claim for the investor and advance the request.
        if (check.investorHasActiveClaim && check.providerSignerValid === false) {
          toast.loading(`Revoking stale ${reviewType} claim...`, { id: loadingToast });
          const revokeTxHash = await identityService.revokeActiveClaimForTopic(
            investorWallet,
            BigInt(topic),
          );
          recordBlockchainTransactionSafely({
            txHash: revokeTxHash,
            actionType: "PURCHASE_STALE_CLAIM_REVOKED",
            actorWallet: address,
            entityType: "token_purchase_request",
            entityId: request.id,
            assetId: request.assetId,
            tokenContract: request.tokenContract,
          });
          
          toast.loading(`Issuing fresh ${reviewType} claim...`, { id: loadingToast });
          const signature = await identityService.issueClaim(
            investorWallet,
            BigInt(topic),
            signMessage,
            {
              walletAdapterName: walletAdapterWallet?.adapter.name ?? null,
            },
          );
          const postIssueCheck = await tokenService.checkTokenScopedClaimForRequest({
            requestId: request.id,
            mint,
            investorWallet,
            providerWallet,
            topic: BigInt(topic),
          });
          if (
            !postIssueCheck.ok ||
            !postIssueCheck.investorHasActiveClaim ||
            postIssueCheck.claimRevoked ||
            postIssueCheck.claimExpired ||
            postIssueCheck.providerSignerValid === false ||
            !postIssueCheck.providerTrustedForToken
          ) {
            throw new Error(
              `Fresh ${reviewType} claim was written, but it is still not valid for this token. ` +
              `Revoke stale claim and reissue with current provider signer.`,
            );
          }
          await updateRequestStatus(request, nextStatus, { claimTxHash: signature });
          toast.success(
            `Stale ${reviewType} claim revoked and fresh claim issued.`,
            {
              id: loadingToast,
              description: <TransactionToastLink signature={signature} />,
            },
          );
          return;
        }

        const signature = await identityService.issueClaim(
          investorWallet,
          BigInt(topic),
          signMessage,
          {
            walletAdapterName: walletAdapterWallet?.adapter.name ?? null,
          },
        );
        const postIssueCheck = await tokenService.checkTokenScopedClaimForRequest({
          requestId: request.id,
          mint,
          investorWallet,
          providerWallet,
          topic: BigInt(topic),
        });
        if (
          !postIssueCheck.ok ||
          !postIssueCheck.investorHasActiveClaim ||
          postIssueCheck.claimRevoked ||
          postIssueCheck.claimExpired ||
          postIssueCheck.providerSignerValid === false ||
          !postIssueCheck.providerTrustedForToken
        ) {
          throw new Error(
            `${reviewType} claim was issued but is not valid for this token yet. ` +
            `Revoke stale claim and reissue with current provider signer.`,
          );
        }
        await updateRequestStatus(request, nextStatus, {
          claimTxHash: signature,
        });
        toast.success(`${reviewType} claim issued. Request advanced.`, {
          id: loadingToast,
          description: <TransactionToastLink signature={signature} />,
        });
        return;
      }

      // If ok=true, a valid claim already exists for this token's context — forward request.
      if (check.investorHasActiveClaim) {
        await updateRequestStatus(request, nextStatus);
        toast.success(`${reviewType} claim already exists. Request forwarded.`, {
          id: loadingToast,
        });
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval failed";
      if (
        message.includes("DuplicateClaimTopicIssuer") ||
        message.includes("active claim already exists")
      ) {
        try {
          await updateRequestStatus(request, nextStatus);
          toast.success(
            `${reviewType} claim already exists. Request forwarded.`,
            { id: loadingToast },
          );
          return;
        } catch (statusError) {
          toast.error(
            statusError instanceof Error
              ? statusError.message
              : "Claim exists, but request forwarding failed.",
            { id: loadingToast },
          );
          return;
        }
      }
      toast.error(error instanceof Error ? error.message : "Approval failed", {
        id: loadingToast,
      });
    } finally {
      setProcessingId(null);
    }
  };

  const rejectRequest = async () => {
    if (!rejectingRequest) return;

    const reason = rejectionReason.trim();
    if (!reason) {
      toast.error("Enter a rejection reason.");
      return;
    }

    setProcessingId(rejectingRequest.id);
    try {
      await updateRequestStatus(rejectingRequest, "REJECTED", {
        rejectionReason: reason,
      });
      toast.success("Request rejected.");
      setRejectingRequest(null);
      setRejectionReason("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rejection failed");
    } finally {
      setProcessingId(null);
    }
  };

  if (!isConnected || isConnecting) {
    return (
      <div className="p-8 glass-panel rounded-[22px]">
        <div className="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
          <div className="mb-5 rounded-2xl bg-[#172E7F]/10 p-4 text-[#172E7F]">
            <ShieldCheck className="h-10 w-10" />
          </div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Claim Provider Portal
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Connect the wallet configured as a trusted claim provider for
            an issued token. Assigned purchase requests will appear here.
          </p>
          <Button
            className="mt-6 bg-[#172E7F] hover:bg-[#24469E]"
            disabled={isConnecting}
            onClick={connectWallet}
            size="lg"
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-8 glass-panel rounded-[22px]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#172E7F]/15 bg-[#172E7F]/5 px-3 py-1 text-xs font-medium text-[#172E7F]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Trusted issuer review
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">
            Claim Provider Portal
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Review token purchase requests assigned to this wallet. Approval
            executes a Solana FID claim for the required topic and advances the
            request to AML or issuer review.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <Badge variant="outline" className="font-mono">
            {shortAddress(address || "")}
          </Badge>
          <Button variant="outline" onClick={() => void loadRequests()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="rounded-2xl bg-white">
          <CardHeader className="pb-2">
            <CardDescription>Total Assigned</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            Active claim reviews for this wallet.
          </CardContent>
        </Card>
        <Card className="rounded-2xl bg-white">
          <CardHeader className="pb-2">
            <CardDescription>Pending KYC</CardDescription>
            <CardTitle className="text-3xl">{stats.kyc}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            Topic 1 claim issuance queue.
          </CardContent>
        </Card>
        <Card className="rounded-2xl bg-white">
          <CardHeader className="pb-2">
            <CardDescription>Pending AML</CardDescription>
            <CardTitle className="text-3xl">{stats.aml}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-slate-500">
            Topic 2 claim issuance queue.
          </CardContent>
        </Card>
      </div>


      <Card className="rounded-2xl bg-white">
        <CardHeader>
          <CardTitle>Assigned Purchase Requests</CardTitle>
          <CardDescription>
            Requests are routed here from the investor purchase form based on
            the token&apos;s trusted KYC and AML provider metadata.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-14 text-sm text-slate-500">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading assigned requests...
            </div>
          ) : requests.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Clock3 className="mb-3 h-10 w-10 text-slate-300" />
              <p className="font-medium text-slate-800">No pending reviews</p>
              <p className="mt-1 max-w-md text-sm text-slate-500">
                New requests will appear here when this connected wallet is
                assigned as the KYC or AML provider for a token.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Investor</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead>Submitted</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {requests.map((request) => {
                    const reviewType = getReviewType(request);
                    const isProcessing = processingId === request.id;
                    const checkInProgress = checkingClaims && !(request.id in claimChecks);
                    const hasExistingClaim = Boolean(claimChecks[request.id]);

                    return (
                      <TableRow key={request.id}>
                        <TableCell>
                          <div className="font-medium">
                            {request.fullName || "Unnamed investor"}
                          </div>
                          <div className="font-mono text-xs text-slate-500">
                            {shortAddress(request.investorWallet)}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortAddress(request.tokenContract)}
                        </TableCell>
                        <TableCell>{request.amount}</TableCell>
                        <TableCell>
                          <Badge
                            className={
                              reviewType === "KYC"
                                ? "bg-blue-50 text-blue-700 hover:bg-blue-50"
                                : "bg-amber-50 text-amber-700 hover:bg-amber-50"
                            }
                            variant="secondary"
                          >
                            {reviewType} topic {getReviewTopic(request)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(request.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedRequest(request)}
                            >
                              <FileText className="mr-1 h-4 w-4" />
                              Details
                            </Button>
                            <Button
                              disabled={isProcessing || checkInProgress}
                              size="sm"
                              onClick={() => void approveRequest(request)}
                              className="bg-[#172E7F] hover:bg-[#24469E]"
                            >
                              {isProcessing || checkInProgress ? (
                                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1 h-4 w-4" />
                              )}
                              {checkInProgress
                                ? "Checking"
                                : hasExistingClaim
                                  ? "Forward request"
                                  : "Issue Claim"}
                            </Button>
                            <Button
                              disabled={isProcessing}
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectingRequest(request);
                                setRejectionReason("");
                              }}
                            >
                              <XCircle className="mr-1 h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl bg-white">
        <CardHeader>
          <CardTitle>Transfer Eligibility Requests</CardTitle>
          <CardDescription>
            Secondary transfer recipients routed to this wallet for token-scoped KYC or AML review.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transferRequests.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500">
              No pending transfer eligibility reviews.
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sender</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Flow</TableHead>
                    <TableHead>Review</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferRequests.map((request) => {
                    const isProcessing = processingId === request.id;
                    const topic = request.status === "PENDING_AML" ? "2" : "1";
                    return (
                      <TableRow key={request.id}>
                        <TableCell className="font-mono text-xs">{shortAddress(request.fromWallet)}</TableCell>
                        <TableCell className="font-mono text-xs">{shortAddress(request.toWallet || request.buyerWallet || "")}</TableCell>
                        <TableCell className="font-mono text-xs">{shortAddress(request.tokenContract)}</TableCell>
                        <TableCell>{request.amountBaseUnits ?? request.amount ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {request.source === "listing" ? "Marketplace" : "Direct"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">Transfer topic {topic}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {request.source === "listing" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setSelectedTransferRequest(request)}
                              >
                                <FileText className="mr-1 h-4 w-4" />
                                Details
                              </Button>
                            ) : null}
                            <Button
                              disabled={isProcessing}
                              size="sm"
                              onClick={() => void approveTransferRequest(request)}
                              className="bg-[#172E7F] hover:bg-[#24469E]"
                            >
                              {isProcessing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                              Review / Issue Claim
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(selectedRequest)}
        onOpenChange={(open) => {
          if (!open) setSelectedRequest(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Purchase Request Details</DialogTitle>
            <DialogDescription>
              Review investor identity details before issuing a claim.
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <Label className="text-slate-500">Investor</Label>
                <p className="font-medium">
                  {selectedRequest.fullName || "Not provided"}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">Email</Label>
                <p className="font-medium">
                  {selectedRequest.email || "Not provided"}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">Country</Label>
                <p className="font-medium">
                  {selectedRequest.country || "Not provided"}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">Nationality</Label>
                <p className="font-medium">
                  {selectedRequest.nationality || "Not provided"}
                </p>
              </div>
              <div className="md:col-span-2">
                <Label className="text-slate-500">Investor Wallet</Label>
                <p className="break-all font-mono text-xs">
                  {selectedRequest.investorWallet}
                </p>
              </div>
              <div className="md:col-span-2">
                <Label className="text-slate-500">Token Contract</Label>
                <p className="break-all font-mono text-xs">
                  {selectedRequest.tokenContract}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">Requested Amount</Label>
                <p className="font-medium">{selectedRequest.amount}</p>
              </div>
              <div>
                <Label className="text-slate-500">Required Topics</Label>
                <p className="font-medium">
                  {selectedRequest.requiredClaimTopics.join(", ") || "None"}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">ID Document</Label>
                {selectedRequest.idDocumentUrl ? (
                  <a
                    className="block break-all text-[#172E7F] underline"
                    href={selectedRequest.idDocumentUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {selectedRequest.idDocumentUrl}
                  </a>
                ) : (
                  <p className="text-slate-500">Not provided</p>
                )}
              </div>
              <div>
                <Label className="text-slate-500">Proof of Address</Label>
                {selectedRequest.proofOfAddressUrl ? (
                  <a
                    className="block break-all text-[#172E7F] underline"
                    href={selectedRequest.proofOfAddressUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {selectedRequest.proofOfAddressUrl}
                  </a>
                ) : (
                  <p className="text-slate-500">Not provided</p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedRequest(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedTransferRequest)}
        onOpenChange={(open) => {
          if (!open) setSelectedTransferRequest(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Marketplace KYC Details</DialogTitle>
            <DialogDescription>
              Review the buyer details submitted with this marketplace claim request.
            </DialogDescription>
          </DialogHeader>
          {selectedTransferRequest ? (
            <div className="grid gap-4 text-sm md:grid-cols-2">
              <div>
                <Label className="text-slate-500">Investor</Label>
                <p className="font-medium">{selectedTransferRequest.fullName || "Not provided"}</p>
              </div>
              <div>
                <Label className="text-slate-500">Email</Label>
                <p className="font-medium">{selectedTransferRequest.email || "Not provided"}</p>
              </div>
              <div>
                <Label className="text-slate-500">Country</Label>
                <p className="font-medium">{selectedTransferRequest.country || "Not provided"}</p>
              </div>
              <div>
                <Label className="text-slate-500">Nationality</Label>
                <p className="font-medium">{selectedTransferRequest.nationality || "Not provided"}</p>
              </div>
              <div className="md:col-span-2">
                <Label className="text-slate-500">Buyer wallet</Label>
                <p className="break-all font-mono text-xs">
                  {selectedTransferRequest.toWallet || selectedTransferRequest.buyerWallet}
                </p>
              </div>
              <div>
                <Label className="text-slate-500">ID document</Label>
                {selectedTransferRequest.idDocumentUrl ? (
                  <a className="block break-all text-[#172E7F] underline" href={selectedTransferRequest.idDocumentUrl} rel="noreferrer" target="_blank">
                    {selectedTransferRequest.idDocumentUrl}
                  </a>
                ) : (
                  <p className="text-slate-500">Not provided</p>
                )}
              </div>
              <div>
                <Label className="text-slate-500">Proof of address</Label>
                {selectedTransferRequest.proofOfAddressUrl ? (
                  <a className="block break-all text-[#172E7F] underline" href={selectedTransferRequest.proofOfAddressUrl} rel="noreferrer" target="_blank">
                    {selectedTransferRequest.proofOfAddressUrl}
                  </a>
                ) : (
                  <p className="text-slate-500">Not provided</p>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedTransferRequest(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(rejectingRequest)}
        onOpenChange={(open) => {
          if (!open) setRejectingRequest(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Compliance Request</DialogTitle>
            <DialogDescription>
              This will mark the investor purchase request as rejected and stop
              the mint workflow.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rejection-reason">Rejection reason</Label>
            <Textarea
              id="rejection-reason"
              value={rejectionReason}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Explain why this request cannot be approved."
              rows={4}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectingRequest(null)}>
              Cancel
            </Button>
            <Button
              disabled={Boolean(
                rejectingRequest && processingId === rejectingRequest.id,
              )}
              variant="destructive"
              onClick={() => void rejectRequest()}
            >
              Reject Request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
