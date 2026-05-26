"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { PublicKey } from "@solana/web3.js";
import { ArrowLeft, FileText, Shield } from "lucide-react";
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
import { IdentityService } from "@/services/identity";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import type { RWAAsset } from "@/types/rwa";

type TrustedIssuerMetadata = {
  label?: string;
  walletAddress?: string;
  topics?: Array<string | number>;
};

type LiveProvider = {
  walletAddress: string;
  topics: number[];
  isActive: boolean;
};

function getTrustedIssuers(asset: RWAAsset): TrustedIssuerMetadata[] {
  const trustedIssuers = asset.metadata?.trustedIssuers;
  return Array.isArray(trustedIssuers) ? trustedIssuers : [];
}

function topicStrings(topics: unknown): string[] {
  if (!Array.isArray(topics)) return [];
  return topics.map((topic) => String(topic));
}

function getRequiredClaimTopics(asset: RWAAsset) {
  const metadataTopics = topicStrings(asset.metadata?.claimTopics);
  if (metadataTopics.length > 0) return [...new Set(metadataTopics)];

  const fromIssuers = getTrustedIssuers(asset).flatMap((issuer) =>
    topicStrings(issuer.topics),
  );
  if (fromIssuers.length > 0) return [...new Set(fromIssuers)];

  return [
    ...(asset.kycRequired ? ["1"] : []),
    ...(asset.amlRequired ? ["2"] : []),
  ];
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

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

      const payload = {
        assetId: asset.id,
        tokenContract: asset.tokenContractAddress,
        investorWallet: walletAddress,
        issuerWallet: asset.issuerAddress,
        kycProvider,
        amlProvider,
        requiredClaimTopics,
        investorFidRegistered: Boolean(investorFid),
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

      toast.success(
        investorFid
          ? "Request submitted successfully! The provider will review it shortly."
          : "Request submitted. Register your FID to send it for provider review.",
        { id: loadingToast },
      );
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
              Your details will be securely sent to the appointed KYC provider for verification.
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
