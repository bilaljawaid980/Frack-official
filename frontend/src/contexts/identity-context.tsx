"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  ReactNode,
} from "react";
import { PublicKey } from "@solana/web3.js";
import { toast } from "sonner";
import { TrexClient } from "@/lib/trex-client";
import { queryCache } from "@/lib/query-cache";
import { useAppContext } from "@/contexts/app-context";
import {
  connection,
  deriveFidPDA,
  deriveIrpStatePDA,
  deriveWalletIdentityPDA,
} from "@/lib/solana";
import { TREX_CONTRACTS } from "@/lib/zigchain-config";

export interface UserIdentity {
  wallet: string;
  onchainIdAddress: string | null;
  country: string | null;
  isVerified: boolean;
  verificationReason: string | null;
  claims: IdentityClaim[];
}

export interface IdentityClaim {
  id: number;
  topic: number;
  topicName: string;
  issuer: string;
  data: string | null;
  issuedAt: number;
  expiresAt: number | null;
  revoked: boolean;
}

interface IdentityContextType {
  identity: UserIdentity | null;
  loading: boolean;
  error: string | null;
  loadIdentity: () => Promise<void>;
  createOnchainId: () => Promise<string>;
  registerIdentity: (country: string) => Promise<string>;
  addClaim: (topic: number, data?: string, expiresAt?: number) => Promise<string>;
  hasOnchainId: boolean;
  isVerified: boolean;
  claims: IdentityClaim[];
}

const IdentityContext = createContext<IdentityContextType | undefined>(undefined);

const getTopicName = (topic: number): string => {
  const topicMap: Record<number, string> = {
    1: "KYC Verified",
    2: "AML Checked",
    3: "Accredited Investor",
    4: "Country Approved",
    5: "Age Verified",
  };
  return topicMap[topic] || `Topic ${topic}`;
};

function toPublicKey(value?: string | null) {
  if (!value) return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

async function fetchIdentityFromChain(walletAddress: string) {
  const wallet = toPublicKey(walletAddress);
  const tokenMint = toPublicKey(TREX_CONTRACTS.token);
  if (!wallet || !tokenMint) {
    return null;
  }

  const [irpState] = deriveIrpStatePDA(tokenMint);
  const irpInfo = await connection.getAccountInfo(irpState, "confirmed");
  if (!irpInfo || irpInfo.data.length < 104) {
    return {
      wallet: walletAddress,
      onchainIdAddress: null,
      country: null,
      isVerified: false,
      verificationReason: "Identity registry not initialized",
      claims: [],
    } satisfies UserIdentity;
  }

  const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
  const [walletIdentity] = deriveWalletIdentityPDA(irsState, wallet);
  const identityInfo = await connection.getAccountInfo(walletIdentity, "confirmed");
  if (!identityInfo || identityInfo.data.length < 74) {
    return {
      wallet: walletAddress,
      onchainIdAddress: null,
      country: null,
      isVerified: false,
      verificationReason: "Wallet identity not registered",
      claims: [],
    } satisfies UserIdentity;
  }

  const fid = new PublicKey(identityInfo.data.subarray(40, 72)).toBase58();
  const country = identityInfo.data.readUInt16LE(72).toString();

  return {
    wallet: walletAddress,
    onchainIdAddress: fid,
    country,
    isVerified: false,
    verificationReason: "Wallet identity found, claims verification pending",
    claims: [],
  } satisfies UserIdentity;
}

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { trexClient, address: walletAddress } = useAppContext();
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingOnchainId, setPendingOnchainId] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const loadIdentity = useCallback(async () => {
    if (!walletAddress) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const cacheKey = `identity:${walletAddress.toLowerCase()}`;
      const userIdentity = await queryCache.query(cacheKey, async () => {
        if (trexClient) {
          return trexClient.getUserIdentity(walletAddress);
        }
        return fetchIdentityFromChain(walletAddress);
      }, 20_000);

      if (!userIdentity) {
        setIdentity(null);
        return;
      }

      if (requestId !== requestIdRef.current) return;

      const claimsWithNames = (userIdentity.claims || []).map(
        (claim: any, index: number) => ({
          id: claim.id || index,
          topic: claim.topic,
          topicName: getTopicName(claim.topic),
          issuer: claim.issuer,
          data: claim.data || null,
          issuedAt: claim.issued_at || Date.now(),
          expiresAt: claim.expires_at || null,
          revoked: claim.revoked || false,
        }),
      );

      setIdentity({
        wallet: userIdentity.wallet,
        onchainIdAddress: userIdentity.onchainIdAddress || pendingOnchainId,
        country: userIdentity.country || null,
        isVerified: userIdentity.isVerified || false,
        verificationReason: userIdentity.verificationReason || null,
        claims: claimsWithNames,
      });

      if (userIdentity.onchainIdAddress && pendingOnchainId) {
        setPendingOnchainId(null);
      }
    } catch (err: any) {
      if (requestId !== requestIdRef.current) return;
      setError(err.message);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [walletAddress, trexClient]);

  const createOnchainId = useCallback(async () => {
    if (!trexClient || !walletAddress) {
      throw new Error("Wallet not connected");
    }

    setLoading(true);
    const loadingToast = toast.loading("Creating your OnchainID...");

    try {
      const walletPk = toPublicKey(walletAddress);
      if (!walletPk) {
        throw new Error("Invalid wallet address");
      }

      const [fidPda] = deriveFidPDA(walletPk);
      const existingFid = await connection.getAccountInfo(fidPda, "confirmed");
      if (existingFid) {
        const existing = fidPda.toBase58();
        setPendingOnchainId(existing);
        queryCache.invalidate(`identity:${walletAddress.toLowerCase()}`);
        toast.success("OnchainID already exists", {
          id: loadingToast,
          description: `Address: ${existing.slice(0, 20)}...`,
        });
        await loadIdentity();
        return existing;
      }

      const onchainIdAddress = await trexClient.createOnChainId(
        walletAddress,
        `OnchainID-${walletAddress.slice(0, 10)}`,
      );

      setPendingOnchainId(onchainIdAddress);
      queryCache.invalidate(`identity:${walletAddress.toLowerCase()}`);

      toast.success("OnchainID created!", {
        id: loadingToast,
        description: `Address: ${onchainIdAddress.slice(0, 20)}...`,
      });

      await loadIdentity();
      return onchainIdAddress;
    } catch (err: any) {
      toast.error(`Failed to create OnchainID: ${err.message}`, {
        id: loadingToast,
      });
      setError(err.message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [trexClient, walletAddress, loadIdentity]);

  const registerIdentity = useCallback(
    async (country: string) => {
      if (!trexClient || !walletAddress) {
        throw new Error("Wallet not connected");
      }

      const onchainIdToRegister =
        identity?.onchainIdAddress || pendingOnchainId;
      if (!onchainIdToRegister) {
        throw new Error("OnchainID must be created first");
      }

      setLoading(true);
      const loadingToast = toast.loading("Registering your identity...");

      try {
        const txHash = await trexClient.registerIdentity(
          walletAddress,
          onchainIdToRegister,
          country,
        );

        toast.success("Identity registered!", {
          id: loadingToast,
          description: `TX: ${txHash.slice(0, 10)}...`,
        });

        setPendingOnchainId(null);
        queryCache.invalidate(`identity:${walletAddress.toLowerCase()}`);
        await loadIdentity();
        return txHash;
      } catch (err: any) {
        toast.error(`Failed to register identity: ${err.message}`, {
          id: loadingToast,
        });
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [trexClient, walletAddress, identity, pendingOnchainId, loadIdentity],
  );

  const addClaim = useCallback(
    async (topic: number, data?: string, expiresAt?: number) => {
      if (!trexClient || !walletAddress) {
        throw new Error("Wallet not connected");
      }

      const onchainIdToUse = identity?.onchainIdAddress || pendingOnchainId;
      if (!onchainIdToUse) {
        throw new Error("OnchainID required");
      }

      setLoading(true);
      const topicName = getTopicName(topic);
      const loadingToast = toast.loading(`Adding ${topicName} claim...`);

      try {
        const txHash = await trexClient.addClaim(
          onchainIdToUse,
          topic,
          data,
          expiresAt,
        );

        toast.success(`${topicName} claim added!`, { id: loadingToast });
        queryCache.invalidate(`identity:${walletAddress.toLowerCase()}`);
        await loadIdentity();
        return txHash;
      } catch (err: any) {
        toast.error(`Failed to add claim: ${err.message}`, {
          id: loadingToast,
        });
        setError(err.message);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [trexClient, walletAddress, identity, pendingOnchainId, loadIdentity],
  );

  useEffect(() => {
    if (!walletAddress) {
      setIdentity(null);
      setError(null);
      setLoading(false);
      setPendingOnchainId(null);
      return;
    }

    loadIdentity();
  }, [walletAddress, loadIdentity]);

  const value = useMemo(() => ({
    identity,
    loading,
    error,
    loadIdentity,
    createOnchainId,
    registerIdentity,
    addClaim,
    hasOnchainId: !!identity?.onchainIdAddress,
    isVerified: identity?.isVerified || false,
    claims: identity?.claims || [],
  }), [
    identity,
    loading,
    error,
    loadIdentity,
    createOnchainId,
    registerIdentity,
    addClaim,
  ]);

  return (
    <IdentityContext.Provider value={value}>
      {children}
    </IdentityContext.Provider>
  );
}

export function useIdentityContext() {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentityContext must be used within IdentityProvider");
  }
  return context;
}
