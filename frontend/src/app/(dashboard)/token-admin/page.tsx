"use client";

import { Suspense, startTransition, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet as useSolanaWallet } from "@solana/wallet-adapter-react";
import {
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { TokenSelector } from "@/components/rwa/token-selector";
import { useAssetsContext } from "@/contexts/assets-context";
import { useWallet } from "@/hooks/use-wallet";
import { apiFetch } from "@/lib/backend";
import { TransactionToastLink } from "@/lib/solscan";
import {
  buildInstructionData,
  connection,
  encodePubkey,
  encodeString,
  encodeVecU64,
  fetchFactoryStateAccount,
  type FactoryStateAccount,
} from "@/lib/solana";

const KYC_TOPIC = 1;
const AML_TOPIC = 2;

type ProviderRole = "kyc" | "aml";

type IssuerEntry = {
  issuerFid: PublicKey;
  tir: PublicKey;
  topics: number[];
  isActive: boolean;
  label: string;
};

type TokenAdminState = {
  tirState: PublicKey;
  tirOwner: string;
  kycProvider?: ProviderDetails;
  amlProvider?: ProviderDetails;
};

type ProviderDetails = {
  walletAddress: string;
  issuerFid: string;
  topics: number[];
  isActive: boolean;
  label?: string;
};

type TrustedIssuer = {
  id: string;
  walletAddress: string;
  authorityName: string;
  kycAuthorized: boolean;
  amlAuthorized: boolean;
};

function shorten(value?: string | null, head = 6, tail = 5) {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

function isValidPublicKey(value: string) {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
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

function deriveIssuerEntryPda(
  tirState: PublicKey,
  issuerFid: PublicKey,
  tirProgramId: PublicKey,
) {
  return derivePda(
    [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
    tirProgramId,
  );
}

function readString(data: Buffer, offset: number) {
  const length = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + length;
  return {
    value: data.subarray(start, end).toString("utf8"),
    nextOffset: end,
  };
}

function parseIssuerEntry(data: Buffer): IssuerEntry | null {
  if (data.length < 8 + 32 + 32 + 4) return null;

  let offset = 8;
  const issuerFid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const tir = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

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
  offset += 1;

  const label = data.length >= offset + 4 ? readString(data, offset).value : "";

  return { issuerFid, tir, topics, isActive, label };
}

function parseTirOwner(data: Buffer) {
  if (data.length < 40) return null;
  return new PublicKey(data.subarray(8, 40)).toBase58();
}

function parseFidIsIssuer(data: Buffer) {
  return data.length > 108 && data.readUInt8(108) === 1;
}

function parseFidOwner(data: Buffer) {
  if (data.length < 40) return null;
  return new PublicKey(data.subarray(8, 40)).toBase58();
}

async function fetchOnChainProviders(
  deps: FactoryStateAccount,
  tirState: PublicKey,
): Promise<ProviderDetails[]> {
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

      // The token program verifies issuer FIDs against the canonical active FID
      // PDA. Older stale entries may deserialize but are ignored on-chain.
      if (!canonicalIssuerFid.equals(parsed.issuerFid)) return null;

      return {
        walletAddress,
        issuerFid: parsed.issuerFid.toBase58(),
        topics: parsed.topics,
        isActive: parsed.isActive,
        label: parsed.label,
      };
    }),
  );

  return providers.filter(Boolean) as ProviderDetails[];
}

async function fetchIssuerEntryByWallet(
  deps: FactoryStateAccount,
  tirState: PublicKey,
  providerWallet: PublicKey,
) {
  const issuerFid = deriveFidPda(providerWallet, deps.fidProgramId);
  const issuerEntry = deriveIssuerEntryPda(tirState, issuerFid, deps.tirProgramId);
  const info = await connection.getAccountInfo(issuerEntry, "confirmed");
  return {
    issuerFid,
    issuerEntry,
    parsed: info ? parseIssuerEntry(info.data) : null,
  };
}

async function assertIssuerFid(deps: FactoryStateAccount, providerWallet: PublicKey) {
  const issuerFid = deriveFidPda(providerWallet, deps.fidProgramId);
  const fidInfo = await connection.getAccountInfo(issuerFid, "confirmed");
  if (!fidInfo) {
    throw new Error("Provider wallet must register an issuer FID first.");
  }
  if (!parseFidIsIssuer(fidInfo.data)) {
    throw new Error("Provider FID exists, but it is not registered as an issuer.");
  }
  return issuerFid;
}

function buildTirInstruction(
  programId: PublicKey,
  accounts: TransactionInstruction["keys"],
  data: Buffer,
) {
  return new TransactionInstruction({ programId, keys: accounts, data });
}

function tokenExplorerUrl(address: string) {
  return `https://solscan.io/token/${address}?cluster=devnet`;
}

function accountExplorerUrl(address: string) {
  return `https://solscan.io/account/${address}?cluster=devnet`;
}

function authorizedTopicLabel(issuer: TrustedIssuer) {
  return [
    issuer.kycAuthorized ? "KYC topic 1" : null,
    issuer.amlAuthorized ? "AML topic 2" : null,
  ].filter(Boolean).join(", ");
}

function TokenAdminPageContent() {
  const searchParams = useSearchParams();
  const { isConnected, connectWallet, address } = useWallet();
  const solanaWallet = useSolanaWallet();
  const { assets, loading: assetsLoading, error, loadAssets } = useAssetsContext();

  const [selectedTokenContract, setSelectedTokenContract] = useState<string | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [factoryState, setFactoryState] = useState<FactoryStateAccount | null>(null);
  const [adminState, setAdminState] = useState<TokenAdminState | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [workingRole, setWorkingRole] = useState<ProviderRole | null>(null);
  const [kycWallet, setKycWallet] = useState("");
  const [amlWallet, setAmlWallet] = useState("");
  const [trustedIssuers, setTrustedIssuers] = useState<TrustedIssuer[]>([]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.tokenContractAddress === selectedTokenContract) || null,
    [assets, selectedTokenContract],
  );

  useEffect(() => {
    const assetId = searchParams.get("asset");
    const symbol = searchParams.get("symbol");

    if (selectedTokenContract || assets.length === 0) return;

    const asset = assets.find((item) => item.id === assetId || item.symbol === symbol);
    if (asset) {
      startTransition(() => {
        setSelectedTokenContract(asset.tokenContractAddress);
        setSelectedSymbol(asset.symbol);
      });
    }
  }, [assets, searchParams, selectedTokenContract]);

  useEffect(() => {
    const loadFactory = async () => {
      try {
        setFactoryState(await fetchFactoryStateAccount());
      } catch (err) {
        console.error("Failed to load factory state", err);
      }
    };

    loadFactory();
  }, []);

  useEffect(() => {
    const loadTrustedIssuers = async () => {
      try {
        setTrustedIssuers(await apiFetch<TrustedIssuer[]>("/trusted-issuers"));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load trusted issuers.");
      }
    };

    void loadTrustedIssuers();
  }, []);

  useEffect(() => {
    const loadTokenAdminState = async () => {
      if (!factoryState || !selectedAsset) {
        setAdminState(null);
        return;
      }

      setLoadingDetails(true);
      try {
        const tokenMint = new PublicKey(selectedAsset.tokenContractAddress);
        const tirState = deriveTirStatePda(tokenMint, factoryState.tirProgramId);
        const tirInfo = await connection.getAccountInfo(tirState, "confirmed");
        const tirOwner = tirInfo ? parseTirOwner(tirInfo.data) : null;

        if (!tirOwner) {
          setAdminState(null);
          return;
        }

        const providers = await fetchOnChainProviders(factoryState, tirState);
        const kycProvider = providers.find(
          (provider) => provider.isActive && provider.topics.includes(KYC_TOPIC),
        );
        const amlProvider = providers.find(
          (provider) => provider.isActive && provider.topics.includes(AML_TOPIC),
        );

        setAdminState({
          tirState,
          tirOwner,
          kycProvider,
          amlProvider,
        });
        setKycWallet(kycProvider?.walletAddress || "");
        setAmlWallet(amlProvider?.walletAddress || "");
      } catch (err: unknown) {
        toast.error(
          err instanceof Error
            ? err.message
            : "Failed to load token admin details",
        );
      } finally {
        setLoadingDetails(false);
      }
    };

    loadTokenAdminState();
  }, [factoryState, selectedAsset]);

  const signerIsTirOwner =
    !!address &&
    !!adminState?.tirOwner &&
    adminState.tirOwner.toLowerCase() === address.toLowerCase();

  const sendTirInstructions = async (instructions: TransactionInstruction[]) => {
    if (!solanaWallet.publicKey || !solanaWallet.sendTransaction) {
      throw new Error("Connect a wallet that can sign Solana transactions.");
    }

    const tx = new Transaction().add(...instructions);
    tx.feePayer = solanaWallet.publicKey;
    const signature = await solanaWallet.sendTransaction(tx, connection);
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  };

  const buildRemoveOrUpdatePreviousProvider = async (
    providerWallet: string | undefined,
    topic: number,
  ) => {
    if (!factoryState || !adminState || !providerWallet || !isValidPublicKey(providerWallet)) {
      return [];
    }

    const previousWallet = new PublicKey(providerWallet);
    const { issuerEntry, parsed } = await fetchIssuerEntryByWallet(
      factoryState,
      adminState.tirState,
      previousWallet,
    );
    if (!parsed?.isActive || !parsed.topics.includes(topic)) return [];

    const remainingTopics = parsed.topics.filter((item) => item !== topic);
    const baseAccounts = [
      { pubkey: solanaWallet.publicKey!, isSigner: true, isWritable: true },
      { pubkey: adminState.tirState, isSigner: false, isWritable: true },
      { pubkey: issuerEntry, isSigner: false, isWritable: true },
    ];

    if (remainingTopics.length === 0) {
      return [
        buildTirInstruction(
          factoryState.tirProgramId,
          baseAccounts,
          buildInstructionData("remove_trusted_issuer"),
        ),
      ];
    }

    return [
      buildTirInstruction(
        factoryState.tirProgramId,
        baseAccounts,
        buildInstructionData("update_issuer_topics", encodeVecU64(remainingTopics)),
      ),
    ];
  };

  const updateProvider = async (role: ProviderRole) => {
    if (!factoryState || !adminState || !selectedAsset) return;

    const topic = role === "kyc" ? KYC_TOPIC : AML_TOPIC;
    const walletValue = role === "kyc" ? kycWallet.trim() : amlWallet.trim();
    const currentProvider =
      role === "kyc" ? adminState.kycProvider : adminState.amlProvider;

    if (!signerIsTirOwner) {
      toast.error("Only the current TIR owner can update trusted issuers.");
      return;
    }
    if (!walletValue || !isValidPublicKey(walletValue)) {
      toast.error("Enter a valid provider wallet address.");
      return;
    }
    const registryIssuer = trustedIssuers.find(
      (issuer) => issuer.walletAddress === walletValue,
    );
    const authorized =
      role === "kyc"
        ? registryIssuer?.kycAuthorized
        : registryIssuer?.amlAuthorized;
    if (!registryIssuer || !authorized) {
      toast.error(`Select a Personnel-approved issuer authorized for ${role.toUpperCase()}.`);
      return;
    }

    setWorkingRole(role);
    const toastId = toast.loading(
      `Updating ${role.toUpperCase()} trusted issuer...`,
    );

    try {
      const providerWallet = new PublicKey(walletValue);
      const issuerFid = await assertIssuerFid(factoryState, providerWallet);
      const { issuerEntry, parsed } = await fetchIssuerEntryByWallet(
        factoryState,
        adminState.tirState,
        providerWallet,
      );

      const instructions = [
        ...(currentProvider?.walletAddress &&
        currentProvider.walletAddress !== walletValue
          ? await buildRemoveOrUpdatePreviousProvider(currentProvider.walletAddress, topic)
          : []),
      ];

      const mergedTopics = Array.from(new Set([...(parsed?.topics || []), topic]));
      const baseAccounts = [
        { pubkey: solanaWallet.publicKey!, isSigner: true, isWritable: true },
        { pubkey: adminState.tirState, isSigner: false, isWritable: true },
        { pubkey: issuerEntry, isSigner: false, isWritable: true },
      ];

      if (parsed) {
        instructions.push(
          buildTirInstruction(
            factoryState.tirProgramId,
            baseAccounts,
            buildInstructionData("update_issuer_topics", encodeVecU64(mergedTopics)),
          ),
        );
        if (!parsed.isActive) {
          instructions.push(
            buildTirInstruction(
              factoryState.tirProgramId,
              baseAccounts,
              buildInstructionData("reactivate_issuer"),
            ),
          );
        }
      } else {
        instructions.push(
          buildTirInstruction(
            factoryState.tirProgramId,
            [
              ...baseAccounts,
              {
                pubkey: SystemProgram.programId,
                isSigner: false,
                isWritable: false,
              },
            ],
            buildInstructionData(
              "add_trusted_issuer",
              encodePubkey(issuerFid),
              encodeVecU64([topic]),
              encodeString(role.toUpperCase()),
            ),
          ),
        );
      }

      const signature = await sendTirInstructions(instructions);
      toast.success(`${role.toUpperCase()} provider updated`, {
        id: toastId,
        description: <TransactionToastLink signature={signature} />,
      });

      await loadAssets();
      const providers = await fetchOnChainProviders(factoryState, adminState.tirState);
      setAdminState((prev) =>
        prev
          ? {
              ...prev,
              kycProvider: providers.find(
                (provider) =>
                  provider.isActive && provider.topics.includes(KYC_TOPIC),
              ),
              amlProvider: providers.find(
                (provider) =>
                  provider.isActive && provider.topics.includes(AML_TOPIC),
              ),
            }
          : prev,
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update provider",
        { id: toastId },
      );
    } finally {
      setWorkingRole(null);
    }
  };

  const removeProvider = async (role: ProviderRole) => {
    if (!factoryState || !adminState) return;
    const topic = role === "kyc" ? KYC_TOPIC : AML_TOPIC;
    const currentProvider =
      role === "kyc" ? adminState.kycProvider : adminState.amlProvider;
    if (!currentProvider?.walletAddress) return;

    if (!signerIsTirOwner) {
      toast.error("Only the current TIR owner can update trusted issuers.");
      return;
    }

    setWorkingRole(role);
    const toastId = toast.loading(`Removing ${role.toUpperCase()} provider...`);
    try {
      const instructions = await buildRemoveOrUpdatePreviousProvider(
        currentProvider.walletAddress,
        topic,
      );
      if (instructions.length === 0) {
        throw new Error("No active provider entry found for this topic.");
      }
      const signature = await sendTirInstructions(instructions);
      toast.success(`${role.toUpperCase()} provider removed`, {
        id: toastId,
        description: <TransactionToastLink signature={signature} />,
      });

      if (role === "kyc") setKycWallet("");
      if (role === "aml") setAmlWallet("");
      const providers = await fetchOnChainProviders(factoryState, adminState.tirState);
      setAdminState((prev) =>
        prev
          ? {
              ...prev,
              kycProvider: providers.find(
                (provider) =>
                  provider.isActive && provider.topics.includes(KYC_TOPIC),
              ),
              amlProvider: providers.find(
                (provider) =>
                  provider.isActive && provider.topics.includes(AML_TOPIC),
              ),
            }
          : prev,
      );
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Failed to remove provider",
        { id: toastId },
      );
    } finally {
      setWorkingRole(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="p-8 glass-panel rounded-[22px]">
        <div className="mx-auto flex min-h-[50vh] max-w-lg flex-col items-center justify-center text-center">
          <div className="mb-4 rounded-2xl bg-[#172E7F] p-4 text-white">
            <Shield className="h-8 w-8" />
          </div>
          <h1 className="text-3xl font-bold">Token Admin</h1>
          <p className="mt-2 text-sm text-slate-600">
            Connect the TIR owner wallet to manage token-level KYC and AML
            providers.
          </p>
          <Button className="mt-6 bg-[#172E7F] hover:bg-[#21439B]" onClick={connectWallet}>
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 glass-panel rounded-[22px]">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#172E7F]">
            <Shield className="h-3.5 w-3.5" />
            Solana TIR Controls
          </div>
          <h1 className="text-3xl font-bold text-slate-950">Token Admin</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Manage trusted KYC and AML claim providers for a selected token. The
            connected wallet must be the token&apos;s Trusted Issuers Registry
            owner.
          </p>
        </div>
        <Button variant="outline" onClick={loadAssets} disabled={assetsLoading}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="mb-6 rounded-2xl border-slate-200 bg-white">
        <CardHeader>
          <CardTitle>Select Token</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(280px,420px)_1fr]">
          <TokenSelector
            selectedTokenContract={selectedTokenContract}
            onSelect={(contract, _assetId, symbol) => {
              setSelectedTokenContract(contract);
              setSelectedSymbol(symbol);
            }}
          />
          {selectedAsset && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-semibold text-slate-950">
                {selectedAsset.name} ({selectedSymbol})
              </div>
              <a
                className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-[#172E7F]"
                href={tokenExplorerUrl(selectedAsset.tokenContractAddress)}
                target="_blank"
                rel="noreferrer"
              >
                {shorten(selectedAsset.tokenContractAddress, 12, 8)}
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {assetsLoading || loadingDetails ? (
        <div className="space-y-4">
          <Skeleton className="h-36 rounded-2xl" />
          <Skeleton className="h-80 rounded-2xl" />
        </div>
      ) : !selectedAsset ? (
        <Alert>
          <AlertDescription>
            Select a deployed token to view issuer and trusted provider controls.
          </AlertDescription>
        </Alert>
      ) : !adminState ? (
        <Alert variant="destructive">
          <AlertDescription>
            Could not load this token&apos;s Trusted Issuers Registry. Verify the
            token was deployed by the active Solana factory.
          </AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
          <Card className="rounded-2xl border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>Registry Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <InfoRow
                label="Trusted Issuers Registry Owner"
                value={adminState.tirOwner}
                badge={signerIsTirOwner ? "Connected" : "Owner required"}
              />
              {selectedAsset.issuerAddress && (
                <InfoRow label="Issuer" value={selectedAsset.issuerAddress} />
              )}
              {adminState.kycProvider && (
                <ProviderRow title="KYC Provider" provider={adminState.kycProvider} />
              )}
              {adminState.amlProvider && (
                <ProviderRow title="AML Provider" provider={adminState.amlProvider} />
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-slate-200 bg-white">
            <CardHeader>
              <CardTitle>Update Providers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {!signerIsTirOwner && (
                <Alert className="border-amber-200 bg-amber-50 text-amber-900">
                  <AlertDescription>
                    Connected wallet {shorten(address)} is not the TIR owner.
                    Provider updates will be rejected on-chain.
                  </AlertDescription>
                </Alert>
              )}

              <ProviderEditor
                title="KYC Provider"
                topic={KYC_TOPIC}
                value={kycWallet}
                onChange={setKycWallet}
                onSave={() => updateProvider("kyc")}
                onRemove={() => removeProvider("kyc")}
                isWorking={workingRole === "kyc"}
                canRemove={!!adminState.kycProvider}
                disabled={!signerIsTirOwner || !!workingRole}
                options={trustedIssuers.filter((issuer) => issuer.kycAuthorized)}
              />

              <ProviderEditor
                title="AML Provider"
                topic={AML_TOPIC}
                value={amlWallet}
                onChange={setAmlWallet}
                onSave={() => updateProvider("aml")}
                onRemove={() => removeProvider("aml")}
                isWorking={workingRole === "aml"}
                canRemove={!!adminState.amlProvider}
                disabled={!signerIsTirOwner || !!workingRole}
                options={trustedIssuers.filter((issuer) => issuer.amlAuthorized)}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function InfoRow({
  label,
  value,
  badge,
}: {
  label: string;
  value: string;
  badge?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {label}
          </div>
          <a
            className="mt-2 inline-flex items-center gap-1 font-mono text-sm text-slate-900"
            href={accountExplorerUrl(value)}
            target="_blank"
            rel="noreferrer"
          >
            {shorten(value, 14, 10)}
            <ExternalLink className="h-3 w-3 text-[#172E7F]" />
          </a>
        </div>
        {badge && (
          <Badge variant="secondary" className="rounded-full">
            {badge}
          </Badge>
        )}
      </div>
    </div>
  );
}

function ProviderRow({
  title,
  provider,
}: {
  title: string;
  provider: ProviderDetails;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            {title}
          </div>
          <div className="mt-2 font-mono text-sm text-slate-950">
            {shorten(provider.walletAddress, 14, 10)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            FID {shorten(provider.issuerFid, 12, 8)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {provider.topics.map((topic) => (
            <Badge key={topic} className="bg-[#172E7F] text-white">
              Topic {topic}
            </Badge>
          ))}
          <Badge variant={provider.isActive ? "secondary" : "destructive"}>
            {provider.isActive ? "Active" : "Inactive"}
          </Badge>
        </div>
      </div>
    </div>
  );
}

function ProviderEditor({
  title,
  topic,
  value,
  onChange,
  onSave,
  onRemove,
  isWorking,
  canRemove,
  disabled,
  options,
}: {
  title: string;
  topic: number;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onRemove: () => void;
  isWorking: boolean;
  canRemove: boolean;
  disabled: boolean;
  options: TrustedIssuer[];
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-semibold">{title}</Label>
          <p className="text-xs text-slate-500">Claim topic {topic}</p>
        </div>
        {canRemove && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Remove
          </Button>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-full bg-white">
            <SelectValue placeholder="Select an approved trusted issuer" />
          </SelectTrigger>
          <SelectContent>
            {options.map((issuer) => (
              <SelectItem key={issuer.id} value={issuer.walletAddress}>
                <span className="flex flex-col text-left">
                  <span className="font-medium">{issuer.authorityName}</span>
                  <span className="font-mono text-xs text-slate-500">
                    {shorten(issuer.walletAddress, 12, 8)} · {authorizedTopicLabel(issuer)}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {options.length === 0 ? (
          <p className="text-xs text-amber-700">
            No approved trusted issuers are authorized for this topic. Add one in Personnel first.
          </p>
        ) : null}
        <Button
          type="button"
          className="bg-[#172E7F] hover:bg-[#21439B]"
          disabled={disabled || isWorking || !value}
          onClick={onSave}
        >
          {isWorking ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Plus className="mr-2 h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function TokenAdminPage() {
  return (
    <Suspense
      fallback={
        <div className="p-8 glass-panel rounded-[22px]">
          <div className="flex min-h-[60vh] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#172E7F]" />
          </div>
        </div>
      }
    >
      <TokenAdminPageContent />
    </Suspense>
  );
}
