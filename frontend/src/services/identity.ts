// ─── Identity Service ─────────────────────────────────────────────────────────
//
// Wraps fracks_irp, fracks_irs, and fracks_fid Anchor programs for reading
// identity registry state, wallet identities, and FID accounts.
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, Idl, Program, BN } from "@coral-xyz/anchor";
import {
  Ed25519Program,
  Keypair,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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
import IrpIdl from "@/idl/fracks_irp.json";
import IrsIdl from "@/idl/fracks_irs.json";
import FidIdl from "@/idl/fracks_fid.json";
import TirIdl from "@/idl/fracks_tir.json";
import { fetchFactoryStateAccount, type FactoryStateAccount } from "@/lib/solana";

type IrpProgram = Program<Idl>;
type IrsProgram = Program<Idl>;
type FidProgram = Program<Idl>;
type TirProgram = Program<Idl>;

const DEPLOYED_FID_PROGRAM_ID = new PublicKey(
  "EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB",
);
const DEPLOYED_IRP_PROGRAM_ID = new PublicKey(
  "C8jtErJYtuu7pSZczfSm1JvDmv254Nmmw1KLX6rBdY8o",
);
const DEPLOYED_IRS_PROGRAM_ID = new PublicKey(
  "GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ",
);
const DEPLOYED_TIR_PROGRAM_ID = new PublicKey(
  "8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ",
);

const ADD_CLAIM_DISCRIMINATOR = Buffer.from([
  70, 114, 85, 106, 66, 244, 46, 99,
]);
const REGISTER_IDENTITY_DISCRIMINATOR = Buffer.from([
  164, 118, 227, 177, 47, 176, 187, 248,
]);
const SET_IDENTITY_ACTIVATION_DISCRIMINATOR = Buffer.from([
  116, 97, 228, 110, 7, 8, 137, 48,
]);

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

function encodeAddClaimArgs(
  topic: bigint,
  dataHash: Uint8Array,
  signature: Uint8Array,
  expiresAt: bigint,
): Buffer {
  return Buffer.concat([
    ADD_CLAIM_DISCRIMINATOR,
    Buffer.from(u64Le(topic)),
    Buffer.from(dataHash),
    Buffer.from(signature),
    Buffer.from(i64Le(expiresAt)),
  ]);
}

function encodeRegisterIdentityArgs(
  wallet: PublicKey,
  fid: PublicKey,
  country: number,
): Buffer {
  const countryBytes = Buffer.alloc(2);
  countryBytes.writeUInt16LE(country);
  return Buffer.concat([
    REGISTER_IDENTITY_DISCRIMINATOR,
    wallet.toBuffer(),
    fid.toBuffer(),
    countryBytes,
  ]);
}

function encodeSetIdentityActivationArgs(active: boolean): Buffer {
  return Buffer.concat([
    SET_IDENTITY_ACTIVATION_DISCRIMINATOR,
    Buffer.from([active ? 1 : 0]),
  ]);
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

function parseFidOwner(data: Buffer): PublicKey | null {
  if (data.length < 40) return null;
  return new PublicKey(data.subarray(8, 40));
}

function parseIssuerEntry(data: Buffer): {
  issuerFid: PublicKey;
  tir: PublicKey;
  topics: bigint[];
  isActive: boolean;
} | null {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return null;

  let accountOffset = 8;
  const issuerFid = new PublicKey(data.subarray(accountOffset, accountOffset + 32));
  accountOffset += 32;
  const tir = new PublicKey(data.subarray(accountOffset, accountOffset + 32));

  const topicsLength = data.readUInt32LE(offset);
  offset += 4;

  const topics: bigint[] = [];
  for (let index = 0; index < topicsLength; index += 1) {
    if (data.length < offset + 8) return null;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }

  if (data.length < offset + 1) return null;
  const isActive = data.readUInt8(offset) === 1;
  return { issuerFid, tir, topics, isActive };
}

function parseIssuerEntryTopics(data: Buffer): bigint[] {
  const parsed = parseIssuerEntry(data);
  if (!parsed?.isActive) return [];
  return parsed.topics;
}

function parseWalletIdentity(data: Buffer): WalletIdentity | null {
  const minimumSize = 8 + 32 + 32 + 2 + 32 + 1 + 32 + 8 + 1;
  if (data.length < minimumSize) return null;

  let offset = 8;
  const wallet = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const fid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const country = data.readUInt16LE(offset);
  offset += 2;
  const irs = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const isActive = data.readUInt8(offset) === 1;
  offset += 1;
  const activatedBy = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const activatedAt = data.readBigInt64LE(offset);
  offset += 8;
  const bump = data.readUInt8(offset);

  return {
    wallet: wallet.toBase58(),
    fid: fid.toBase58(),
    country,
    irs: irs.toBase58(),
    isActive,
    activatedBy: activatedBy.toBase58(),
    activatedAt,
    bump,
  };
}

// ─── IdentityService ──────────────────────────────────────────────────────────

export class IdentityService {
  private provider: AnchorProvider;
  private factoryStatePromise: Promise<FactoryStateAccount | null> | null = null;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
  }

  private async getFactoryState(): Promise<FactoryStateAccount | null> {
    if (!this.factoryStatePromise) {
      this.factoryStatePromise = fetchFactoryStateAccount().catch(() => null);
    }
    return this.factoryStatePromise;
  }

  private async getProgramIds() {
    const state = await this.getFactoryState();
    return {
      fid: state?.fidProgramId ?? DEPLOYED_FID_PROGRAM_ID,
      irp: state?.irpProgramId ?? DEPLOYED_IRP_PROGRAM_ID,
      irs: state?.irsProgramId ?? DEPLOYED_IRS_PROGRAM_ID,
      tir: state?.tirProgramId ?? DEPLOYED_TIR_PROGRAM_ID,
    };
  }

  private getProgram<T extends Idl>(idl: T, programId: PublicKey): Program<T> {
    return new Program(
      { ...(idl as Record<string, unknown>), address: programId.toBase58() } as T,
      this.provider,
    );
  }

  private getFidProgram(programId: PublicKey): FidProgram {
    return this.getProgram(FidIdl as unknown as Idl, programId);
  }

  private getIrpProgram(programId: PublicKey): IrpProgram {
    return this.getProgram(IrpIdl as unknown as Idl, programId);
  }

  private getIrsProgram(programId: PublicKey): IrsProgram {
    return this.getProgram(IrsIdl as unknown as Idl, programId);
  }

  private getTirProgram(programId: PublicKey): TirProgram {
    return this.getProgram(TirIdl as unknown as Idl, programId);
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /** Seeds: ["irp_state", mint] */
  findIrpStatePda(
    mint: PublicKey,
    programId: PublicKey = IRP_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_IRP_STATE, mint.toBuffer()],
      programId
    );
  }

  /**
   * Derives the WalletIdentity PDA.
   * Seeds: ["wallet_identity", irs_state, wallet]
   * The irpState parameter is the IRS state account address, not the IRP state.
   */
  findWalletIdentityPda(
    irsStatePubkey: PublicKey,
    wallet: PublicKey,
    programId: PublicKey = IRS_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsStatePubkey.toBuffer(), wallet.toBuffer()],
      programId
    );
  }

  /** Seeds: ["onboarding_application", irs_state, wallet] */
  findOnboardingApplicationPda(
    irsStatePubkey: PublicKey,
    wallet: PublicKey,
    programId: PublicKey = IRS_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("onboarding_application"), irsStatePubkey.toBuffer(), wallet.toBuffer()],
      programId
    );
  }

  /** Seeds: ["fid", wallet] */
  findFidPda(
    wallet: PublicKey,
    programId: PublicKey = FID_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), wallet.toBuffer()],
      programId
    );
  }

  async findActiveFidPda(wallet: PublicKey): Promise<[PublicKey, number]> {
    const ids = await this.getProgramIds();
    return this.findFidPda(wallet, ids.fid);
  }

  /** Seeds: ["claim", target_fid, claim_id_le] */
  findClaimPda(
    fid: PublicKey,
    claimId: number,
    programId: PublicKey = FID_PROGRAM_ID,
  ): [PublicKey, number] {
    const claimIdLe = Buffer.alloc(4);
    claimIdLe.writeUInt32LE(claimId, 0);
    return PublicKey.findProgramAddressSync(
      [Buffer.from("claim"), fid.toBuffer(), claimIdLe],
      programId
    );
  }

  /** Seeds: ["claim_topic_index", target_fid, issuer_fid, topic_le] */
  findClaimTopicIndexPda(
    targetFid: PublicKey,
    issuerFid: PublicKey,
    topic: bigint,
    programId: PublicKey = FID_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("claim_topic_index"),
        targetFid.toBuffer(),
        issuerFid.toBuffer(),
        Buffer.from(u64Le(topic)),
      ],
      programId
    );
  }

  /** Seeds: ["tir_state", mint] */
  findTirStatePda(
    mint: PublicKey,
    programId: PublicKey = TIR_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mint.toBuffer()],
      programId
    );
  }

  /** Seeds: ["issuer_entry", tir_state, issuer_fid] */
  findIssuerEntryPda(
    tirState: PublicKey,
    issuerFid: PublicKey,
    programId: PublicKey = TIR_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
      programId
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  /**
   * Fetches the IRP (Identity Registry Protocol) state for a given mint.
   */
  async fetchIrpState(mint: PublicKey): Promise<IrpState> {
    const ids = await this.getProgramIds();
    const irpProgram = this.getIrpProgram(ids.irp);
    const [irpStatePda] = this.findIrpStatePda(mint, ids.irp);
    const raw = await (irpProgram.account as any).identityRegistryState.fetch(
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
      const ids = await this.getProgramIds();
      // First get the IRP state to find the IRS account
      const irpState = await this.fetchIrpState(mint);
      const irsStatePubkey = new PublicKey(irpState.irsAccount);
      const [walletIdentityPda] = this.findWalletIdentityPda(
        irsStatePubkey,
        wallet,
        ids.irs,
      );
      const info = await this.provider.connection.getAccountInfo(
        walletIdentityPda,
        "confirmed",
      );
      return info ? parseWalletIdentity(info.data) : null;
    } catch {
      return null;
    }
  }

  async fetchFid(wallet: PublicKey): Promise<FidAccount | null> {
    try {
      const ids = await this.getProgramIds();
      const fidProgram = this.getFidProgram(ids.fid);
      const [fidPda] = this.findFidPda(wallet, ids.fid);
      const raw = await (fidProgram.account as any).fidAccount.fetch(fidPda);
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
      const ids = await this.getProgramIds();
      const [issuerFid] = this.findFidPda(issuerWallet, ids.fid);
      const [tirState] = this.findTirStatePda(mint, ids.tir);
      const [issuerEntry] = this.findIssuerEntryPda(tirState, issuerFid, ids.tir);
      const info = await this.provider.connection.getAccountInfo(
        issuerEntry,
        "confirmed",
      );
      const directTopics = info ? parseIssuerEntryTopics(info.data) : [];
      if (directTopics.length > 0) return directTopics;

      const accounts = await this.provider.connection.getProgramAccounts(ids.tir, {
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

      for (const { account } of accounts) {
        const parsed = parseIssuerEntry(account.data);
        if (!parsed?.isActive) continue;

        const fidInfo = await this.provider.connection.getAccountInfo(
          parsed.issuerFid,
          "confirmed",
        );
        const owner = fidInfo ? parseFidOwner(fidInfo.data) : null;
        if (owner?.equals(issuerWallet)) {
          return parsed.topics;
        }
      }

      return [];
    } catch {
      return [];
    }
  }

  async hasActiveClaimForTopic(
    targetWallet: PublicKey,
    issuerWallet: PublicKey,
    topic: bigint
  ): Promise<boolean> {
    const ids = await this.getProgramIds();
    const [targetFid] = this.findFidPda(targetWallet, ids.fid);
    const [issuerFid] = this.findFidPda(issuerWallet, ids.fid);
    const [claimTopicIndex] = this.findClaimTopicIndexPda(
      targetFid,
      issuerFid,
      topic,
      ids.fid,
    );

    try {
      const info = await this.provider.connection.getAccountInfo(
        claimTopicIndex,
        "confirmed",
      );
      if (!info) return false;

      // ClaimTopicIndex layout:
      // discriminator(8) + target_fid(32) + issuer_fid(32) + topic(8)
      // + active_claim(32) + active_claim_id(4) + is_active(1) + bump(1)
      return info.data.length > 116 && info.data.readUInt8(116) === 1;
    } catch {
      return false;
    }
  }

  async ensureOwnFid(country = 0, isIssuer = false): Promise<string | null> {
    const ids = await this.getProgramIds();
    const fidProgram = this.getFidProgram(ids.fid);
    const owner = this.provider.wallet.publicKey;
    const [fidPda] = this.findFidPda(owner, ids.fid);
    const existing = await this.fetchFid(owner);
    if (existing) {
      if (existing.isIssuer !== isIssuer || (!isIssuer && existing.country !== country)) {
        return await (fidProgram.methods as any)
          .updateFidProfile(isIssuer, country)
          .accounts({
            authority: owner,
            fid: fidPda,
          })
          .rpc({ commitment: "confirmed" });
      }
      return null;
    }

    return await (fidProgram.methods as any)
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
    const ids = await this.getProgramIds();
    const irsProgram = this.getIrsProgram(ids.irs);
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
      ids.irs,
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
        const decoded = irsProgram.coder.accounts.decode(
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
   * Fetches the IRS state owner for a given mint's IRS.
   * Returns the owner's public key as a base58 string or null on error.
   */
  async fetchIrsOwner(mint: PublicKey): Promise<string | null> {
    try {
      const ids = await this.getProgramIds();
      const irpState = await this.fetchIrpState(mint);
      const irsStatePubkey = new PublicKey(irpState.irsAccount);
      const irsProgram = this.getIrsProgram(ids.irs);
      // Account name in IDL: IdentityRegistryStorageState -> identityRegistryStorageState
      const raw = await (irsProgram.account as any).identityRegistryStorageState.fetch(
        irsStatePubkey,
      );
      return (raw.owner as PublicKey).toBase58();
    } catch {
      return null;
    }
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
    const ids = await this.getProgramIds();
    const irsProgram = this.getIrsProgram(ids.irs);
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [application] = this.findOnboardingApplicationPda(
      irsStatePubkey,
      wallet,
      ids.irs,
    );
    const hash = Array.from(metadataHash);

    return await (irsProgram.methods as any)
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
    const ids = await this.getProgramIds();
    const irsProgram = this.getIrsProgram(ids.irs);
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [application] = this.findOnboardingApplicationPda(
      irsStatePubkey,
      wallet,
      ids.irs,
    );

    return await (irsProgram.methods as any)
      .reviewOnboardingApplication(approved)
      .accounts({
        authority: this.provider.wallet.publicKey,
        irsState: irsStatePubkey,
        registryState: this.findIrpStatePda(mint, ids.irp)[0],
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
    const ids = await this.getProgramIds();
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [registryState] = this.findIrpStatePda(mint, ids.irp);
    const [walletIdentity] = this.findWalletIdentityPda(
      irsStatePubkey,
      wallet,
      ids.irs,
    );

    const ix = new TransactionInstruction({
      programId: ids.irs,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: irsStatePubkey, isSigner: false, isWritable: true },
        { pubkey: registryState, isSigner: false, isWritable: false },
        { pubkey: fid, isSigner: false, isWritable: false },
        { pubkey: walletIdentity, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: encodeRegisterIdentityArgs(wallet, fid, country),
    });

    return await this.provider.sendAndConfirm(new Transaction().add(ix), [], {
      commitment: "confirmed",
    });
  }

  /**
   * Issuer/IRS owner activates or deactivates a registered wallet identity.
   */
  async setIdentityActivation(
    mint: PublicKey,
    wallet: PublicKey,
    active: boolean
  ): Promise<string> {
    const ids = await this.getProgramIds();
    const irpState = await this.fetchIrpState(mint);
    const irsStatePubkey = new PublicKey(irpState.irsAccount);
    const [walletIdentity] = this.findWalletIdentityPda(
      irsStatePubkey,
      wallet,
      ids.irs,
    );

    const ix = new TransactionInstruction({
      programId: ids.irs,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: irsStatePubkey, isSigner: false, isWritable: false },
        { pubkey: walletIdentity, isSigner: false, isWritable: true },
      ],
      data: encodeSetIdentityActivationArgs(active),
    });

    return await this.provider.sendAndConfirm(new Transaction().add(ix), [], {
      commitment: "confirmed",
    });
  }

  async issueClaim(
    targetWallet: PublicKey,
    topic: bigint,
    signMessage?: (message: Uint8Array) => Promise<Uint8Array>
  ): Promise<string> {
    const ids = await this.getProgramIds();
    const fidProgram = this.getFidProgram(ids.fid);
    const issuerOwner = this.provider.wallet.publicKey;
    const [issuerFid] = this.findFidPda(issuerOwner, ids.fid);
    const [targetFid] = this.findFidPda(targetWallet, ids.fid);
    let issuerFidAccount = await this.fetchFid(issuerOwner);
    if (!issuerFidAccount) {
      await this.ensureOwnFid(0, true);
      issuerFidAccount = await this.fetchFid(issuerOwner);
    }
    if (!issuerFidAccount?.isIssuer) {
      throw new Error("Connected wallet must have an issuer FID to issue claims.");
    }

    const targetFidAccount = await (fidProgram.account as any).fidAccount.fetch(targetFid);
    const claimCount = Number(targetFidAccount.claimCount);
    const [claim] = this.findClaimPda(targetFid, claimCount, ids.fid);
    const [claimTopicIndex] = this.findClaimTopicIndexPda(
      targetFid,
      issuerFid,
      topic,
      ids.fid,
    );
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
        await (fidProgram.methods as any)
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

    // Debug logging describing the AddClaim call and args
    try {
      console.info("[ADD CLAIM DEBUG] pre", {
        fidProgramId: ids.fid.toBase58(),
        instruction: "add_claim",
        subjectWallet: targetWallet.toBase58(),
        targetFid: targetFid.toBase58(),
        providerWallet: issuerOwner.toBase58(),
        issuerFid: issuerFid.toBase58(),
        claimPda: claim.toBase58(),
        claimTopicIndex: claimTopicIndex.toBase58(),
        topic: topic.toString(),
        expiresAt: expiresAt.toString(),
        dataHashLen: dataHash.length,
        signatureLen: signature.length,
        argsObject: {
          topic: topic.toString(),
          data_hash_len: dataHash.length,
          signature_len: signature.length,
          expires_at: expiresAt.toString(),
        },
        idlArgs: (FidIdl as any).instructions?.find((i: any) => i.name === "add_claim")?.args ?? null,
      });
    } catch (e) {
      // ignore logging failures
    }

    // Debug: show core PDAs and keys used for the AddClaim instruction
    try {
      console.info("[ADD CLAIM DEBUG] issuerOwner", issuerOwner.toBase58());
      console.info("[ADD CLAIM DEBUG] issuerFid", issuerFid.toBase58());
      console.info("[ADD CLAIM DEBUG] targetFid", targetFid.toBase58());
      console.info("[ADD CLAIM DEBUG] claimPda", claim.toBase58());
      console.info("[ADD CLAIM DEBUG] claimTopicIndex", claimTopicIndex.toBase58());
    } catch (e) {}

    const addClaimIx = await (fidProgram.methods as any)
      .addClaim(new BN(topic.toString()), issuerFid, Buffer.from(dataHash), Buffer.from(signature), new BN(expiresAt.toString()))
      .accounts({
        issuerOwner: issuerOwner,
        targetFid: targetFid,
        claim: claim,
        claimTopicIndex: claimTopicIndex,
        instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    try {
      console.info("[ADD CLAIM DEBUG] instructionDataLength", addClaimIx.data?.length ?? null);
      console.info("[ADD CLAIM DEBUG] instructionExpectedLength", 152);
    } catch {
      // noop
    }

    try {
      try {
        console.info("[ADD CLAIM DEBUG] instructionDataHex", Buffer.from(addClaimIx.data ?? []).toString("hex"));
      } catch {}

      const tx = new Transaction().add(ed25519Ix, addClaimIx);
      return await this.provider.sendAndConfirm(tx, [], {
        commitment: "confirmed",
      });
    } catch (err: any) {
      try {
        // If the error exposes getLogs (SendTransactionError), fetch and print full logs
        if (typeof err.getLogs === "function") {
          const logs = await err.getLogs();
          console.error("[ADD CLAIM DEBUG] sendAndConfirm logs:", logs);
        } else if (err.logs) {
          console.error("[ADD CLAIM DEBUG] sendAndConfirm logs:", err.logs);
        }
      } catch (fetchErr) {
        console.error("[ADD CLAIM DEBUG] failed to fetch logs", fetchErr);
      }
      throw err;
    }
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
