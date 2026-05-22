"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWallet } from "@/hooks/use-wallet";
import { useAssetsContext } from "@/contexts/assets-context";
import { formatCurrency } from "@/lib/utils";
import { apiFetch } from "@/lib/backend";
import {
  RefreshCw,
  Wallet,
  TrendingUp,
  Layers,
  ExternalLink,
  TriangleAlert,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { IdentityService } from "@/services/identity";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";

interface HoldingRow {
  assetId: string;
  assetName: string;
  symbol: string;
  tokenContract: string;
  tokenPrice: number;
  rawBalance: number;
  balance: number;
  value: number;
}

type TokenTransferRequest = {
  id: string;
  assetId?: string | null;
  tokenContract: string;
  fromWallet: string;
  toWallet: string;
  amount?: number;
  status: string;
  preflightFailure?: string | null;
  transferTxHash?: string | null;
  createdAt: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function solscanTokenUrl(tokenContract: string) {
  return `https://solscan.io/token/${tokenContract}?cluster=testnet`;
}

function solscanAccountUrl(address: string) {
  return `https://solscan.io/account/${address}?cluster=testnet`;
}

export default function InvestorDashboardPage() {
  const params = useParams();
  const { address, trexClient, connectWallet, isConnected } = useWallet();
  const anchorProvider = useAnchorProvider();
  const routeWallet = typeof params?.id === "string" ? params.id : undefined;
  const investorWallet = routeWallet || address || "";

  const { assets, loading: assetsLoading, loadAssets } = useAssetsContext();
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [loadingHoldings, setLoadingHoldings] = useState(false);
  const [purchaseRequests, setPurchaseRequests] = useState<TokenPurchaseRequest[]>([]);
  const [transferRequests, setTransferRequests] = useState<TokenTransferRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [fidAddress, setFidAddress] = useState("");
  const [fidCountry, setFidCountry] = useState<number | null>(null);
  const [fidLoading, setFidLoading] = useState(false);
  const [fidRegistered, setFidRegistered] = useState<boolean | null>(null);
  const [registeringFid, setRegisteringFid] = useState(false);
  const [fidCountryCode, setFidCountryCode] = useState("840");
  const [resumingIdentityRequests, setResumingIdentityRequests] =
    useState(false);

  const isOwnInvestorPage = Boolean(
    address && investorWallet && address === investorWallet,
  );

  const loadFidStatus = useMemo(
    () => async () => {
      if (!investorWallet || !anchorProvider) {
        setFidAddress("");
        setFidCountry(null);
        setFidRegistered(null);
        return;
      }

      setFidLoading(true);
      try {
        const wallet = new PublicKey(investorWallet);
        const service = new IdentityService(anchorProvider);
        const [fid] = await service.findActiveFidPda(wallet);
        const fidAccount = await service.fetchFid(wallet);

        setFidAddress(fid.toBase58());
        setFidRegistered(Boolean(fidAccount));
        setFidCountry(fidAccount?.country ?? null);
      } catch (error) {
        console.error("Failed to load FID status", error);
        setFidAddress("");
        setFidCountry(null);
        setFidRegistered(null);
      } finally {
        setFidLoading(false);
      }
    },
    [anchorProvider, investorWallet],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFidStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadFidStatus]);

  useEffect(() => {
    let isActive = true;
    
    const loadRequests = async () => {
      if (!investorWallet) {
        setPurchaseRequests([]);
        return;
      }
      setLoadingRequests(true);
      try {
        const reqs = await apiFetch<TokenPurchaseRequest[]>(`/token-purchase-requests?investorWallet=${investorWallet}`);
        if (isActive) {
          setPurchaseRequests(reqs);
        }
      } catch (err) {
        console.error("Failed to load purchase requests", err);
      } finally {
        if (isActive) setLoadingRequests(false);
      }
    };
    
    loadRequests();
    return () => { isActive = false; };
  }, [investorWallet]);

  useEffect(() => {
    let isActive = true;

    const loadHoldings = async () => {
      if (!trexClient || !investorWallet || assets.length === 0) {
        if (isActive) {
          setHoldings([]);
        }
        return;
      }

      setLoadingHoldings(true);
      try {
        const rows = await Promise.all(
          assets.map(async (asset) => {
            const raw = await trexClient
              .getBalanceForToken(asset.tokenContractAddress, investorWallet)
              .catch(() => "0");
            const rawBalance = Number(raw) || 0;
            const balance = rawBalance / 1_000_000;
            const value = balance * (asset.tokenPrice || 0);
            return {
              assetId: asset.id,
              assetName: asset.name,
              symbol: asset.symbol,
              tokenContract: asset.tokenContractAddress,
              tokenPrice: asset.tokenPrice,
              rawBalance,
              balance,
              value,
            };
          }),
        );

        if (isActive) {
          setHoldings(rows.filter((row) => row.rawBalance > 0));
        }
      } catch (error) {
        console.error("Failed to load holdings:", error);
        if (isActive) {
          setHoldings([]);
        }
      } finally {
        if (isActive) {
          setLoadingHoldings(false);
        }
      }
    };

    loadHoldings();
    return () => {
      isActive = false;
    };
  }, [trexClient, investorWallet, assets]);

  useEffect(() => {
    if (!investorWallet) return;
    let isActive = true;
    const loadTransferRequests = async () => {
      try {
        const [incoming, outgoing] = await Promise.all([
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({ toWallet: investorWallet }).toString()}`,
          ),
          apiFetch<TokenTransferRequest[]>(
            `/token-transfer-requests?${new URLSearchParams({ fromWallet: investorWallet }).toString()}`,
          ),
        ]);
        const merged = new Map<string, TokenTransferRequest>();
        [...incoming, ...outgoing].forEach((request) => merged.set(request.id, request));
        if (isActive) setTransferRequests([...merged.values()]);
      } catch {
        if (isActive) setTransferRequests([]);
      }
    };
    void loadTransferRequests();
    return () => {
      isActive = false;
    };
  }, [investorWallet]);

  const totalValue = useMemo(
    () => holdings.reduce((sum, row) => sum + row.value, 0),
    [holdings],
  );
  const totalTokens = useMemo(
    () => holdings.reduce((sum, row) => sum + row.balance, 0),
    [holdings],
  );
  const assetsByRequestKey = useMemo(() => {
    const map = new Map<string, (typeof assets)[number]>();
    assets.forEach((asset) => {
      map.set(asset.id, asset);
      map.set(asset.tokenContractAddress, asset);
      map.set(asset.contractAddress, asset);
    });
    return map;
  }, [assets]);

  const resumeBlockedIdentityRequests = useCallback(async () => {
    const blockedRequests = purchaseRequests.filter(
      (request) => request.status === "ACTION_REQUIRED_INVESTOR_IDENTITY",
    );
    if (blockedRequests.length === 0 || resumingIdentityRequests) return;

    setResumingIdentityRequests(true);
    try {
      const resumed = await Promise.all(
        blockedRequests.map((request) =>
          apiFetch<TokenPurchaseRequest>(
            `/token-purchase-requests/${request.id}/resume-after-identity`,
            { method: "PATCH" },
          ),
        ),
      );
      const resumedById = new Map(resumed.map((request) => [request.id, request]));
      setPurchaseRequests((current) =>
        current.map((request) => resumedById.get(request.id) || request),
      );
      toast.success("Identity verified. Purchase request sent for review.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to resume identity-blocked requests",
      );
    } finally {
      setResumingIdentityRequests(false);
    }
  }, [purchaseRequests, resumingIdentityRequests]);

  useEffect(() => {
    if (!fidRegistered) return;

    const timeout = window.setTimeout(() => {
      void resumeBlockedIdentityRequests();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [fidRegistered, resumeBlockedIdentityRequests]);

  const handleRegisterFid = async () => {
    if (!anchorProvider || !address || !isOwnInvestorPage) {
      toast.error("Connect the investor wallet to register its FID.");
      return;
    }

    const countryCode = Number(fidCountryCode);
    if (
      !Number.isInteger(countryCode) ||
      countryCode < 1 ||
      countryCode > 999
    ) {
      toast.error("Enter a valid numeric country code between 1 and 999.");
      return;
    }

    setRegisteringFid(true);
    const loadingToast = toast.loading("Registering investor FID...");
    try {
      const service = new IdentityService(anchorProvider);
      await service.ensureOwnFid(countryCode, false);
      await loadFidStatus();
      await resumeBlockedIdentityRequests();
      toast.success("Investor FID registered successfully.", {
        id: loadingToast,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to register FID",
        { id: loadingToast },
      );
    } finally {
      setRegisteringFid(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-8 glass-panel rounded-[22px]">
        <div className="text-center py-12">
          <Wallet className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <h1 className="text-2xl font-bold mb-2">Investor Dashboard</h1>
          <p className="text-muted-foreground mb-6">
            Connect your wallet to load portfolio data.
          </p>
          <Button
            onClick={connectWallet}
            size="lg"
            className="bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]"
          >
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 glass-panel rounded-[22px]">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Investor Portfolio</h1>
            <p className="text-sm text-gray-600">
              Wallet:{" "}
              <span className="font-mono text-xs break-all">
                {investorWallet}
              </span>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            loadAssets();
            void loadFidStatus();
          }}
          disabled={assetsLoading || loadingHoldings || fidLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${
              assetsLoading || loadingHoldings || fidLoading
                ? "animate-spin"
                : ""
            }`}
          />
          Refresh
        </Button>
      </div>

      <Card
        className={`mb-6 rounded-2xl border bg-white shadow-sm ${
          fidRegistered
            ? "border-[#172E7F]/15"
            : "border-[#D7A928]/25"
        }`}
      >
        <CardContent className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div
              className={`rounded-xl p-3 ${
                fidRegistered
                  ? "bg-linear-to-tr from-[#172E7F] to-[#2A5FA6] text-white shadow-lg shadow-[#172E7F]/15"
                  : "bg-white text-[#D7A928] ring-1 ring-[#D7A928]/25"
              }`}
            >
              {fidLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : fidRegistered ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <TriangleAlert className="h-5 w-5" />
              )}
            </div>
            <div className="min-w-0">
              <div
                className={`text-sm font-semibold ${
                  fidRegistered ? "text-[#172E7F]" : "text-slate-950"
                }`}
              >
                {fidLoading
                  ? "Checking investor FID"
                  : fidRegistered
                    ? "Investor FID registered"
                    : "Investor FID required"}
              </div>
              <p className="mt-1 max-w-xl text-sm leading-6 text-slate-600">
                {fidRegistered
                  ? "Your identity account is active. Trusted KYC and AML providers can now issue claims for token purchases."
                  : "Register your FID once before a provider can issue KYC or AML claims for your token purchase requests."}
              </p>
              {fidRegistered && (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <div className="min-w-0">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Derived FID PDA
                    </span>
                    <span
                      className="font-mono text-slate-700"
                      title={fidAddress || undefined}
                    >
                      {fidAddress ? shortAddress(fidAddress) : "Unavailable"}
                    </span>
                  </div>
                  <div>
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Country
                    </span>
                    <span className="text-slate-600">
                      {fidCountry ?? "N/A"}
                    </span>
                  </div>
                  {fidAddress && (
                    <button
                      className="inline-flex items-center gap-1 font-medium text-[#172E7F] underline-offset-4 hover:underline"
                      type="button"
                      onClick={() =>
                        window.open(solscanAccountUrl(fidAddress), "_blank")
                      }
                    >
                      View on Solscan
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {fidRegistered ? (
            <Badge className="w-fit shrink-0 bg-[#172E7F] px-4 py-2 text-white shadow-lg shadow-[#172E7F]/20 hover:bg-[#172E7F]">
              Verified on-chain
            </Badge>
          ) : (
            <div className="flex w-full flex-col gap-2 lg:w-auto lg:items-end">
              <label
                className="text-left text-xs font-medium text-slate-600"
                htmlFor="fid-country-code"
              >
                Country code
              </label>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
                <Input
                  className="h-10 w-full bg-white sm:w-28"
                  id="fid-country-code"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  onChange={(event) => {
                    const value = event.target.value.replace(/\D/g, "");
                    setFidCountryCode(value.slice(0, 3));
                  }}
                  placeholder="840"
                  type="text"
                  value={fidCountryCode}
                />
                <Button
                  className="w-full bg-linear-to-tr from-[#172E7F] to-[#2A5FA6] px-6 text-white shadow-lg shadow-[#172E7F]/20 hover:from-[#1F3E95] hover:to-[#326CB8] sm:w-fit"
                  disabled={registeringFid || fidLoading || !isOwnInvestorPage}
                  onClick={handleRegisterFid}
                >
                  {registeringFid ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registering...
                    </>
                  ) : (
                    "Register FID"
                  )}
                </Button>
              </div>
              <p className="max-w-sm text-left text-xs leading-5 text-slate-500 lg:text-right">
                Use numeric ISO country code, for example 840 for United States.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Portfolio Value
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {formatCurrency(totalValue)}
            </div>
            <p className="text-xs text-muted-foreground">
              Estimated based on token price
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Tokens Held
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {totalTokens.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Across {holdings.length} assets
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">
              Asset Exposure
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-blue-600" />
            <span className="text-xl font-semibold">{holdings.length}</span>
            <span className="text-xs text-muted-foreground">
              active holdings
            </span>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-white rounded-2xl">
        <CardHeader>
          <CardTitle>Holdings</CardTitle>
          <CardDescription>
            Token balances for assets in your wallet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {assetsLoading || loadingHoldings ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading portfolio...
            </div>
          ) : holdings.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No token holdings found for this wallet.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Balance</TableHead>
                    <TableHead>Token Price</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {holdings.map((row) => (
                    <TableRow key={row.tokenContract}>
                      <TableCell className="font-medium">
                        {row.assetName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{row.symbol}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.balance.toLocaleString(undefined, {
                          maximumFractionDigits: 6,
                        })}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(row.tokenPrice || 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center gap-2">
                          <TrendingUp className="h-4 w-4 text-blue-600" />
                          {formatCurrency(row.value)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-9"
                            onClick={() =>
                              window.open(`/assets/${row.assetId}`, "_self")
                            }
                          >
                            View Asset
                            <ExternalLink className="h-3 w-3 ml-2" />
                          </Button>
                          <Button
                            size="sm"
                            className="h-9 bg-linear-to-tr from-[#172E7F] to-[#2A5FA6]"
                            onClick={() =>
                              window.open(
                                `/transfer?asset=${encodeURIComponent(
                                  row.assetId,
                                )}&symbol=${encodeURIComponent(row.symbol)}`,
                                "_self",
                              )
                            }
                          >
                            Transfer Tokens
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-white rounded-2xl mt-6">
        <CardHeader>
          <CardTitle>Token Purchase Requests</CardTitle>
          <CardDescription>
            Your ongoing and historical requests to buy tokens.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingRequests ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading requests...
            </div>
          ) : purchaseRequests.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No purchase requests found.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Token Name</TableHead>
                    <TableHead>Token Contract</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {purchaseRequests.map((req) => {
                    const asset =
                      (req.assetId && assetsByRequestKey.get(req.assetId)) ||
                      assetsByRequestKey.get(req.tokenContract);
                    const tokenName = asset
                      ? `${asset.name} (${asset.symbol})`
                      : "Unknown Token";

                    return (
                      <TableRow key={req.id}>
                        <TableCell className="font-medium">
                          {tokenName}
                        </TableCell>
                        <TableCell>
                          <a
                            className="inline-flex items-center gap-1 font-mono text-xs text-[#172E7F] underline-offset-4 hover:underline"
                            href={solscanTokenUrl(req.tokenContract)}
                            rel="noreferrer"
                            target="_blank"
                          >
                            {shortAddress(req.tokenContract)}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </TableCell>
                        <TableCell>{req.amount}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              req.status === "MINTED" ||
                              req.status === "APPROVED_FOR_MINT"
                                ? "default"
                                : req.status === "REJECTED"
                                  ? "destructive"
                                  : "secondary"
                            }
                          >
                            {req.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {new Date(req.createdAt).toLocaleDateString()}
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

      <Card className="bg-white rounded-2xl mt-6">
        <CardHeader>
          <CardTitle>Token Transfer Requests</CardTitle>
          <CardDescription>
            Secondary transfer onboarding and transfer history for this wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {transferRequests.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No transfer requests found.
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Direction</TableHead>
                    <TableHead>Token</TableHead>
                    <TableHead>Counterparty</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tx</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transferRequests.map((req) => {
                    const outgoing = req.fromWallet === investorWallet;
                    const counterparty = outgoing ? req.toWallet : req.fromWallet;
                    const asset =
                      (req.assetId && assetsByRequestKey.get(req.assetId)) ||
                      assetsByRequestKey.get(req.tokenContract);
                    return (
                      <TableRow key={req.id}>
                        <TableCell>{outgoing ? "Outgoing" : "Incoming"}</TableCell>
                        <TableCell className="font-medium">
                          {asset ? `${asset.name} (${asset.symbol})` : shortAddress(req.tokenContract)}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {shortAddress(counterparty)}
                        </TableCell>
                        <TableCell>{req.amount ?? "-"}</TableCell>
                        <TableCell>
                          <Badge variant={req.status === "TRANSFERRED" ? "default" : "secondary"}>
                            {req.status.replaceAll("_", " ")}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {req.transferTxHash ? (
                            <a
                              className="inline-flex items-center gap-1 text-xs text-[#172E7F] hover:underline"
                              href={`https://solscan.io/tx/${req.transferTxHash}?cluster=testnet`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            "-"
                          )}
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
    </div>
  );
}
