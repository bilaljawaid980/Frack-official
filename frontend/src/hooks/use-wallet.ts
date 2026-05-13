'use client';

import { useCallback, useEffect } from 'react';
import { useWallet as useSolanaWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { TrexClient } from '@/lib/trex-client';
import { toast } from 'sonner';
import { useAppContext } from '@/contexts/app-context';
import { queryCache } from '@/lib/query-cache';
import type { ComplianceConfigResponse } from '@/types/trex-contracts';

let sharedHydrationKey = '';
let sharedHydrationPromise: Promise<{
  address: string;
  client: TrexClient;
  balance: string;
} | null> | null = null;

export function useWallet() {
  const {
    address,
    balance,
    trexClient,
    setWalletState,
    setIsConnecting,
    clearWalletState,
    isConnecting,
  } = useAppContext();

  const solanaWallet = useSolanaWallet();
  const {
    publicKey,
    connected,
    connecting,
    disconnect,
    wallet,
    signTransaction,
    signAllTransactions,
    signMessage,
  } = solanaWallet;
  const { setVisible } = useWalletModal();

  const connectWallet = useCallback(async () => {
    try {
      setIsConnecting(true);
      setVisible(true);
    } catch (error: any) {
      console.error('Failed to open wallet modal:', error);
      toast.error(error?.message || 'Failed to connect wallet');
      setIsConnecting(false);
    }
  }, [setVisible, setIsConnecting]);

  // Backward-compatible alias while some UI call sites still use legacy naming.
  const connectLeap = connectWallet;

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnect();
      clearWalletState();
      toast.info('Wallet disconnected');
    } catch (error: any) {
      console.error('Failed to disconnect wallet:', error);
      toast.error(error?.message || 'Failed to disconnect wallet');
    }
  }, [disconnect, clearWalletState]);

  const refreshBalance = useCallback(async () => {
    if (address && trexClient) {
      try {
        const nativeBal = await trexClient.getNativeBalance(address);
        setWalletState(address, trexClient, nativeBal);
      } catch (error) {
        console.error('Failed to refresh balance:', error);
      }
    }
  }, [address, trexClient, setWalletState]);

  useEffect(() => {
    const hydrateWallet = async () => {
      const walletAddress = publicKey?.toBase58() || '';
      const hydrateKey = `${connected}:${walletAddress}`;

      if (!publicKey || !connected) {
        if (sharedHydrationKey !== hydrateKey) {
          sharedHydrationKey = hydrateKey;
          clearWalletState();
        }
        return;
      }

      if (address === walletAddress && trexClient && sharedHydrationKey === hydrateKey) {
        return;
      }

      try {
        setIsConnecting(true);

        if (!sharedHydrationPromise) {
          sharedHydrationPromise = (async () => {
            const anchorWallet = {
              publicKey,
              signTransaction: signTransaction!,
              signAllTransactions: signAllTransactions!,
              signMessage,
            };
            const client = await TrexClient.connectWithWallet(
              anchorWallet,
              walletAddress,
            );
            let nativeBal = '0';
            try {
              nativeBal = await client.getNativeBalance(walletAddress);
            } catch (balError) {
              console.error('Failed to fetch native balance:', balError);
            }

            const normalizedWallet = walletAddress.toLowerCase();
            const identityKey = `identity:${normalizedWallet}`;
            const permissionsKey = `permissions:${normalizedWallet}:default`;

            queryCache
              .query(identityKey, () => client.getUserIdentity(walletAddress), 20_000)
              .catch(() => null);

            queryCache
              .query(
                permissionsKey,
                async () => {
                  const [
                    factoryConfig,
                    identityRegistryConfig,
                    claimTopicsOwner,
                    complianceConfig,
                    tokenRoles,
                    isAgent,
                    issuerTopics,
                  ] = await Promise.all([
                    client.getFactoryConfig().catch(() => null),
                    client.getIdentityRegistryConfig().catch(() => null),
                    client.getClaimTopicsOwner().catch(() => null),
                    client.getComplianceConfig().catch(() => null),
                    client.getRoles().catch(() => null),
                    client.isAgent(walletAddress).catch(() => false),
                    client.getIssuerTopics(walletAddress).catch(() => null),
                  ]);

                  const isFactoryAdmin =
                    !!factoryConfig &&
                    factoryConfig.admin.toLowerCase() === normalizedWallet;
                  const isIdentityRegistryOwner =
                    !!identityRegistryConfig &&
                    identityRegistryConfig.owner.toLowerCase() === normalizedWallet;
                  const isClaimTopicsOwner =
                    !!claimTopicsOwner &&
                    claimTopicsOwner.toLowerCase() === normalizedWallet;
                  const isComplianceOwner =
                    !!(complianceConfig as ComplianceConfigResponse | null) &&
                    (
                      complianceConfig as ComplianceConfigResponse
                    ).owner.toLowerCase() === normalizedWallet;
                  const isTokenOwner =
                    !!tokenRoles && tokenRoles.owner.toLowerCase() === normalizedWallet;
                  const isTokenIssuer =
                    !!tokenRoles && tokenRoles.issuer.toLowerCase() === normalizedWallet;
                  const isTokenController =
                    !!tokenRoles && tokenRoles.controller.toLowerCase() === normalizedWallet;
                  const isTokenAgent = !!isAgent;
                  const hasIssuerTopics = !!issuerTopics && issuerTopics.length > 0;
                  const canKycProvider = !!issuerTopics && issuerTopics.includes(1);

                  return {
                    isFactoryAdmin,
                    isIdentityRegistryOwner,
                    isClaimTopicsOwner,
                    isComplianceOwner,
                    isTokenOwner,
                    isTokenIssuer,
                    isTokenController,
                    isTokenAgent,
                    isTrustedIssuer: hasIssuerTopics,
                    canKycProvider,
                  };
                },
                60_000,
              )
              .catch(() => null);

            sharedHydrationKey = hydrateKey;
            return {
              address: walletAddress,
              client,
              balance: nativeBal,
            };
          })().finally(() => {
            sharedHydrationPromise = null;
          });
        }

        const hydrated = await sharedHydrationPromise;
        if (hydrated) {
          setWalletState(hydrated.address, hydrated.client, hydrated.balance);
        }
      } catch (error: any) {
        console.error('Failed to initialize wallet:', error);
        toast.error(error?.message || 'Failed to initialize wallet');
      } finally {
        setIsConnecting(false);
      }
    };

    hydrateWallet();
  }, [publicKey, connected, wallet, address, trexClient, setWalletState, clearWalletState, setIsConnecting, signTransaction, signAllTransactions, signMessage]);

  return {
    address,
    isConnecting: isConnecting || connecting,
    balance,
    trexClient,
    isConnected: connected && !!address,
    connectWallet,
    connectLeap,
    disconnect: disconnectWallet,
    refreshBalance,
  };
}
