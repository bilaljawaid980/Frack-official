// ─── Identity Service ─────────────────────────────────────────────────────────
//
// Wraps fracks_irp, fracks_irs, and fracks_fid Anchor programs for reading
// identity registry state, wallet identities, and FID accounts.
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  FID_PROGRAM_ID,
  IRP_PROGRAM_ID,
  IRS_PROGRAM_ID,
  TIR_PROGRAM_ID,
  SEED_IRP_STATE,
  SEED_WALLET_IDENTITY,
} from "@/lib/constants";
import type { FidAccount, IrpState, WalletIdentity } from "@/types";
import IrpIdl from "@/lib/solana/idl/fracks_irp.json";
import IrsIdl from "@/lib/solana/idl/fracks_irs.json";
import FidIdl from "@/lib/solana/idl/fracks_fid.json";
import TirIdl from "@/lib/solana/idl/fracks_tir.json";

type IrpProgram = Program<Idl>;
type IrsProgram = Program<Idl>;
type FidProgram = Program<Idl>;
type TirProgram = Program<Idl>;

// Discriminator for WalletIdentity accounts (from fracks_irs IDL accounts array)
const WALLET_IDENTITY_DISCRIMINATOR = Buffer.from([
  101, 142, 55, 104, 168, 77, 57, 85,
]);

function u64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function i64Le(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigInt64(0, value, true);
  return bytes;
}

function getLocalClaimSigner(owner: PublicKey): Keypair {
  const storageKey = `fracks:claim-signer:${owner.toBase58()}`;
  const existing =
    typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
  if (existing) {
    try {
      return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(existing)));
    } catch {
      // Regenerate below if stored data is malformed.
    }
  }

  const signer = Keypair.generate();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(Array.from(signer.secretKey)),
    );
  }
  return signer;
}

// ─── IdentityService ──────────────────────────────────────────────────────────

export class IdentityService {
  private irpProgram: IrpProgram;
  private irsProgram: IrsProgram;
  private fidProgram: FidProgram;
  private tirProgram: TirProgram;
  private provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    
    const irpIdlWithAddress = {
      ...(IrpIdl as unknown as Record<string, unknown>),
      address: IRP_PROGRAM_ID.toBase58()
    } as Idl;
    this.irpProgram = new Program(irpIdlWithAddress, provider);

    const irsIdlWithAddress = {
      ...(IrsIdl as unknown as Record<string, unknown>),
      address: IRS_PROGRAM_ID.toBase58()
    } as Idl;
    this.irsProgram = new Program(irsIdlWithAddress, provider);

    const fidIdlWithAddress = {
      ...(FidIdl as unknown as Record<string, unknown>),
      address: FID_PROGRAM_ID.toBase58()
    } as Idl;
    this.fidProgram = new Program(fidIdlWithAddress, provider);

    const tirIdlWithAddress = {
      ...(TirIdl as unknown as Record<string, unknown>),
      address: TIR_PROGRAM_ID.toBase58()
    } as Idl;
    this.tirProgram = new Program(tirIdlWithAddress, provider);
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /** Seeds: ["irp_state", mint] */
  findIrpStatePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_IRP_STATE, mint.toBuffer()],
      IRP_PROGRAM_ID
    );
  }

  /**
   * Derives the WalletIdentity PDA.
   * Seeds: ["wallet_identity", irs_state, wallet]
   * The irpState parameter is the IRS state account address, not the IRP state.
   */
  findWalletIdentityPda(
    irsStatePubkey: PublicKey,
    wallet: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsStatePubkey.toBuffer(), wallet.toBuffer()],
      IRS_PROGRAM_ID
    );
  }

  /** Seeds: ["onboarding_application", irs_state, wallet] */
  findOnboardingApplicationPda(
    irsStatePubkey: PublicKey,
    wallet: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("onboarding_application"), irsStatePubkey.toBuffer(), wallet.toBuffer()],
      IRS_PROGRAM_ID
    );
  }

  /** Seeds: ["fid", wallet] */
  findFidPda(wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), wallet.toBuffer()],
      FID_PROGRAM_ID
    );
  }

  /** Seeds: ["claim", target_fid, claim_id_le] */
  findClaimPda(fid: PublicKey, claimId: number): [PublicKey, number] {
    const claimIdLe = Buffer.alloc(4);
    claimIdLe.writeUInt32LE(claimId, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), fid.toBuffer(), claimIdLe],
      FID_PROGRAM_ID
    );
  }

  /** Seeds: ["claim_topic_index", target_fid, issuer_fid, topic_le] */
  findClaimTopicIndexPda(
    targetFid: PublicKey,
    issuerFid: PublicKey,
    topic: bigint
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_topic_index"),
        targetFid.toBuffer(),
        issuerFid.toBuffer(),
        Buffer.from(u64Le(topic)),
      ],
      FID_PROGRAM_ID
    );
  }

  /** Seeds: ["tir_state", mint] */
  findTirStatePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mint.toBuffer()],
      TIR_PROGRAM_ID
    );
  }

  /** Seeds: ["issuer_entry", tir_state, issuer_fid] */
  findIssuerEntryPda(tirState: PublicKey, issuerFid: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
      TIR_PROGRAM_ID
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  /**
   * Fetches the IRP (Identity Registry Protocol) state for a given mint.
   */
  async fetchIrpState(mint: PublicKey): Promise<IrpState> {
    const [irpStatePda] = this.findIrpStatePda(mint);
    const raw = await (this.irpProgram.account as any).identityRegistryState.fetch(
      irpStatePda
    );
    return {
      owner: raw.owner.toBase58(),
      tokenMint: raw.tokenMint.toBase58(),
      irsAccount: raw.irsAccount.toBase58(),
      tirAccount: raw.tirAccount.toBase58(),
      ctrAccount: raw.ctrAccount.toBase58(),
      agents: raw.identityAgents.map((a: PublicKey) => a.toBase58()),
      registeredCount: BigInt(raw.registeredCount.toString()),
      bump: raw.bump,
    };
  }

  /**
   * Fetches the WalletIdentity account for a wallet in a specific token's IRS.
   * Returns null if the identity does not exist.
   */
  async fetchWalletIdentity(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<WalletIdentity | null> {
    try {
      // First get the IRP state to find the IRS account
      const irpState = await this.fetchIrpState(mint);
      const irsStatePubkey = new PublicKey(irpState.irsAccount);
      const [walletIdentityPda] = this.findWalletIdentityPda(
        irsStatePubkey,
        wallet
      );
      const raw = await (this.irsProgram.account as any).walletIdentity.fetch(
        walletIdentityPda
      );
      return {
        wallet: raw.wallet.toBase58(),
        fid: raw.fid.toBase58(),
        country: raw.country as number,
        irs: raw.irs.toBase58(),
        isActive: Boolean(raw.isActive),
        activatedBy: raw.activatedBy.toBase58(),
        activatedAt: BigInt(raw.activatedAt.toString()),
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  async fetchFid(wallet: PublicKey): Promise<FidAccount | null> {
    try {
      const [fidPda] = this.findFidPda(wallet);
      const raw = await (this.fidProgram.account as any).fidAccount.fetch(fidPda);
      return {
        owner: raw.owner.toBase58(),
        managementKey: raw.managementKey.toBase58(),
        signerKey: raw.signerKey.toBase58(),
        claimCount: Number(raw.claimCount),
        isIssuer: Boolean(raw.isIssuer),
        country: Number(raw.country),
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  async fetchTrustedIssuerTopics(
    mint: PublicKey,
    issuerWallet: PublicKey
  ): Promise<bigint[]> {
    try {
      const [issuerFid] = this.findFidPda(issuerWallet);
      const [tirState] = this.findTirStatePda(mint);
      const [issuerEntry] = this.findIssuerEntryPda(tirState, issuerFid);
      const raw = await (this.tirProgram.account as any).issuerEntry.fetch(issuerEntry);
      if (!raw.isActive) return [];
      return (raw.allowedTopics as Array<{ toString(): string }>).map((topic) =>
        BigInt(topic.toString())
      );
    } catch {
      return [];
    }
  }

  async hasActiveClaimForTopic(
    targetWallet: PublicKey,
    issuerWallet: PublicKey,
    topic: bigint
  ): Promise<boolean> {
    const [targetFid] = this.findFidPda(targetWallet);
    const [issuerFid] = this.findFidPda(issuerWallet);
    const [claimTopicIndex] = this.findClaimTopicIndexPda(
      targetFid,
      issuerFid,
      topic,
    );

    try {
      const raw = await (this.fidProgram.account as any).claimTopicIndex.fetch(
        claimTopicIndex,
      );
      return Boolean(raw.isActive);
    } catch {
      return false;
    }
  }

  async ensureOwnFid(country = 0, isIssuer = false): Promise<string | null> {
    const owner = this.provider.wallet.publicKey;
    const [fidPda] = this.findFidPda(owner);
    const existing = await this.fetchFid(owner);
    if (existing) {
      if (existing.isIssuer !== isIssuer || (!isIssuer && existing.country !== country)) {
        return await (this.fidProgram.methods as any)
          .updateFidProfile(isIssuer, country)
          .accounts({
            authority: owner,
            fid: fidPda,
          })
          .rpc({ commitment: "confirmed" });
      }
      return null;
    }

    return await (this.fidProgram.methods as any)
      .createFid(isIssuer, country)
      .accounts({
        owner,
        fid: fidPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
  }

  /**
   * Returns a summary of whether a wallet has an identity for a token and,
   * if so, the country code and frozen status.
   */
  async getIdentityForWallet(
    mint: PublicKey,
    wallet: PublicKey
  ): Promise<{ hasIdentity: boolean; country: number; frozen: boolean }> {
    const identity = await this.fetchWalletIdentity(mint, wallet);
    if (!identity) {
      return { hasIdentity: false, country: 0, frozen: false };
    }

    // Check frozen status via the fracks_token frozen_wallet PDA
    // IDL seed bytes [102,114,111,122,101,110] = "frozen"
    const { TOKEN_PROGRAM_ID: TOKEN_PROG } = await import("@/lib/constants");
    const [frozenWalletPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), wallet.toBuffer()],
      TOKEN_PROG
    );
    let frozen = false;
    try {
      const info = await this.provider.connection.getAccountInfo(
        frozenWalletPda,
        "confirmed"
      );
      frozen = info !== null;
    } catch {
      frozen = false;
    }

    return {
      hasIdentity: true,
      country: identity.country,
      frozen,
    };
  }

  /**
   * Fetches all WalletIdentity accounts for a given token by scanning
   * the IRS program accounts with discriminator + IRS state filters.
   */
  async fetchAllIdentities(mint: PublicKey): Promise<WalletIdentity[]> {
    // Get IRS state address from IRP
    let irsStatePubkey: PublicKey;
    try {
      const irpState = await this.fetchIrpState(mint);
      irsStatePubkey = new PublicKey(irpState.irsAccount);
    } catch {
      return [];
    }

    // Fetch all WalletIdentity accounts filtering on the irs field
    const accounts = await this.provider.connection.getProgramAccounts(
      IRS_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: WALLET_IDENTITY_DISCRIMINATOR.toString("base64"),
              encoding: "base64",
            },
          },
          {
            // irs field is at offset: 8 (disc) + 32 (wallet) + 32 (fid) + 2 (country) = 74
            memcmp: {
              offset: 74,
              bytes: irsStatePubkey.toBase58(),
            },
          },
        ],
      }
    );

    const identities: WalletIdentity[] = [];
    for (const { account } of accounts) {
      try {
        const decoded = this.irsProgram.coder.accounts.decode(
          "WalletIdentity",
          account.data
        );
        identities.push({
          wallet: (decoded.wallet as PublicKey).toBase58(),
          fid: (decoded.fid as PublicKey).toBase58(),
          country: decoded.country as number,
          irs: (decoded.irs as PublicKey).toBase58(),
          isActive: Boolean(decoded.isActive),
          activatedBy: (decoded.activatedBy as PublicKey).toBase58(),
          activatedAt: BigInt(decoded.activatedAt.toString()),
          bump: decoded.bump as number,
        });
      } catch {
        // skip malformed accounts
      }
    }
    return identities;
  }

  /**
   * Investor submits an onboarding application for the token's IRS.
   * metadataHash should be a 32-byte digest of off-chain KYC application data.
   */
  async submitOnboardingApplication(
    mint: PublicKey,
    wallet: PublicKey,
    metadataHash: number[] | Uint8Array
  ): Promise<string> {
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [application] = this.findOnboardingApplicationPda(irsStatePubkey, wallet);
    const hash = Array.from(metadataHash);

    return await (this.irsProgram.methods as any)
      .submitOnboardingApplication(wallet, hash)
      .accounts({
        applicant: this.provider.wallet.publicKey,
        irsState: irsStatePubkey,
        application,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * KYC/AML provider or issuer reviews an onboarding application.
   */
  async reviewOnboardingApplication(
    mint: PublicKey,
    wallet: PublicKey,
    approved: boolean
  ): Promise<string> {
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [application] = this.findOnboardingApplicationPda(irsStatePubkey, wallet);

    return await (this.irsProgram.methods as any)
      .reviewOnboardingApplication(approved)
      .accounts({
        authority: this.provider.wallet.publicKey,
        irsState: irsStatePubkey,
        registryState: this.findIrpStatePda(mint)[0],
        application,
      })
      .rpc();
  }

  async registerIdentity(
    mint: PublicKey,
    wallet: PublicKey,
    fid: PublicKey,
    country: number
  ): Promise<string> {
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [registryState] = this.findIrpStatePda(mint);
    const [walletIdentity] = this.findWalletIdentityPda(irsStatePubkey, wallet);

    return await (this.irsProgram.methods as any)
      .registerIdentity(wallet, fid, country)
      .accounts({
        authority: this.provider.wallet.publicKey,
        irsState: irsStatePubkey,
        registryState,
        fidAccount: fid,
        walletIdentity,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /**
   * Issuer/IRS owner activates or deactivates a registered wallet identity.
   */
  async setIdentityActivation(
    mint: PublicKey,
    wallet: PublicKey,
    active: boolean
  ): Promise<string> {
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [walletIdentity] = this.findWalletIdentityPda(irsStatePubkey, wallet);

    return await (this.irsProgram.methods as any)
      .setIdentityActivation(active)
      .accounts({
        owner: this.provider.wallet.publicKey,
        irsState: irsStatePubkey,
        walletIdentity,
      })
      .rpc();
  }

  async issueClaim(
    targetWallet: PublicKey,
    topic: bigint,
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>
  ): Promise<string> {
    const issuerOwner = this.provider.wallet.publicKey;
    const [issuerFid] = this.findFidPda(issuerOwner);
    const [targetFid] = this.findFidPda(targetWallet);
    let issuerFidAccount = await this.fetchFid(issuerOwner);
    if (!issuerFidAccount) {
      await this.ensureOwnFid(0, true);
      issuerFidAccount = await this.fetchFid(issuerOwner);
    }
    if (!issuerFidAccount?.isIssuer) {
      throw new Error("Connected wallet must have an issuer FID to issue claims.");
    }

    const targetFidAccount = await (this.fidProgram.account as any).fidAccount.fetch(targetFid);
    const claimCount = Number(targetFidAccount.claimCount);
    const [claim] = this.findClaimPda(targetFid, claimCount);
    const [claimTopicIndex] = this.findClaimTopicIndexPda(targetFid, issuerFid, topic);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60);
    const dataHash = await this.sha256Bytes(
      new TextEncoder().encode(`${issuerFid.toBase58()}:${targetFid.toBase58()}:${topic.toString()}:${expiresAt}`)
    );
    const message = await this.claimMessage(issuerFid, targetFid, topic, dataHash, expiresAt);
    let claimSigner = new PublicKey(issuerFidAccount.signerKey);
    let signature: Uint8Array | null = null;

    if (claimSigner.equals(issuerOwner) && signMessage) {
      try {
        signature = await signMessage(message);
      } catch {
        signature = null;
      }
    }

    if (!signature) {
      const localSigner = getLocalClaimSigner(issuerOwner);
      if (!claimSigner.equals(localSigner.publicKey)) {
        await (this.fidProgram.methods as any)
          .setSignerKey(localSigner.publicKey)
          .accounts({
            authority: issuerOwner,
            fid: issuerFid,
          })
          .rpc({ commitment: "confirmed" });
        claimSigner = localSigner.publicKey;
      }
      signature = nacl.sign.detached(message, localSigner.secretKey);
    }

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: claimSigner.toBytes(),
      message,
      signature,
    });

    return await (this.fidProgram.methods as any)
      .addClaim(new BN(topic.toString()), Array.from(dataHash), Array.from(signature), new BN(expiresAt.toString()))
      .accounts({
        issuerOwner,
        issuerFid,
        targetFid,
        claim,
        claimTopicIndex,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .preInstructions([ed25519Ix])
      .rpc();
  }

  private async claimMessage(
    issuerFid: PublicKey,
    targetFid: PublicKey,
    topic: bigint,
    dataHash: Uint8Array,
    expiresAt: bigint
  ): Promise<Uint8Array> {
    return this.sha256Bytes(
      Buffer.concat([
        issuerFid.toBuffer(),
        targetFid.toBuffer(),
        Buffer.from(u64Le(topic)),
        Buffer.from(dataHash),
        Buffer.from(i64Le(expiresAt)),
      ])
    );
  }

  private async sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
    const exact = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength
    ) as ArrayBuffer;
    const digest = await crypto.subtle.digest("SHA-256", exact);
    return new Uint8Array(digest);
  }
}
