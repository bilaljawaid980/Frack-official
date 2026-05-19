// ─── FRACKS App Store ─────────────────────────────────────────────────────────
//
// Central Zustand store with selective persistence for the FRACKS frontend.
// activeMint, role, and txHistory are persisted to localStorage.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TokenDeployment, TransferHistoryItem } from "@/types";

/** Generates a random short ID without external dependencies. */
function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

type JsonTaggedValue =
  | { __type: "bigint"; value: string }
  | { __type: "uint8array"; value: number[] };

function isJsonTaggedValue(value: unknown): value is JsonTaggedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "__type" in value &&
    "value" in value
  );
}

function persistReplacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    return { __type: "bigint", value: value.toString() };
  }

  if (value instanceof Uint8Array) {
    return { __type: "uint8array", value: Array.from(value) };
  }

  return value;
}

function persistReviver(_key: string, value: unknown): unknown {
  if (!isJsonTaggedValue(value)) {
    return value;
  }

  if (value.__type === "bigint") {
    return BigInt(value.value);
  }

  if (value.__type === "uint8array") {
    return Uint8Array.from(value.value);
  }

  return value;
}

// ─── Notification type ────────────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  type: "success" | "error" | "info";
  message: string;
}

export type ClaimReviewStatus = "pending" | "approved" | "rejected";
export type AcquisitionMode = "issuer_mint" | "investor_transfer";

export interface InvestorTransferRequest {
  id: string;
  mint: string;
  sourceInvestorWallet: string;
  recipientWallet: string;
  requestedAmount: string;
  tokenPrice: string;
  status: "pending" | "accepted" | "rejected" | "completed";
  createdAt: number;
}

export interface OnboardingRequest {
  id: string;
  mint: string;
  wallet: string;
  acquisitionMode: AcquisitionMode;
  sourceInvestorWallet?: string;
  country: number;
  metadataHash: string;
  requestedAmount: string;
  tokenPrice: string;
  submittedAt: number;
  kycStatus: ClaimReviewStatus;
  amlStatus: ClaimReviewStatus;
  issuerActivationStatus: ClaimReviewStatus;
  kycReviewedAt?: number;
  amlReviewedAt?: number;
  issuerReviewedAt?: number;
  kycReviewer?: string;
  amlReviewer?: string;
  issuerReviewer?: string;
}

// ─── Store interface ──────────────────────────────────────────────────────────

export interface AppStore {
  // ── Active token ──────────────────────────────────────────────────────────
  /** Base-58 address of the currently selected token mint, or null. */
  activeMint: string | null;
  setActiveMint: (mint: string | null) => void;

  /** Base-58 address of the currently selected deployment PDA, or null. */
  activeDeploymentPda: string | null;
  setActiveDeploymentPda: (pda: string | null) => void;

  // ── Role detection ────────────────────────────────────────────────────────
  /** Detected role of the connected wallet for the active mint. */
  role: "issuer" | "investor" | null;
  setRole: (role: "issuer" | "investor" | null) => void;

  // ── Token deployments cache ───────────────────────────────────────────────
  /** In-memory cache of known token deployments for the connected wallet. */
  deployments: TokenDeployment[];
  setDeployments: (deployments: TokenDeployment[]) => void;
  /** Upsert a single deployment (add or update by tokenMint). */
  addDeployment: (deployment: TokenDeployment) => void;

  // ── UI state ──────────────────────────────────────────────────────────────
  /** Currently selected dashboard tab. */
  selectedTab: string;
  setSelectedTab: (tab: string) => void;

  // ── Transaction history (local cache) ────────────────────────────────────
  /** Locally cached transfer history entries. */
  txHistory: TransferHistoryItem[];
  addTxToHistory: (tx: TransferHistoryItem) => void;
  clearTxHistory: () => void;

  // ── Onboarding workflow cache ─────────────────────────────────────────────
  /** Local workflow cache mirroring the ERC-3643 provider review stages. */
  onboardingRequests: OnboardingRequest[];
  investorTransferRequests: InvestorTransferRequest[];
  tokenHolderIndex: Record<string, string[]>;
  addTokenHolder: (mint: string, wallet: string) => void;
  upsertOnboardingRequest: (
    request: Omit<
      OnboardingRequest,
      | "id"
      | "submittedAt"
      | "kycStatus"
      | "amlStatus"
      | "issuerActivationStatus"
    >
  ) => void;
  reviewOnboardingClaim: (
    mint: string,
    wallet: string,
    topic: 1 | 2,
    status: ClaimReviewStatus,
    reviewer?: string
  ) => void;
  reviewIssuerActivation: (
    mint: string,
    wallet: string,
    status: ClaimReviewStatus,
    reviewer?: string
  ) => void;
  setInvestorTransferRequestStatus: (
    id: string,
    status: InvestorTransferRequest["status"]
  ) => void;

  // ── Notification queue ────────────────────────────────────────────────────
  notifications: AppNotification[];
  addNotification: (n: Omit<AppNotification, "id">) => void;
  removeNotification: (id: string) => void;
}

// ─── Persisted slices ─────────────────────────────────────────────────────────

interface PersistedState {
  activeMint: string | null;
  activeDeploymentPda: string | null;
  deployments: TokenDeployment[];
  role: "issuer" | "investor" | null;
  txHistory: TransferHistoryItem[];
  onboardingRequests: OnboardingRequest[];
  investorTransferRequests: InvestorTransferRequest[];
  tokenHolderIndex: Record<string, string[]>;
}

// ─── Store implementation ─────────────────────────────────────────────────────

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      // ── Active token ────────────────────────────────────────────────────────
      activeMint: null,
      setActiveMint: (mint) => set({ activeMint: mint }),

      activeDeploymentPda: null,
      setActiveDeploymentPda: (pda) => set({ activeDeploymentPda: pda }),

      // ── Role ────────────────────────────────────────────────────────────────
      role: null,
      setRole: (role) => set({ role }),

      // ── Deployments ─────────────────────────────────────────────────────────
      deployments: [],
      setDeployments: (deployments) => set({ deployments }),
      addDeployment: (deployment) =>
        set((state) => {
          const without = state.deployments.filter(
            (d) => d.tokenMint !== deployment.tokenMint
          );
          return { deployments: [deployment, ...without] };
        }),

      // ── UI state ────────────────────────────────────────────────────────────
      selectedTab: "overview",
      setSelectedTab: (tab) => set({ selectedTab: tab }),

      // ── Tx history ──────────────────────────────────────────────────────────
      txHistory: [],
      addTxToHistory: (tx) =>
        set((state) => ({
          // Keep last 200 entries, newest first
          txHistory: [tx, ...state.txHistory].slice(0, 200),
        })),
      clearTxHistory: () => set({ txHistory: [] }),

      // ── Onboarding workflow ────────────────────────────────────────────────
      onboardingRequests: [],
      investorTransferRequests: [],
      tokenHolderIndex: {},
      addTokenHolder: (mint, wallet) =>
        set((state) => {
          const tokenHolderIndex = state.tokenHolderIndex ?? {};
          const existing = tokenHolderIndex[mint] ?? [];
          if (existing.includes(wallet)) return state;
          return {
            tokenHolderIndex: {
              ...tokenHolderIndex,
              [mint]: [wallet, ...existing],
            },
          };
        }),
      upsertOnboardingRequest: (request) =>
        set((state) => {
          const existing = state.onboardingRequests.find(
            (item) => item.mint === request.mint && item.wallet === request.wallet
          );
          const next: OnboardingRequest = existing
            ? {
                ...existing,
                country: request.country,
                metadataHash: request.metadataHash,
                submittedAt: Math.floor(Date.now() / 1000),
        kycStatus: "pending",
        amlStatus: "pending",
                issuerActivationStatus: "pending",
              }
            : {
                ...request,
                id: genId(),
                submittedAt: Math.floor(Date.now() / 1000),
                kycStatus: "pending",
                amlStatus: "pending",
                issuerActivationStatus: "pending",
              };
          return {
            onboardingRequests: [
              next,
              ...state.onboardingRequests.filter(
                (item) => !(item.mint === request.mint && item.wallet === request.wallet)
              ),
            ],
          };
        }),
      reviewOnboardingClaim: (mint, wallet, topic, status, reviewer) =>
        set((state) => ({
          onboardingRequests: state.onboardingRequests.map((request) => {
            if (request.mint !== mint || request.wallet !== wallet) return request;
            const reviewedAt = Math.floor(Date.now() / 1000);
            return topic === 1
              ? { ...request, kycStatus: status, kycReviewedAt: reviewedAt, kycReviewer: reviewer }
              : { ...request, amlStatus: status, amlReviewedAt: reviewedAt, amlReviewer: reviewer };
          }),
        })),
      reviewIssuerActivation: (mint, wallet, status, reviewer) =>
        set((state) => {
          const reviewedAt = Math.floor(Date.now() / 1000);
          const onboardingRequests = state.onboardingRequests.map((request) =>
            request.mint === mint && request.wallet === wallet
              ? {
                  ...request,
                  issuerActivationStatus: status,
                  issuerReviewedAt: reviewedAt,
                  issuerReviewer: reviewer,
                }
              : request
          );
          const request = onboardingRequests.find(
            (item) => item.mint === mint && item.wallet === wallet
          );
          const shouldCreateTransferRequest =
            status === "approved" &&
            request?.acquisitionMode === "investor_transfer" &&
            Boolean(request.sourceInvestorWallet);
          const existingTransferRequest = state.investorTransferRequests.some(
            (item) => item.mint === mint && item.recipientWallet === wallet
          );
          return {
            onboardingRequests,
            investorTransferRequests:
              shouldCreateTransferRequest && request?.sourceInvestorWallet && !existingTransferRequest
                ? [
                    {
                      id: genId(),
                      mint,
                      sourceInvestorWallet: request.sourceInvestorWallet,
                      recipientWallet: wallet,
                      requestedAmount: request.requestedAmount,
                      tokenPrice: request.tokenPrice,
                      status: "pending",
                      createdAt: reviewedAt,
                    },
                    ...state.investorTransferRequests,
                  ]
                : state.investorTransferRequests,
          };
        }),
      setInvestorTransferRequestStatus: (id, status) =>
        set((state) => ({
          investorTransferRequests: state.investorTransferRequests.map((request) =>
            request.id === id ? { ...request, status } : request
          ),
        })),

      // ── Notifications ────────────────────────────────────────────────────────
      notifications: [],
      addNotification: (n) =>
        set((state) => ({
          notifications: [
            ...state.notifications,
            { ...n, id: genId() },
          ],
        })),
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),
    }),
    {
      name: "fracks-app-store",
      storage: createJSONStorage(
        () => (typeof window !== "undefined" ? localStorage : noopStorage),
        {
          replacer: persistReplacer,
          reviver: persistReviver,
        }
      ),
      // Only persist the fields that should survive page refresh
      partialize: (state): PersistedState => ({
        activeMint: state.activeMint,
        activeDeploymentPda: state.activeDeploymentPda,
        deployments: state.deployments,
        role: state.role,
        txHistory: state.txHistory,
        onboardingRequests: state.onboardingRequests,
        investorTransferRequests: state.investorTransferRequests,
        tokenHolderIndex: state.tokenHolderIndex,
      }),
    }
  )
);

// ─── SSR-safe no-op storage ───────────────────────────────────────────────────

const noopStorage = {
  getItem: (_key: string) => null,
  setItem: (_key: string, _value: string) => undefined,
  removeItem: (_key: string) => undefined,
};
