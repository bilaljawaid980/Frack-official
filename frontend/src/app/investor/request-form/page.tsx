"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { AlertTriangle, ArrowLeft, FileText, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAssetsContext } from "@/contexts/assets-context";
import { useAnchorProvider } from "@/hooks/useAnchorProvider";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import {
  connection,
  fetchFactoryStateAccount,
  type FactoryStateAccount,
} from "@/lib/solana";
import { getKycApplicationByWallet } from "@/lib/kyc-api";
import { IdentityService } from "@/services/identity";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { RWAAsset } from "@/types/rwa";
import type { TokenPurchaseRequest } from "@/types/token-purchase-request";
import {
  getBlockedCountries,
  getRequiredClaimTopics,
  getTrustedIssuers,
  isInvestorCountryBlocked,
} from "@/lib/asset-compliance";
import { getCountryName } from "@/lib/utils";

type LiveProvider = {
  walletAddress: string;
  topics: number[];
  isActive: boolean;
};

type KycProfileFields = {
  fullName?: string | null;
  email?: string | null;
  nationality?: string | null;
  country?: string | null;
  idDocumentUrl?: string | null;
  proofOfAddressUrl?: string | null;
};

function topicStrings(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  return topics.map((topic) => String(topic));
}

function getProviderForTopic(asset: RWAAsset, topic: "1" | "2") {
  const label = topic === "1" ? "KYC" : "AML";
  return (
    getTrustedIssuers(asset).find((issuer) => {
      const topics = topicStrings(issuer.topics);
      return issuer.label?.toUpperCase() === label || topics.includes(topic);
    })?.walletAddress || ""
  );
}

function derivePda(seeds: Buffer[], programId: PublicKey) {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

function deriveFidPda(wallet: PublicKey, fidProgramId: PublicKey) {
  return derivePda([Buffer.from("fid"), wallet.toBuffer()], fidProgramId);
}

function deriveTirStatePda(tokenMint: PublicKey, tirProgramId: PublicKey) {
  return derivePda([Buffer.from("tir_state"), tokenMint.toBuffer()], tirProgramId);
}

function parseIssuerEntry(data: Buffer) {
  if (data.length < 8 + 32 + 32 + 4) return null;

  let offset = 8 + 32 + 32;
  const topicsLength = data.readUInt32LE(offset);
  offset += 4;

  const topics: number[] = [];
  for (let index = 0; index < topicsLength; index += 1) {
    if (data.length < offset + 8) return null;
    topics.push(Number(data.readBigUInt64LE(offset)));
    offset += 8;
  }

  if (data.length < offset + 1) return null;
  const isActive = data.readUInt8(offset) === 1;

  return {
    issuerFid: new PublicKey(data.subarray(8, 40)),
    topics,
    isActive,
  };
}

function parseFidOwner(data: Buffer) {
  if (data.length < 40) return null;
  return new PublicKey(data.subarray(8, 40)).toBase58();
}

function nonEmpty(value?: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasKycProfileFields(profile: KycProfileFields | null | undefined) {
  return Boolean(
    profile &&
      (nonEmpty(profile.fullName) ||
        nonEmpty(profile.email) ||
        nonEmpty(profile.nationality) ||
        nonEmpty(profile.country) ||
        nonEmpty(profile.idDocumentUrl) ||
        nonEmpty(profile.proofOfAddressUrl)),
  );
}

async function fetchPreviousKycProfile(walletAddress: string) {
  const requests = await apiFetch<TokenPurchaseRequest[]>(
    `/token-purchase-requests?investorWallet=${walletAddress}`,
  );
  return (
    requests.find((request) => hasKycProfileFields(request)) ?? null
  );
}

async function fetchLiveProviders(
  deps: FactoryStateAccount,
  tokenContract: string,
): Promise<LiveProvider[]> {
  const tokenMint = new PublicKey(tokenContract);
  const tirState = deriveTirStatePda(tokenMint, deps.tirProgramId);
  const accounts = await connection.getProgramAccounts(deps.tirProgramId, {
    commitment: "confirmed",
    filters: [
      {
        memcmp: {
          offset: 40,
          bytes: tirState.toBase58(),
        },
      },
    ],
  });

  const providers = await Promise.all(
    accounts.map(async ({ account }) => {
      const parsed = parseIssuerEntry(account.data);
      if (!parsed) return null;

      const fidInfo = await connection.getAccountInfo(parsed.issuerFid, "confirmed");
      const walletAddress = fidInfo ? parseFidOwner(fidInfo.data) : null;
      if (!walletAddress) return null;

      const canonicalIssuerFid = deriveFidPda(
        new PublicKey(walletAddress),
        deps.fidProgramId,
      );
      if (!canonicalIssuerFid.equals(parsed.issuerFid)) return null;

      return {
        walletAddress,
        topics: parsed.topics,
        isActive: parsed.isActive,
      };
    }),
  );

  return providers.filter(Boolean) as LiveProvider[];
}

function RequestFormContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { assets, loading } = useAssetsContext();
  const anchorProvider = useAnchorProvider();
  const { address: walletAddress, isConnected, connectWallet } = useWallet();

  const requestedAssetId = useMemo(() => searchParams.get("asset"), [searchParams]);

  const asset = useMemo(() => {
    if (!requestedAssetId) return null;
    return assets.find(
      (a) =>
        a.id === requestedAssetId ||
        String(a.factoryAssetId ?? "") === requestedAssetId,
    );
  }, [assets, requestedAssetId]);

  const [submitting, setSubmitting] = useState(false);
  const [factoryState, setFactoryState] = useState<FactoryStateAccount | null>(null);
  const [liveProviders, setLiveProviders] = useState<LiveProvider[] | null>(null);
  const [kycAutofilled, setKycAutofilled] = useState(false);
  const [investorCountry, setInvestorCountry] = useState<number | null>(null);
  const [investorFidRegistered, setInvestorFidRegistered] = useState<boolean | null>(null);
  const [identityLoading, setIdentityLoading] = useState(false);
  const [registeringFid, setRegisteringFid] = useState(false);
  const [fidCountryCode, setFidCountryCode] = useState("840");
  const [formData, setFormData] = useState({
    amount: "",
    fullName: "",
    email: "",
    nationality: "",
    country: "",
    idDocumentUrl: "",
    proofOfAddressUrl: "",
  });

  useEffect(() => {
    const loadFactoryState = async () => {
      try {
        setFactoryState(await fetchFactoryStateAccount());
      } catch (err) {
        console.error("Failed to load factory state for request form", err);
      }
    };

    loadFactoryState();
  }, []);

  useEffect(() => {
    const loadLiveProviders = async () => {
      if (!asset || !factoryState) {
        setLiveProviders(null);
        return;
      }

      try {
        const providers = await fetchLiveProviders(
          factoryState,
          asset.tokenContractAddress,
        );
        setLiveProviders(providers);
      } catch (err) {
        console.error("Failed to load live TIR providers for request form", err);
        setLiveProviders(null);
      }
    };

    loadLiveProviders();
  }, [asset, factoryState]);

  useEffect(() => {
    const loadExistingIdentityData = async () => {
      if (!walletAddress) {
        setKycAutofilled(false);
        setInvestorCountry(null);
        setInvestorFidRegistered(null);
        setIdentityLoading(false);
        return;
      }

      if (!anchorProvider) {
        setIdentityLoading(true);
        return;
      }

      setIdentityLoading(true);
      try {
        const [existingKyc, previousRequest, investorFid] = await Promise.all([
          getKycApplicationByWallet(walletAddress),
          fetchPreviousKycProfile(walletAddress).catch(() => null),
          new IdentityService(anchorProvider).fetchFid(new PublicKey(walletAddress)),
        ]);
        const profile = hasKycProfileFields(existingKyc) ? existingKyc : previousRequest;

        setInvestorFidRegistered(Boolean(investorFid && !investorFid.isIssuer));
        setInvestorCountry(
          investorFid && !investorFid.isIssuer ? Number(investorFid.country) : null,
        );
        if (investorFid && !investorFid.isIssuer) {
          setFidCountryCode(String(investorFid.country));
        }

        setFormData((current) => {
          const next = { ...current };

          if (profile) {
            next.fullName = nonEmpty(current.fullName)
              ? current.fullName
              : profile.fullName || "";
            next.email = nonEmpty(current.email)
              ? current.email
              : profile.email || "";
            next.nationality = nonEmpty(current.nationality)
              ? current.nationality
              : profile.nationality || "";
            next.country = nonEmpty(current.country)
              ? current.country
              : profile.country || "";
            next.idDocumentUrl = nonEmpty(current.idDocumentUrl)
              ? current.idDocumentUrl
              : profile.idDocumentUrl || "";
            next.proofOfAddressUrl = nonEmpty(current.proofOfAddressUrl)
              ? current.proofOfAddressUrl
              : profile.proofOfAddressUrl || "";
          }

          if (investorFid && !investorFid.isIssuer) {
            next.country = String(investorFid.country);
          }

          return next;
        });

        setKycAutofilled(hasKycProfileFields(profile));
      } catch (err) {
        console.error("Failed to load previous KYC data for purchase request", err);
        setKycAutofilled(false);
        setInvestorCountry(null);
        setInvestorFidRegistered(false);
      } finally {
        setIdentityLoading(false);
      }
    };

    loadExistingIdentityData();
  }, [walletAddress, anchorProvider]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleCreateInvestorFid = async () => {
    if (!anchorProvider || !walletAddress) {
      toast.error("Connect the investor wallet before creating a FID.");
      return;
    }

    const countryCode = Number(fidCountryCode);
    if (!Number.isInteger(countryCode) || countryCode < 1 || countryCode > 999) {
      toast.error("Enter a valid numeric country code between 1 and 999.");
      return;
    }

    setRegisteringFid(true);
    const loadingToast = toast.loading("Creating investor FID...");
    try {
      const service = new IdentityService(anchorProvider);
      await service.ensureOwnFid(countryCode, false);
      const fid = await service.fetchFid(new PublicKey(walletAddress));
      setInvestorFidRegistered(Boolean(fid && !fid.isIssuer));
      setInvestorCountry(fid && !fid.isIssuer ? Number(fid.country) : countryCode);
      setFormData((current) => ({
        ...current,
        country: String(fid && !fid.isIssuer ? fid.country : countryCode),
      }));
      toast.success("Investor FID created. You can now request tokens.", {
        id: loadingToast,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create investor FID.",
        { id: loadingToast },
      );
    } finally {
      setRegisteringFid(false);
    }
  };

  const kycFieldsLocked =
    kycAutofilled &&
    nonEmpty(formData.fullName) &&
    nonEmpty(formData.email) &&
    nonEmpty(formData.nationality) &&
    nonEmpty(formData.country) &&
    nonEmpty(formData.idDocumentUrl) &&
    nonEmpty(formData.proofOfAddressUrl);

  const effectiveCountry = useMemo(() => {
    if (investorCountry !== null) return investorCountry;
    const parsedCountry = Number(formData.country);
    return Number.isFinite(parsedCountry) ? parsedCountry : null;
  }, [formData.country, investorCountry]);

  const blockedCountries = useMemo(
    () => (asset ? getBlockedCountries(asset) : []),
    [asset],
  );

  const countryRestricted = useMemo(
    () => (asset ? isInvestorCountryBlocked(asset, effectiveCountry) : false),
    [asset, effectiveCountry],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletAddress) {
      toast.error("Please connect your wallet first.");
      return;
    }
    
    if (!asset) {
      toast.error("Asset details not found.");
      return;
    }

    if (investorFidRegistered === false) {
      toast.error("Create your investor FID before requesting tokens.");
      return;
    }

    if (countryRestricted) {
      toast.error("This wallet is restricted from this asset by token compliance rules.");
      return;
    }

    setSubmitting(true);
    const loadingToast = toast.loading("Submitting purchase request...");

    try {
      const requiredClaimTopics = getRequiredClaimTopics(asset);
      const liveKycProvider =
        liveProviders?.find(
          (provider) => provider.isActive && provider.topics.includes(1),
        )?.walletAddress || "";
      const liveAmlProvider =
        liveProviders?.find(
          (provider) => provider.isActive && provider.topics.includes(2),
        )?.walletAddress || "";
      const kycProvider = requiredClaimTopics.includes("1")
        ? liveKycProvider || getProviderForTopic(asset, "1")
        : "";
      const amlProvider = requiredClaimTopics.includes("2")
        ? liveAmlProvider || getProviderForTopic(asset, "2")
        : "";
      const investorFid = anchorProvider
        ? await new IdentityService(anchorProvider).fetchFid(
            new PublicKey(walletAddress),
          )
        : null;
      if (!investorFid || investorFid.isIssuer) {
        setInvestorFidRegistered(false);
        toast.error("Create your investor FID before requesting tokens.", {
          id: loadingToast,
        });
        return;
      }

      const payload = {
        assetId: asset.id,
        tokenContract: asset.tokenContractAddress,
        investorWallet: walletAddress,
        issuerWallet: asset.issuerAddress,
        kycProvider,
        amlProvider,
        requiredClaimTopics,
        investorFidRegistered: true,
        documents: [
          {
            type: "ID_DOCUMENT",
            url: formData.idDocumentUrl,
          },
          {
            type: "PROOF_OF_ADDRESS",
            url: formData.proofOfAddressUrl,
          },
        ],
        ...formData,
        amount: parseFloat(formData.amount),
      };

      await apiFetch("/token-purchase-requests", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      toast.success("Request submitted successfully! The provider will review it shortly.", {
        id: loadingToast,
      });
      router.push(`/investor/${walletAddress}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast.error(`Submission failed: ${message}`, { id: loadingToast });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 glass-panel rounded-[22px] space-y-6">
        <Skeleton className="h-12 w-1/3 rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="p-8 glass-panel rounded-[22px] flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <FileText className="h-16 w-16 text-slate-300" />
        <h2 className="text-2xl font-bold text-slate-700">Invalid Request</h2>
        <p className="text-slate-500">No asset selected for purchase.</p>
        <Button onClick={() => router.push("/")}>Return to Dashboard</Button>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="p-8 glass-panel rounded-[22px] flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <Shield className="h-16 w-16 text-slate-300" />
        <h2 className="text-2xl font-bold text-slate-700">Wallet Connection Required</h2>
        <p className="text-slate-500">You must connect your wallet to submit a purchase request.</p>
        <Button size="lg" onClick={connectWallet}>Connect Wallet</Button>
      </div>
    );
  }

  if (identityLoading) {
    return (
      <div className="p-8 glass-panel rounded-[22px] flex flex-col items-center justify-center min-h-[50vh] text-center space-y-4">
        <Shield className="h-16 w-16 text-slate-300" />
        <h2 className="text-2xl font-bold text-slate-700">Checking Compliance</h2>
        <p className="text-slate-500">
          Reading your wallet FID country before opening the request form.
        </p>
      </div>
    );
  }

  if (investorFidRegistered === false) {
    return (
      <div className="p-8 glass-panel rounded-[22px] w-full max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Asset
        </Button>
        <Card className="border-amber-200 bg-amber-50/80 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-amber-100 p-3">
                <Shield className="h-6 w-6 text-amber-700" />
              </div>
              <div>
                <CardTitle className="text-amber-950">Investor FID Required</CardTitle>
                <CardDescription className="text-amber-800">
                  Create your on-chain investor FID before requesting {asset.name} tokens.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm leading-6 text-amber-900">
              This token uses identity compliance. Your FID country is checked
              against the token&apos;s country restriction rules before a purchase
              request can be submitted.
            </p>
            <div className="grid gap-3 rounded-xl border border-amber-200 bg-white/80 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="request-fid-country-code">Investor country code</Label>
                <Input
                  id="request-fid-country-code"
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
                  className="bg-white"
                />
                <p className="text-xs text-slate-500">
                  Use numeric ISO country code, for example 840 for United States.
                </p>
              </div>
              <Button
                type="button"
                disabled={registeringFid}
                onClick={handleCreateInvestorFid}
                className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] text-white"
              >
                {registeringFid ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  "Create Investor FID"
                )}
              </Button>
            </div>
            {blockedCountries.length > 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-sm">
                <p className="font-semibold text-slate-900">
                  Current blocked country codes for this token
                </p>
                <p className="mt-1 font-mono text-slate-700">
                  {blockedCountries.join(", ")}
                </p>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (countryRestricted && effectiveCountry !== null) {
    return (
      <div className="p-8 glass-panel rounded-[22px] w-full max-w-4xl mx-auto">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Asset
        </Button>
        <Card className="border-red-200 bg-red-50/80 shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-red-100 p-3">
                <AlertTriangle className="h-6 w-6 text-red-700" />
              </div>
              <div>
                <CardTitle className="text-red-900">Purchase Restricted</CardTitle>
                <CardDescription className="text-red-700">
                  This wallet cannot request tokens for {asset.name}.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-red-800">
            <p>
              Sorry, your investor country code {effectiveCountry} ({getCountryName(effectiveCountry)}) is blocked by this asset&apos;s compliance configuration.
            </p>
            <div className="rounded-xl border border-red-200 bg-white/70 p-4">
              <p className="font-semibold text-red-900">Blocked country codes</p>
              <p className="mt-1 font-mono">{blockedCountries.join(", ")}</p>
            </div>
            <p>
              KYC approval cannot override a token-level country restriction. Contact the issuer if you believe the identity country on your FID is incorrect.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-8 glass-panel rounded-[22px] w-full max-w-5xl mx-auto">
      <div className="mb-8">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Asset
        </Button>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">
          Token Purchase Request
        </h1>
        <p className="text-slate-600">
          You are requesting to purchase <span className="font-semibold text-slate-900">{asset.name} ({asset.symbol})</span>. 
          Please fill out the necessary Know Your Customer (KYC) details below.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card className="bg-white/90 border-slate-200/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Purchase Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount of Tokens</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="any"
                  placeholder="e.g. 1000"
                  required
                  value={formData.amount}
                  onChange={handleChange}
                  className="bg-white"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white/90 border-slate-200/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">KYC Information</CardTitle>
            <CardDescription>
              {kycAutofilled
                ? "Previous KYC details for this wallet were loaded automatically."
                : "Your details will be securely sent to the appointed KYC provider for verification."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Legal Name</Label>
                <Input
                  id="fullName"
                  name="fullName"
                  placeholder="John Doe"
                  required
                  value={formData.fullName}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="john@example.com"
                  required
                  value={formData.email}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nationality">Nationality</Label>
                <Input
                  id="nationality"
                  name="nationality"
                  placeholder="e.g. US"
                  required
                  value={formData.nationality}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="country">Country of Residence</Label>
                <Input
                  id="country"
                  name="country"
                  placeholder="e.g. United States"
                  required
                  value={formData.country}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2 col-span-1 md:col-span-2">
                <Label htmlFor="idDocumentUrl">ID Document URL (Passport/License)</Label>
                <Input
                  id="idDocumentUrl"
                  name="idDocumentUrl"
                  placeholder="https://storage.provider.com/doc..."
                  required
                  value={formData.idDocumentUrl}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
              <div className="space-y-2 col-span-1 md:col-span-2">
                <Label htmlFor="proofOfAddressUrl">Proof of Address URL (Utility Bill)</Label>
                <Input
                  id="proofOfAddressUrl"
                  name="proofOfAddressUrl"
                  placeholder="https://storage.provider.com/poa..."
                  required
                  value={formData.proofOfAddressUrl}
                  onChange={handleChange}
                  readOnly={kycFieldsLocked}
                  className="bg-white"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4 pt-4">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            Cancel
          </Button>
          <Button type="submit" disabled={submitting} className="bg-gradient-to-tr from-[#172E7F] to-[#2A5FA6] hover:from-[#13266A] hover:to-[#224D86] text-white rounded-[11px] min-w-[200px] font-medium border-none shadow-md shadow-blue-900/10">
            {submitting ? "Submitting..." : "Submit Purchase Request"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default function RequestFormPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 glass-panel rounded-[22px] min-h-[60vh] flex items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
        </div>
      }
    >
      <RequestFormContent />
    </Suspense>
  );
}
