"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import * as ISO3166 from "iso-3166-1";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";
import { IdentityService } from "@/services/identity";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RefreshCw,
  TriangleAlert,
  Wallet,
} from "lucide-react";

function shortAddress(address: string) {
  return `${address.slice(0, 8)}...${address.slice(-6)}`;
}

function solscanAccountUrl(address: string) {
  return `https://solscan.io/account/${address}?cluster=devnet`;
}

type IsoCountryRecord = {
  country?: string;
  name?: string;
  alpha2?: string;
  alpha3?: string;
  numeric?: string | number;
};

type CountryOption = {
  alpha2: string;
  name: string;
  numeric: number;
};

function countryFlagUrl(alpha2: string) {
  return `https://flagcdn.com/w40/${alpha2.toLowerCase()}.png`;
}

function CountryFlag({
  country,
  className = "",
}: {
  country: Pick<CountryOption, "alpha2" | "name">;
  className?: string;
}) {
  return (
    <span
      aria-label={`${country.name} flag`}
      className={`inline-block h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px] bg-slate-100 bg-cover bg-center shadow-sm ring-1 ring-slate-900/10 ${className}`}
      role="img"
      style={{ backgroundImage: `url("${countryFlagUrl(country.alpha2)}")` }}
    />
  );
}

const COUNTRY_OPTIONS: CountryOption[] = (ISO3166.all() as IsoCountryRecord[])
  .map((country) => {
    const alpha2 = country.alpha2?.toUpperCase() ?? "";
    const numeric = Number(country.numeric);
    const name = country.country ?? country.name ?? "";

    if (!alpha2 || !name || !Number.isInteger(numeric)) return null;
    return {
      alpha2,
      name,
      numeric,
    };
  })
  .filter((country): country is CountryOption => Boolean(country))
  .sort((left, right) => left.name.localeCompare(right.name));

const COUNTRY_BY_NUMERIC = new Map(
  COUNTRY_OPTIONS.map((country) => [country.numeric, country]),
);

function countryLabel(country: CountryOption) {
  return `${country.name} (${country.numeric})`;
}

export default function InvestorIdentityPage() {
  const { address, connectWallet, isConnected } = useWallet();
  const anchorProvider = useAnchorProvider();
  const [fidAddress, setFidAddress] = useState("");
  const [fidCountry, setFidCountry] = useState<number | null>(null);
  const [fidLoading, setFidLoading] = useState(false);
  const [fidRegistered, setFidRegistered] = useState<boolean | null>(null);
  const [registeringFid, setRegisteringFid] = useState(false);
  const [fidCountryCode, setFidCountryCode] = useState("840");
  const [staleClaimProviderWallet, setStaleClaimProviderWallet] = useState("");
  const [staleClaimTopic, setStaleClaimTopic] = useState("1");
  const [removingStaleClaim, setRemovingStaleClaim] = useState(false);
  const [pendingIdentityRequests, setPendingIdentityRequests] = useState<TokenPurchaseRequest[]>([]);
  const [resumingIdentityRequests, setResumingIdentityRequests] = useState(false);

  const loadFidStatus = useMemo(
    () => async () => {
      if (!address || !anchorProvider) {
        setFidAddress("");
        setFidCountry(null);
        setFidRegistered(null);
        return;
      }

      setFidLoading(true);
      try {
        const wallet = new PublicKey(address);
        const service = new IdentityService(anchorProvider);
        const [fid] = await service.findActiveFidPda(wallet);
        const fidAccount = await service.fetchFid(wallet);
        setFidAddress(fid.toBase58());
        setFidRegistered(Boolean(fidAccount));
        setFidCountry(fidAccount?.country ?? null);
      } catch (error) {
        console.error("Failed to load investor FID status", error);
        setFidAddress("");
        setFidCountry(null);
        setFidRegistered(null);
      } finally {
        setFidLoading(false);
      }
    },
    [address, anchorProvider],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFidStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [loadFidStatus]);

  useEffect(() => {
    let isActive = true;

    const loadPendingIdentityRequests = async () => {
      if (!address) {
        setPendingIdentityRequests([]);
        return;
      }
      try {
        const requests = await apiFetch<TokenPurchaseRequest[]>(
          `/token-purchase-requests?investorWallet=${address}`,
        );
        if (!isActive) return;
        setPendingIdentityRequests(
          requests.filter(
            (request) => request.status === "ACTION_REQUIRED_INVESTOR_IDENTITY",
          ),
        );
      } catch (error) {
        console.error("Failed to load identity-blocked requests", error);
        if (isActive) {
          setPendingIdentityRequests([]);
        }
      }
    };

    void loadPendingIdentityRequests();
    return () => {
      isActive = false;
    };
  }, [address]);

  const resumeBlockedIdentityRequests = useCallback(async () => {
    if (pendingIdentityRequests.length === 0 || resumingIdentityRequests) {
      return;
    }

    setResumingIdentityRequests(true);
    try {
      await Promise.all(
        pendingIdentityRequests.map((request) =>
          apiFetch<TokenPurchaseRequest>(
            `/token-purchase-requests/${request.id}/resume-after-identity`,
            { method: "PATCH" },
          ),
        ),
      );
      setPendingIdentityRequests([]);
      toast.success("Identity verified. Purchase request sent for review.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to resume identity-blocked requests.",
      );
    } finally {
      setResumingIdentityRequests(false);
    }
  }, [pendingIdentityRequests, resumingIdentityRequests]);

  useEffect(() => {
    if (!fidRegistered) return;
    const timeout = window.setTimeout(() => {
      void resumeBlockedIdentityRequests();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [fidRegistered, resumeBlockedIdentityRequests]);

  const handleRegisterFid = async () => {
    if (!anchorProvider || !address) {
      toast.error("Connect the investor wallet to register its FID.");
      return;
    }

    const countryCode = Number(fidCountryCode);
    if (!Number.isInteger(countryCode) || countryCode < 1 || countryCode > 999) {
      toast.error("Select a valid investor country.");
      return;
    }

    const selectedCountry = COUNTRY_BY_NUMERIC.get(countryCode);
    setRegisteringFid(true);
    const loadingToast = toast.loading(
      selectedCountry ? (
        <span className="inline-flex items-center gap-2">
          Registering investor from
          <CountryFlag country={selectedCountry} />
          <span>{selectedCountry.name}...</span>
        </span>
      ) : (
        `Registering investor from country ${countryCode}...`
      ),
    );
    try {
      const service = new IdentityService(anchorProvider);
      const tx = await service.ensureOwnFid(countryCode, false);
      await loadFidStatus();
      await resumeBlockedIdentityRequests();
      toast.success("Investor FID registered successfully.", {
        id: loadingToast,
        description: tx ? <TransactionToastLink signature={tx} /> : undefined,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to register FID.",
        { id: loadingToast },
      );
    } finally {
      setRegisteringFid(false);
    }
  };

  const handleRemoveStaleClaim = async () => {
    if (!anchorProvider || !address) {
      toast.error("Connect the investor wallet to remove a stale claim.");
      return;
    }
    if (!fidRegistered) {
      toast.error("Register the investor FID first.");
      return;
    }

    let providerWallet: PublicKey;
    try {
      providerWallet = new PublicKey(staleClaimProviderWallet.trim());
    } catch {
      toast.error("Enter a valid provider wallet address.");
      return;
    }

    const topicNumber = Number(staleClaimTopic);
    if (!Number.isInteger(topicNumber) || topicNumber < 0) {
      toast.error("Enter a valid numeric claim topic.");
      return;
    }

    setRemovingStaleClaim(true);
    const loadingToast = toast.loading("Removing stale provider claim...");
    try {
      const service = new IdentityService(anchorProvider);
      const tx = await service.removeActiveClaimForTopicAsHolder(
        new PublicKey(address),
        providerWallet,
        BigInt(topicNumber),
      );
      toast.success("Stale claim removed.", {
        id: loadingToast,
        description: <TransactionToastLink signature={tx} />,
      });
      await loadFidStatus();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove stale claim.",
        { id: loadingToast },
      );
    } finally {
      setRemovingStaleClaim(false);
    }
  };

  if (!isConnected) {
    return (
      <div className="rounded-[22px] p-8 glass-panel">
        <div className="py-12 text-center">
          <Wallet className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
          <h1 className="mb-2 text-2xl font-bold">Investor Identity</h1>
          <p className="mb-6 text-muted-foreground">
            Connect your wallet to manage your investor FID and claim recovery tools.
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

  const registeredCountry =
    fidCountry === null || fidCountry === undefined
      ? null
      : COUNTRY_BY_NUMERIC.get(fidCountry);
  const selectedCountry = COUNTRY_BY_NUMERIC.get(Number(fidCountryCode));

  return (
    <div className="rounded-[22px] p-8 glass-panel">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-linear-to-tr from-[#172E7F] to-[#2A5FA6] p-2">
            <Wallet className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Investor Identity</h1>
            <p className="text-sm text-gray-600">
              Wallet:{" "}
              <span className="break-all font-mono text-xs">{address}</span>
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            void loadFidStatus();
          }}
          disabled={fidLoading}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${fidLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <Card
        className={`mb-6 rounded-2xl border bg-white shadow-sm ${
          fidRegistered ? "border-[#172E7F]/15" : "border-[#D7A928]/25"
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
              {fidRegistered ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
                  <div className="min-w-0">
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Derived FID PDA
                    </span>
                    <span className="font-mono text-slate-700" title={fidAddress || undefined}>
                      {fidAddress ? shortAddress(fidAddress) : "Unavailable"}
                    </span>
                  </div>
                  <div>
                    <span className="mr-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                      Country
                    </span>
                    <span className="text-slate-600">
                      {registeredCountry ? (
                        <span className="inline-flex items-center gap-2">
                          <CountryFlag country={registeredCountry} />
                          {countryLabel(registeredCountry)}
                        </span>
                      ) : (
                        fidCountry ?? "N/A"
                      )}
                    </span>
                  </div>
                  {fidAddress ? (
                    <button
                      className="inline-flex items-center gap-1 font-medium text-[#172E7F] underline-offset-4 hover:underline"
                      type="button"
                      onClick={() => window.open(solscanAccountUrl(fidAddress), "_blank")}
                    >
                      View on Solscan
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ) : null}
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
                Investor country
              </label>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
                <Select
                  disabled={registeringFid || fidLoading}
                  onValueChange={setFidCountryCode}
                  value={fidCountryCode}
                >
                  <SelectTrigger
                    className="h-10 w-full bg-white sm:w-80"
                    id="fid-country-code"
                  >
                    {selectedCountry ? (
                      <span className="flex min-w-0 items-center gap-2 pr-2">
                        <CountryFlag country={selectedCountry} />
                        <span className="truncate">{selectedCountry.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">
                          {selectedCountry.numeric}
                        </span>
                      </span>
                    ) : (
                      <SelectValue placeholder="Select country" />
                    )}
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    <SelectGroup>
                      {COUNTRY_OPTIONS.map((country) => (
                        <SelectItem
                          key={`${country.alpha2}-${country.numeric}`}
                          textValue={`${country.name} ${country.numeric}`}
                          value={String(country.numeric)}
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <CountryFlag country={country} />
                            <span className="truncate">{country.name}</span>
                            <span className="shrink-0 text-xs text-slate-400">
                              {country.numeric}
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Button
                  className="w-full bg-linear-to-tr from-[#172E7F] to-[#2A5FA6] px-6 text-white shadow-lg shadow-[#172E7F]/20 hover:from-[#1F3E95] hover:to-[#326CB8] sm:w-fit"
                  disabled={registeringFid || fidLoading}
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
                The numeric ISO country code is applied automatically when you register.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {fidRegistered ? (
        <Card className="rounded-2xl border border-amber-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Remove Stale Provider Claim</CardTitle>
            <CardDescription>
              Use this only when a provider/topic claim exists on your FID but is
              invalid for the current provider signer. This calls the FID contract&apos;s
              holder-side `remove_claim` path for your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This is a recovery tool for a stuck stale claim. After removal, ask
              the trusted KYC provider to approve the request again so a fresh claim
              is issued.
            </div>
            <div className="grid gap-4 md:grid-cols-[1fr_140px_auto]">
              <div className="space-y-2">
                <Label htmlFor="stale-claim-provider-wallet">Provider wallet</Label>
                <Input
                  id="stale-claim-provider-wallet"
                  value={staleClaimProviderWallet}
                  onChange={(event) => setStaleClaimProviderWallet(event.target.value)}
                  placeholder="DetqJfzSZdHdUcK35CGhKihSW1nAEyGTszJ7VoM75gaN"
                  className="bg-white font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stale-claim-topic">Topic</Label>
                <Input
                  id="stale-claim-topic"
                  value={staleClaimTopic}
                  onChange={(event) =>
                    setStaleClaimTopic(event.target.value.replace(/\D/g, ""))
                  }
                  placeholder="1"
                  className="bg-white"
                  inputMode="numeric"
                />
              </div>
              <div className="flex items-end">
                <Button
                  variant="destructive"
                  disabled={removingStaleClaim}
                  onClick={handleRemoveStaleClaim}
                >
                  {removingStaleClaim ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Removing...
                    </>
                  ) : (
                    "Remove Stale Claim"
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
