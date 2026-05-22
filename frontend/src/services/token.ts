// ─── Token Service ────────────────────────────────────────────────────────────
//
// Wraps the fracks_token Anchor program for all token state reads and
// agent-gated write operations (mint, burn, freeze, pause, agents).
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, Idl, Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  COMPLIANCE_PROGRAM_ID,
  IRS_PROGRAM_ID,
  MOD_COUNTRY_CAP,
  MOD_COUNTRY_RESTRICT,
  MOD_DAILY_LIMIT,
  MOD_LOCKUP,
  MOD_MAX_BALANCE,
  MOD_MAX_INVESTORS,
  MOD_MAX_TRANSFER,
  MOD_SUPPLY_CAP,
  SEED_TOKEN_STATE,
  SEED_OWNER,
  SEED_AGENT,
  SEED_WALLET_IDENTITY,
} from "@/lib/constants";
import { formatTransactionError } from "@/lib/errors";
import { fetchFactoryStateAccount, type FactoryStateAccount } from "@/lib/solana";
import type { TokenMintHealth, TokenState, OwnerState } from "@/types";
import TokenIdl from "@/idl/fracks_token.json";
import ComplianceIdl from "@/idl/fracks_compliance.json";
import ModDailyLimitIdl from "@/idl/mod_daily_limit.json";

type TokenProgram = Program<Idl>;
type RemainingAccount = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };
type SuiteProgramIds = {
  token: PublicKey;
  fid: PublicKey;
  irs: PublicKey;
  tir: PublicKey;
  ctr: PublicKey;
  compliance: PublicKey;
};
type WalletIdentityAccount = {
  wallet: PublicKey;
  fid: PublicKey;
  country: number;
  irs: PublicKey;
  isActive: boolean;
};
type MintRegistryContext = {
  ids: SuiteProgramIds;
  tokenStateData: TokenState;
  irpState: PublicKey;
  irpOwner: PublicKey;
  irsState: PublicKey;
  irsOwner: PublicKey;
  tirState: PublicKey;
  ctrState: PublicKey;
  complianceState: PublicKey;
  walletIdentity: PublicKey;
  walletIdentityData: WalletIdentityAccount | null;
  requiredTopics: bigint[];
};
type ClaimValidationDetail = {
  claim: PublicKey;
  topic: bigint;
  issuerFid: PublicKey;
  issuerEntry: PublicKey;
  expectedClaim: PublicKey;
  claimPdaValid: boolean;
  revoked: boolean;
  expired: boolean;
  trusted: boolean;
  signerValid: boolean;
  accountOrder: string[];
  accountChecks: {
    role: string;
    pubkey: PublicKey;
    exists: boolean;
    ownerProgram: PublicKey | null;
    accountType: string;
    isSigner: boolean;
    isWritable: boolean;
  }[];
};
type ClaimValidationResult =
  | {
      ok: true;
      requiredTopics: bigint[];
      checkedClaims: ClaimValidationDetail[];
      remainingAccounts: RemainingAccount[];
    }
  | {
      ok: false;
      reason: string;
      requiredTopics: bigint[];
      checkedClaims: ClaimValidationDetail[];
      remainingAccounts: RemainingAccount[];
    };

type TokenScopedClaimCheckResult = {
  ok: boolean;
  reason?: string;
  tokenMint: PublicKey;
  ctrState: PublicKey;
  tirState: PublicKey;
  requiredTopics: string[];
  topicRequired: boolean;
  investorHasActiveClaim: boolean;
  claimRevoked?: boolean;
  claimExpired?: boolean;
  providerSignerValid?: boolean;
  claimSignerKey?: PublicKey | null;
  providerTrustedForToken: boolean;
  checkedClaimPubkey?: PublicKey | null;
};

const CLAIM_ACCOUNT_SIZE = 230;
const CLAIM_ACCOUNT_DISCRIMINATOR = Buffer.from([
  113, 109, 47, 96, 242, 219, 61, 165,
]);
const MODULE_PROGRAM_IDS = new Set([
  MOD_MAX_INVESTORS.toBase58(),
  MOD_COUNTRY_RESTRICT.toBase58(),
  MOD_MAX_BALANCE.toBase58(),
  MOD_MAX_TRANSFER.toBase58(),
  MOD_LOCKUP.toBase58(),
  MOD_DAILY_LIMIT.toBase58(),
  MOD_SUPPLY_CAP.toBase58(),
  MOD_COUNTRY_CAP.toBase58(),
]);

function parseClaimAccount(data: Buffer): {
  fid: PublicKey;
  claimId: number;
  topic: bigint;
  issuerFid: PublicKey;
  signerKey: PublicKey;
  revoked: boolean;
  expiresAt: bigint;
} | null {
  const minimumSize = 8 + 32 + 4 + 8 + 32 + 32 + 32 + 64 + 8 + 8 + 1 + 1;
  if (data.length < minimumSize) return null;
  if (!data.subarray(0, CLAIM_ACCOUNT_DISCRIMINATOR.length).equals(CLAIM_ACCOUNT_DISCRIMINATOR)) {
    return null;
  }

  let offset = 8;
  const fid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  const claimId = data.readUInt32LE(offset);
  offset += 4;
  const topic = data.readBigUInt64LE(offset);
  offset += 8;
  const issuerFid = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 32; // data_hash
  const signerKey = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;
  offset += 64; // signature
  offset += 8; // issued_at
  const expiresAt = data.readBigInt64LE(offset);
  offset += 8;
  const revoked = data.readUInt8(offset) === 1;

  return { fid, claimId, topic, issuerFid, signerKey, revoked, expiresAt };
}

function parseCtrTopics(data: Buffer): bigint[] {
  if (data.length < 8 + 32 + 32 + 4) {
    return [];
  }

  let offset = 8 + 32 + 32;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;

  const topics: bigint[] = [];
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) break;
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }
  return topics;
}

function parseIssuerEntryForTopic(data: Buffer, topic: bigint): boolean {
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return false;
  const topicCount = data.readUInt32LE(offset);
  offset += 4;

  let hasTopic = false;
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) return false;
    if (data.readBigUInt64LE(offset) === topic) {
      hasTopic = true;
    }
    offset += 8;
  }

  if (data.length < offset + 1) return false;
  return data.readUInt8(offset) === 1 && hasTopic;
}

function parseFidIsIssuerAndSigner(data: Buffer, expectedSigner: PublicKey): boolean {
  if (data.length < 8 + 32 + 32 + 32 + 4 + 1) return false;
  const signerKey = new PublicKey(data.subarray(8 + 32 + 32, 8 + 32 + 32 + 32));
  const isIssuer = data.readUInt8(8 + 32 + 32 + 32 + 4) === 1;
  return isIssuer && signerKey.equals(expectedSigner);
}

function parseWalletIdentityAccount(data: Buffer): WalletIdentityAccount | null {
  const minimumSize = 8 + 32 + 32 + 2 + 32 + 1;
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

  return { wallet, fid, country, irs, isActive };
}

function claimIdLeBytes(claimId: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(claimId, 0);
  return bytes;
}

function accountTypeFromRole(role: string): string {
  if (role === "claim") return "ClaimAccount";
  if (role === "claimTopicIndex") return "ClaimTopicIndex";
  if (role === "trustedIssuerEntry") return "IssuerEntry";
  if (role === "issuerFid") return "FidAccount";
  return "Unknown";
}

function detailRole(index: number): string {
  if (index === 0) return "claim";
  if (index === 1) return "claimTopicIndex";
  if (index === 2) return "trustedIssuerEntry";
  if (index === 3) return "issuerFid";
  return "unknown";
}

const DEPLOYED_PROGRAM_IDS = {
  token: new PublicKey("92MCTz2KpWqhSD7LWay97LmZbdmpAj4fJ3FXtV7rbW9s"),
  fid: new PublicKey("EoENMXgL9GZBEVfjhn5KU4SkfjZeyoTEdd8NHAcMQsEB"),
  irs: new PublicKey("GSLErK4bEfF6ZozTWfjYikWfnBitMYrdbbgfXubJBgVJ"),
  tir: new PublicKey("8KDYYPx74w6ZLKZgcvVWrj1mCv1gcULdTh2jbxcJwGMJ"),
  ctr: new PublicKey("12rCF9fuSth8T3o6sfpfWdGyaDEQ1jNsxe1ZvKH7q2tS"),
  compliance: new PublicKey("FhMXw2VmYYksR4VcjQCUNWYrhzba1rmfiU1EDvaTsxHj"),
} as const;

// ─── TokenService ─────────────────────────────────────────────────────────────

export class TokenService {
  private program: TokenProgram;
  private provider: AnchorProvider;
  private factoryStatePromise: Promise<FactoryStateAccount | null> | null = null;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(TokenIdl as unknown as Idl, provider);
  }

  private async getFactoryState(): Promise<FactoryStateAccount | null> {
    if (!this.factoryStatePromise) {
      this.factoryStatePromise = fetchFactoryStateAccount().catch(() => null);
    }
    return this.factoryStatePromise;
  }

  private async getProgramIds(): Promise<SuiteProgramIds> {
    const state = await this.getFactoryState();
    return {
      token: state?.tokenProgramId ?? DEPLOYED_PROGRAM_IDS.token,
      fid: state?.fidProgramId ?? DEPLOYED_PROGRAM_IDS.fid,
      irs: state?.irsProgramId ?? DEPLOYED_PROGRAM_IDS.irs,
      tir: state?.tirProgramId ?? DEPLOYED_PROGRAM_IDS.tir,
      ctr: state?.ctrProgramId ?? DEPLOYED_PROGRAM_IDS.ctr,
      compliance: state?.complianceProgramId ?? DEPLOYED_PROGRAM_IDS.compliance,
    };
  }

  private getTokenProgram(programId: PublicKey): TokenProgram {
    return new Program(
      {
        ...(TokenIdl as unknown as Record<string, unknown>),
        address: programId.toBase58(),
      } as Idl,
      this.provider,
    );
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /** Seeds: ["token_state", mint] */
  findTokenStatePda(
    mint: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_TOKEN_STATE, mint.toBuffer()],
      programId
    );
  }

  /** Seeds: ["owner", mint] */
  findOwnerStatePda(
    mint: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_OWNER, mint.toBuffer()],
      programId
    );
  }

  /** Seeds: ["agent", mint, agent] */
  findAgentRolePda(
    mint: PublicKey,
    agent: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_AGENT, mint.toBuffer(), agent.toBuffer()],
      programId
    );
  }

  /**
   * Seeds: ["frozen", mint, wallet]
   * Note: The on-chain IDL seed is "frozen" (6 bytes), matching the bytes
   * [102, 114, 111, 122, 101, 110] in fracks_token.json.
   */
  findFrozenWalletPda(
    mint: PublicKey,
    wallet: PublicKey,
    programId: PublicKey = TOKEN_PROGRAM_ID,
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), wallet.toBuffer()],
      programId
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  async fetchTokenState(mint: PublicKey): Promise<TokenState> {
    const ids = await this.getProgramIds();
    const tokenProgram = this.getTokenProgram(ids.token);
    const [tokenStatePda] = this.findTokenStatePda(mint, ids.token);
    const raw = await (tokenProgram.account as any).tokenState.fetch(tokenStatePda);
    return {
      tokenMint: raw.tokenMint.toBase58(),
      identityRegistry: raw.identityRegistry.toBase58(),
      compliance: raw.compliance.toBase58(),
      paused: raw.paused,
      decimals: raw.decimals,
      name: raw.name,
      symbol: raw.symbol,
      isin: raw.isin,
      bump: raw.bump,
    };
  }

  async fetchOwnerState(mint: PublicKey): Promise<OwnerState> {
    const ids = await this.getProgramIds();
    const tokenProgram = this.getTokenProgram(ids.token);
    const [ownerStatePda] = this.findOwnerStatePda(mint, ids.token);
    const raw = await (tokenProgram.account as any).ownerState.fetch(ownerStatePda);
    return {
      owner: raw.owner.toBase58(),
      tokenMint: raw.tokenMint.toBase58(),
      bump: raw.bump,
    };
  }

  async fetchTokenMintHealth(mint: PublicKey): Promise<TokenMintHealth> {
    const tokenState = await this.fetchTokenState(mint);

    if (tokenState.paused) {
      return {
        mint: mint.toBase58(),
        transferable: false,
        reason: "Transfers are paused for this token.",
        missingModuleAccounts: [],
      };
    }

    const complianceInfo = await this.provider.connection.getAccountInfo(
      new PublicKey(tokenState.compliance),
      "confirmed"
    );

    if (!complianceInfo) {
      return {
        mint: mint.toBase58(),
        transferable: false,
        reason: "The token compliance account is missing on-chain.",
        missingModuleAccounts: [],
      };
    }

    const data = complianceInfo.data;
    if (data.length < 78) {
      return {
        mint: mint.toBase58(),
        transferable: false,
        reason: "The token compliance account is malformed on-chain.",
        missingModuleAccounts: [],
      };
    }

    const moduleCount = data.readUInt32LE(72);
    const modules: PublicKey[] = [];
    let offset = 76;
    for (let index = 0; index < moduleCount; index += 1) {
      modules.push(new PublicKey(data.slice(offset, offset + 32)));
      offset += 32;
    }

    const modulesPaused = data[offset] === 1;
    if (modulesPaused) {
      return {
        mint: mint.toBase58(),
        transferable: false,
        reason: "Compliance modules are paused for this token.",
        missingModuleAccounts: [],
      };
    }

    if (modules.length === 0) {
      return {
        mint: mint.toBase58(),
        transferable: true,
        reason: null,
        missingModuleAccounts: [],
      };
    }

    const moduleInfos = await this.provider.connection.getMultipleAccountsInfo(
      modules,
      "confirmed"
    );
    const missingModuleAccounts = modules
      .filter((_, index) => !moduleInfos[index])
      .map((pubkey) => pubkey.toBase58());

    if (missingModuleAccounts.length > 0) {
      return {
        mint: mint.toBase58(),
        transferable: false,
        reason: "This token has missing compliance module accounts on-chain.",
        missingModuleAccounts,
      };
    }

    return {
      mint: mint.toBase58(),
      transferable: true,
      reason: null,
      missingModuleAccounts: [],
    };
  }

  /**
   * Returns true if the wallet has an active agent role for this mint.
   */
  async isAgent(mint: PublicKey, wallet: PublicKey): Promise<boolean> {
    try {
      const [agentRolePda] = this.findAgentRolePda(mint, wallet);
      const raw = await (this.program.account as any).agentRole.fetch(agentRolePda);
      return raw.isActive;
    } catch {
      return false;
    }
  }

  /**
   * Returns true if the wallet has a FrozenWallet PDA for this mint.
   */
  async isFrozen(mint: PublicKey, wallet: PublicKey): Promise<boolean> {
    try {
      const [frozenWalletPda] = this.findFrozenWalletPda(mint, wallet);
      await (this.program.account as any).frozenWallet.fetch(frozenWalletPda);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fetches the registry of all investors (FrozenWallet + token accounts).
   * Returns a list of {wallet, frozen, balance} entries derived from FrozenWallet
   * accounts plus any AgentRole accounts for the mint.
   */
  async fetchInvestorRegistry(
    mint: PublicKey
  ): Promise<{ wallet: string; frozen: boolean; balance: bigint }[]> {
    // Fetch all FrozenWallet accounts for this mint using discriminator + mint filter
    // FrozenWallet layout: discriminator(8) + wallet(32) + token_mint(32) + ...
    // token_mint is at byte offset 40.
    const frozenDiscriminator = Buffer.from([165, 203, 218, 18, 62, 58, 187, 59]);
    const frozenAccounts = await this.provider.connection.getProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0, bytes: frozenDiscriminator.toString("base64"), encoding: "base64" } },
          { memcmp: { offset: 40, bytes: mint.toBase58() } },
        ],
      }
    );

    const frozenWallets = new Set<string>();
    for (const { account } of frozenAccounts) {
      try {
        const decoded = this.program.coder.accounts.decode("FrozenWallet", account.data);
        frozenWallets.add((decoded.wallet as PublicKey).toBase58());
      } catch {
        // skip
      }
    }

    // Build result — we only have the frozen-wallet list here; callers that
    // need balances should combine this with useTokenBalance.
    return Array.from(frozenWallets).map((wallet) => ({
      wallet,
      frozen: true,
      balance: BigInt(0),
    }));
  }

  // ── Write Methods ─────────────────────────────────────────────────────────────

  /**
   * Mints tokens to a recipient's token account.
   * The caller must be an active agent for the mint.
   */
  async mint(
    mintPubkey: PublicKey,
    recipient: PublicKey,
    amount: bigint
  ): Promise<string> {
    const ids = await this.getProgramIds();
    const authority = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey, ids.token);
    const [ownerState] = this.findOwnerStatePda(mintPubkey, ids.token);
    const [agentRole] = this.findAgentRolePda(mintPubkey, authority, ids.token);

    // Fetch token state to resolve linked accounts
    const ts = await this.fetchTokenState(mintPubkey);

    // Derive destination ATA (Token-2022)
    const {
      createAssociatedTokenAccountIdempotentInstruction,
      getAccount,
      getAssociatedTokenAddressSync,
      getMint,
      TOKEN_2022_PROGRAM_ID: SPL_T22,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    } = await import("@solana/spl-token");

    try {
      await getMint(this.provider.connection, mintPubkey, "confirmed", SPL_T22);
    } catch {
      throw new Error(
        `Mint ${mintPubkey.toBase58()} is not a valid Token-2022 mint. Check that the purchase request tokenContract is the token mint address.`,
      );
    }
    const destinationTokenAccount = getAssociatedTokenAddressSync(
      mintPubkey,
      recipient,
      false,
      SPL_T22
    );

    let destinationAccount;
    try {
      destinationAccount = await getAccount(
        this.provider.connection,
        destinationTokenAccount,
        "confirmed",
        SPL_T22,
      );
    } catch {
      const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
        authority,
        destinationTokenAccount,
        recipient,
        mintPubkey,
        SPL_T22,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );

      await this.provider.sendAndConfirm(
        new Transaction().add(createAtaIx),
        [],
        { commitment: "confirmed" }
      );

      try {
        destinationAccount = await getAccount(
          this.provider.connection,
          destinationTokenAccount,
          "confirmed",
          SPL_T22,
        );
      } catch (err) {
        throw new Error(
          `Failed to create a valid Token-2022 recipient account ${destinationTokenAccount.toBase58()}: ${formatTransactionError(err)}`,
        );
      }
    }

    if (!destinationAccount.mint.equals(mintPubkey)) {
      throw new Error("Recipient token account belongs to a different mint.");
    }
    if (!destinationAccount.owner.equals(recipient)) {
      throw new Error("Recipient token account is not owned by the investor wallet.");
    }

    // Derive frozen wallet PDA for recipient (may not exist — passes as placeholder)
    const [toFrozen] = this.findFrozenWalletPda(
      mintPubkey,
      recipient,
      ids.token,
    );

    // Fetch current balance for to_balance_after calculation
    const toBalanceBefore = destinationAccount.amount;
    const toBalanceAfter = toBalanceBefore + amount;

    const { registry, claimValidation } = await this.verifyRecipientMintPreflight(
      mintPubkey,
      recipient,
      destinationTokenAccount,
      ids,
      ts,
    );
    const {
      irpState: irpStatePubkey,
      irsState,
      tirState,
      ctrState,
      complianceState,
      walletIdentity,
      walletIdentityData,
    } = registry;

    const verificationAndComplianceAccounts =
      await this.getMintRemainingAccounts(
        walletIdentity,
        complianceState,
        ids,
        claimValidation.remainingAccounts,
      );
    await this.prepareDailyLimitUsageAccounts(mintPubkey, recipient, ids);

    try {
      const mintAccounts = [
        { pubkey: authority, isSigner: true, isWritable: true },
        { pubkey: tokenState, isSigner: false, isWritable: false },
        { pubkey: ownerState, isSigner: false, isWritable: false },
        { pubkey: agentRole, isSigner: false, isWritable: false },
        { pubkey: irpStatePubkey, isSigner: false, isWritable: false },
        { pubkey: irsState, isSigner: false, isWritable: false },
        { pubkey: tirState, isSigner: false, isWritable: false },
        { pubkey: ctrState, isSigner: false, isWritable: false },
        { pubkey: complianceState, isSigner: false, isWritable: false },
        { pubkey: ids.compliance, isSigner: false, isWritable: false },
        { pubkey: walletIdentity, isSigner: false, isWritable: false },
        { pubkey: toFrozen, isSigner: false, isWritable: false },
        { pubkey: mintPubkey, isSigner: false, isWritable: true },
        { pubkey: destinationTokenAccount, isSigner: false, isWritable: true },
        {
          pubkey: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
          isSigner: false,
          isWritable: false,
        },
        ...verificationAndComplianceAccounts,
      ];
      const tokenProgram = this.getTokenProgram(ids.token);
      const mintIx = await (tokenProgram.methods as any)
        .mint(
          recipient,
          new BN(amount.toString()),
          new BN(toBalanceAfter.toString()),
        )
        .accounts({
          authority,
          tokenState,
          ownerState,
          agentRole,
          irpState: irpStatePubkey,
          irsState,
          tirState,
          ctrState,
          complianceState,
          complianceProgram: ids.compliance,
          walletIdentity,
          toFrozen,
          tokenMintAccount: mintPubkey,
          destinationTokenAccount,
          tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        })
        .remainingAccounts(verificationAndComplianceAccounts)
        .instruction();
      this.logMintVerificationDebug({
        authority,
        recipient,
        destinationTokenAccount,
        registry,
        claimValidation,
        finalAccounts: mintIx.keys,
      });

      const sig = await this.provider.sendAndConfirm(
        new Transaction().add(mintIx),
        [],
        { commitment: "confirmed" },
      );
      return sig;
    } catch (err) {
      const formatted = formatTransactionError(err);
      if (formatted.includes("Wallet is not verified") || formatted.includes("WalletNotVerified")) {
        throw new Error(
          `${formatted}\n\nMint preflight passed, but the token program still rejected recipient verification. Check the [MINT VERIFICATION DEBUG] console block for the exact wallet_identity.fid, canonical claim PDA, issuer entry, and issuer FID accounts passed to the instruction. If this message appears without a fresh debug block, restart the frontend dev server to clear stale compiled code.`,
        );
      }
      throw new Error(formatted);
    }
  }

  /**
   * Shared mint preflight used by both the UI mint flow and the simulation
   * script. Keep this aligned with fracks-token `mint`: it verifies the
   * recipient wallet owner, not the recipient ATA or issuer identity.
   */
  async verifyRecipientMintPreflight(
    mintPubkey: PublicKey,
    recipient: PublicKey,
    destinationTokenAccount?: PublicKey,
    resolvedIds?: SuiteProgramIds,
    resolvedTokenState?: TokenState,
  ): Promise<{
    registry: MintRegistryContext & { walletIdentityData: WalletIdentityAccount };
    claimValidation: ClaimValidationResult;
  }> {
    const ids = resolvedIds ?? (await this.getProgramIds());
    const tokenStateData = resolvedTokenState ?? (await this.fetchTokenState(mintPubkey));
    const registry = await this.resolveMintRegistryContext(
      mintPubkey,
      recipient,
      ids,
      tokenStateData,
    );
    const { walletIdentityData } = registry;

    if (!walletIdentityData) {
      throw new Error(
        "Investor identity is not registered in this token's Identity Registry Storage (IRS). The investor must register their FID identity before minting.",
      );
    }
    if (!walletIdentityData.wallet.equals(recipient)) {
      throw new Error(
        `Wrong wallet identity subject. Expected investor wallet ${recipient.toBase58()}, got ${walletIdentityData.wallet.toBase58()}.`,
      );
    }
    if (destinationTokenAccount && walletIdentityData.wallet.equals(destinationTokenAccount)) {
      throw new Error(
        "Wrong wallet identity subject. The recipient ATA was used where the investor wallet owner is required.",
      );
    }
    if (!walletIdentityData.irs.equals(registry.irsState)) {
      throw new Error(
        `Investor identity belongs to IRS ${walletIdentityData.irs.toBase58()}, but this token uses IRS ${registry.irsState.toBase58()}.`,
      );
    }
    if (!walletIdentityData.isActive) {
      const irpOwner = registry.irpOwner.toBase58();
      throw new Error(
        `Investor identity is registered but inactive in this token's Identity Registry Storage (IRS). Please ask the central platform administrator / IRS State Owner (${irpOwner}) to activate this identity.`,
      );
    }

    const strictRegistry = {
      ...registry,
      walletIdentityData,
    };
    const claimValidation = await this.validateRecipientClaimsForMint(
      recipient,
      strictRegistry,
    );
    if (!claimValidation.ok) {
      throw new Error(claimValidation.reason);
    }

    return { registry: strictRegistry, claimValidation };
  }

  private async resolveMintRegistryContext(
    mintPubkey: PublicKey,
    recipient: PublicKey,
    ids: SuiteProgramIds,
    tokenStateData: TokenState,
    options: { enforceOwnerInvariant?: boolean } = {},
  ): Promise<MintRegistryContext> {
    const irpState = new PublicKey(tokenStateData.identityRegistry);
    const irpInfo = await this.provider.connection.getAccountInfo(irpState, "confirmed");
    if (!irpInfo || irpInfo.data.length < 168) {
      throw new Error(
        `Identity registry protocol account ${irpState.toBase58()} is missing or malformed for token ${mintPubkey.toBase58()}.`,
      );
    }

    const irpTokenMint = new PublicKey(irpInfo.data.subarray(8, 40));
    const irpOwner = new PublicKey(irpInfo.data.subarray(40, 72));
    const irsState = new PublicKey(irpInfo.data.subarray(72, 104));
    const tirState = new PublicKey(irpInfo.data.subarray(104, 136));
    const ctrState = new PublicKey(irpInfo.data.subarray(136, 168));
    const complianceState = new PublicKey(tokenStateData.compliance);

    if (!irpTokenMint.equals(mintPubkey)) {
      throw new Error(
        `Token registry mismatch. IRP ${irpState.toBase58()} is bound to mint ${irpTokenMint.toBase58()}, not ${mintPubkey.toBase58()}.`,
      );
    }

    const [walletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), recipient.toBuffer()],
      ids.irs,
    );

    const [irsInfo, tirInfo, ctrInfo, complianceInfo, walletIdentityInfo] =
      await this.provider.connection.getMultipleAccountsInfo(
        [irsState, tirState, ctrState, complianceState, walletIdentity],
        "confirmed",
      );

    if (!irsInfo) {
      throw new Error(`Identity Registry Storage account ${irsState.toBase58()} is missing.`);
    }
    if (irsInfo.data.length < 40) {
      throw new Error(`Identity Registry Storage account ${irsState.toBase58()} is malformed.`);
    }
    const irsOwner = new PublicKey(irsInfo.data.subarray(8, 40));
    const enforceOwnerInvariant = options.enforceOwnerInvariant ?? true;
    if (enforceOwnerInvariant && !irsOwner.equals(irpOwner)) {
      throw new Error(
        `Token registry ownership is misconfigured. IRP owner ${irpOwner.toBase58()} does not match IRS owner ${irsOwner.toBase58()}. This token suite cannot verify investor identities until the registry owners are repaired or the token is redeployed with aligned IRP/IRS ownership.`,
      );
    }
    if (!tirInfo) {
      throw new Error(`Trusted Issuers Registry account ${tirState.toBase58()} is missing.`);
    }
    if (!ctrInfo) {
      throw new Error(`Claim Topics Registry account ${ctrState.toBase58()} is missing.`);
    }
    if (!complianceInfo) {
      throw new Error(`Compliance state account ${complianceState.toBase58()} is missing.`);
    }
    if (!complianceInfo.owner.equals(ids.compliance)) {
      throw new Error(
        `Compliance state ${complianceState.toBase58()} is owned by ${complianceInfo.owner.toBase58()}, expected ${ids.compliance.toBase58()}.`,
      );
    }

    const walletIdentityData = walletIdentityInfo
      ? parseWalletIdentityAccount(walletIdentityInfo.data)
      : null;

    return {
      ids,
      tokenStateData,
      irpState,
      irpOwner,
      irsState,
      irsOwner,
      tirState,
      ctrState,
      complianceState,
      walletIdentity,
      walletIdentityData,
      requiredTopics: parseCtrTopics(ctrInfo.data),
    };
  }

  private logMintVerificationDebug(input: {
    authority: PublicKey;
    recipient: PublicKey;
    destinationTokenAccount: PublicKey;
    registry: MintRegistryContext;
    claimValidation: ClaimValidationResult;
    finalAccounts: RemainingAccount[];
  }): void {
    const { authority, recipient, destinationTokenAccount, registry, claimValidation, finalAccounts } =
      input;

    const debug = {
      rpcEndpoint: this.provider.connection.rpcEndpoint,
      tokenProgramId: registry.ids.token.toBase58(),
      fidProgramId: registry.ids.fid.toBase58(),
      irsProgramId: registry.ids.irs.toBase58(),
      tirProgramId: registry.ids.tir.toBase58(),
      ctrProgramId: registry.ids.ctr.toBase58(),
      complianceProgramId: registry.ids.compliance.toBase58(),
      tokenMint: registry.tokenStateData.tokenMint,
      tokenState: this.findTokenStatePda(
        new PublicKey(registry.tokenStateData.tokenMint),
        registry.ids.token,
      )[0].toBase58(),
      issuerWallet: authority.toBase58(),
      investorWalletOwner: recipient.toBase58(),
      recipientAta: destinationTokenAccount.toBase58(),
      irpState: registry.irpState.toBase58(),
      irpOwner: registry.irpOwner.toBase58(),
      irsState: registry.irsState.toBase58(),
      irsOwner: registry.irsOwner.toBase58(),
      tirState: registry.tirState.toBase58(),
      ctrState: registry.ctrState.toBase58(),
      complianceState: registry.complianceState.toBase58(),
      walletIdentityPda: registry.walletIdentity.toBase58(),
      recipientIdentityActive: registry.walletIdentityData?.isActive ?? false,
      recipientIdentityWallet: registry.walletIdentityData?.wallet.toBase58() ?? null,
      recipientIdentityFid: registry.walletIdentityData?.fid.toBase58() ?? null,
      requiredClaimTopics: registry.requiredTopics.map(String),
      matchingInvestorClaims: claimValidation.checkedClaims.map((claim) => ({
        claim: claim.claim.toBase58(),
        topic: claim.topic.toString(),
        issuerFid: claim.issuerFid.toBase58(),
        issuerEntry: claim.issuerEntry.toBase58(),
        expectedClaim: claim.expectedClaim.toBase58(),
        claimPdaValid: claim.claimPdaValid,
        revoked: claim.revoked,
        expired: claim.expired,
        trusted: claim.trusted,
        signerValid: claim.signerValid,
        exactOrderSent: claim.accountOrder,
        accountChecks: claim.accountChecks.map((check) => ({
          role: check.role,
          pubkey: check.pubkey.toBase58(),
          exists: check.exists,
          ownerProgram: check.ownerProgram?.toBase58() ?? null,
          accountType: check.accountType,
          isSigner: check.isSigner,
          isWritable: check.isWritable,
        })),
      })),
      finalInstructionAccounts: finalAccounts.map((account, index) => ({
        index,
        pubkey: account.pubkey.toBase58(),
        isSigner: account.isSigner,
        isWritable: account.isWritable,
      })),
    };

    console.info("[MINT VERIFICATION DEBUG]", debug);
    console.info("[MINT VERIFICATION DEBUG JSON]", JSON.stringify(debug, null, 2));
    console.info(
      "[MINT REMAINING ACCOUNTS DEBUG]",
      JSON.stringify(
        claimValidation.checkedClaims.map((claim) => ({
          topic: claim.topic.toString(),
          claimPda: claim.claim.toBase58(),
          issuerFidPda: claim.issuerFid.toBase58(),
          trustedIssuerEntryPda: claim.issuerEntry.toBase58(),
          exactOrderSent: claim.accountOrder,
          accounts: claim.accountChecks.map((check) => ({
            role: check.role,
            pubkey: check.pubkey.toBase58(),
            exists: check.exists,
            ownerProgram: check.ownerProgram?.toBase58() ?? null,
            accountType: check.accountType,
            isSigner: check.isSigner,
            isWritable: check.isWritable,
          })),
        })),
        null,
        2,
      ),
    );
  }

  private async getMintRemainingAccounts(
    walletIdentity: PublicKey,
    complianceState: PublicKey,
    ids: SuiteProgramIds,
    claimRemainingAccounts: RemainingAccount[],
  ): Promise<RemainingAccount[]> {
    const accounts: RemainingAccount[] = [...claimRemainingAccounts];
    const seen = new Set<string>();
    for (const account of claimRemainingAccounts) {
      seen.add(account.pubkey.toBase58());
    }
    const push = (pubkey: PublicKey, isWritable = false) => {
      const key = pubkey.toBase58();
      if (seen.has(key)) return;
      seen.add(key);
      accounts.push({ pubkey, isSigner: false, isWritable });
    };

    try {
      const complianceProgram = new Program(
        {
          ...(ComplianceIdl as unknown as Record<string, unknown>),
          address: ids.compliance.toBase58(),
        } as Idl,
        this.provider,
      );
      const compliance = await (complianceProgram.account as any).complianceState.fetch(
        complianceState
      );
      const moduleAccounts = compliance.modules as PublicKey[];
      const moduleInfos = await this.provider.connection.getMultipleAccountsInfo(
        moduleAccounts,
        "confirmed"
      );
      const recipientCountry = await this.readWalletIdentityCountry(walletIdentity);

      for (const [index, moduleAccount] of moduleAccounts.entries()) {
        push(moduleAccount, true);
        const moduleInfo = moduleInfos[index];
        if (!moduleInfo) {
          continue;
        }
        this.pushModuleProgramAccount(push, moduleInfo.owner);

        if (moduleInfo.owner.equals(MOD_COUNTRY_CAP) && recipientCountry !== null) {
          const [countryCount] = PublicKey.findProgramAddressSync(
            [
              Buffer.from("country_count"),
              moduleAccount.toBuffer(),
              this.u16LeBytes(recipientCountry),
            ],
            MOD_COUNTRY_CAP
          );
          push(countryCount, true);
        }
      }
    } catch {
      // Compliance failures will still be enforced on-chain; this only collects optional modules.
    }

    return accounts;
  }

  private async validateRecipientClaimsForMint(
    recipient: PublicKey,
    registry: MintRegistryContext,
  ): Promise<ClaimValidationResult> {
    const { ids, tirState, requiredTopics } = registry;
    const checkedClaims: ClaimValidationDetail[] = [];
    const remainingAccounts: RemainingAccount[] = [];

    if (requiredTopics.length === 0) {
      return { ok: true, requiredTopics, checkedClaims, remainingAccounts };
    }

    const holderFid = registry.walletIdentityData?.fid;
    if (!holderFid) {
      return {
        ok: false,
        reason: "Investor identity is not registered in this token's Identity Registry Storage (IRS). The investor must register their FID identity before minting.",
        requiredTopics,
        checkedClaims,
        remainingAccounts,
      };
    }

    const fidInfo = await this.provider.connection.getAccountInfo(holderFid, "confirmed");
    if (!fidInfo) {
      return {
        ok: false,
        reason: `Investor wallet identity points to missing FID account ${holderFid.toBase58()}. Ask the investor to register FID before minting.`,
        requiredTopics,
        checkedClaims,
        remainingAccounts,
      };
    }

    const claimAccounts = await this.provider.connection.getProgramAccounts(ids.fid, {
      commitment: "confirmed",
      filters: [
        { dataSize: CLAIM_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: holderFid.toBase58() } },
      ],
    });

    const now = BigInt(Math.floor(Date.now() / 1000));
    const claims = claimAccounts
      .map(({ pubkey, account }) => {
        const claim = parseClaimAccount(account.data);
        return claim ? { ...claim, pubkey } : null;
      })
      .filter(
        (
          c,
        ): c is NonNullable<ReturnType<typeof parseClaimAccount>> & {
          pubkey: PublicKey;
        } => c !== null,
      );

    // Fetch the TIR State Owner to use in the error messages
    const tirInfo = await this.provider.connection.getAccountInfo(tirState, "confirmed");
    const tirOwner = tirInfo ? new PublicKey(tirInfo.data.subarray(8, 40)).toBase58() : "unknown";

    for (const topic of requiredTopics) {
      const topicClaims = claims.filter((c) => c.topic === topic);
      if (topicClaims.length === 0) {
        return {
          ok: false,
          reason: `Investor is missing claim for required topic ${topic}.`,
          requiredTopics,
          checkedClaims,
          remainingAccounts,
        };
      }

      // Check if at least one claim is fully valid
      let hasFullyValidClaim = false;
      let failureReason = "";

      for (const claim of topicClaims) {
        const expired = claim.expiresAt !== 0n && claim.expiresAt < now;
        const [expectedClaim] = PublicKey.findProgramAddressSync(
          [Buffer.from("claim"), holderFid.toBuffer(), claimIdLeBytes(claim.claimId)],
          ids.fid,
        );
        const [issuerEntry] = PublicKey.findProgramAddressSync(
          [Buffer.from("issuer_entry"), tirState.toBuffer(), claim.issuerFid.toBuffer()],
          ids.tir,
        );
        const topicBytes = this.u64LeBytes(topic);
        const [claimTopicIndex] = PublicKey.findProgramAddressSync(
          [
            Buffer.from("claim_topic_index"),
            holderFid.toBuffer(),
            claim.issuerFid.toBuffer(),
            topicBytes,
          ],
          ids.fid,
        );
        const claimPdaValid = claim.pubkey.equals(expectedClaim);
        const accountMetas: RemainingAccount[] = [
          { pubkey: claim.pubkey, isSigner: false, isWritable: false },
          { pubkey: claimTopicIndex, isSigner: false, isWritable: false },
          { pubkey: issuerEntry, isSigner: false, isWritable: false },
          { pubkey: claim.issuerFid, isSigner: false, isWritable: false },
        ];
        const accountInfos = await this.provider.connection.getMultipleAccountsInfo(
          accountMetas.map((account) => account.pubkey),
          "confirmed",
        );
        const detail: ClaimValidationDetail = {
          claim: claim.pubkey,
          topic,
          issuerFid: claim.issuerFid,
          issuerEntry,
          expectedClaim,
          claimPdaValid,
          revoked: claim.revoked,
          expired,
          trusted: false,
          signerValid: false,
          accountOrder: ["claim", "claimTopicIndex", "trustedIssuerEntry", "issuerFid"],
          accountChecks: accountMetas.map((account, index) => ({
            role: detailRole(index),
            pubkey: account.pubkey,
            exists: Boolean(accountInfos[index]),
            ownerProgram: accountInfos[index]?.owner ?? null,
            accountType: accountTypeFromRole(detailRole(index)),
            isSigner: account.isSigner,
            isWritable: account.isWritable,
          })),
        };
        checkedClaims.push(detail);

        if (!claimPdaValid) {
          if (!failureReason) {
            failureReason = `Claim for required topic ${topic} is not at the canonical claim PDA expected by the token program.`;
          }
          continue;
        }
        if (claim.revoked) {
          if (!failureReason) failureReason = `Claim for required topic ${topic} is revoked.`;
          continue;
        }
        if (expired) {
          if (!failureReason) failureReason = `Claim for required topic ${topic} has expired.`;
          continue;
        }

        // Validate issuer entry and trust
        const [issuerEntryInfo, issuerFidInfo] =
          await this.provider.connection.getMultipleAccountsInfo(
            [issuerEntry, claim.issuerFid],
            "confirmed",
          );

        if (!issuerEntryInfo || !issuerFidInfo) {
          failureReason = `Claim exists for topic ${topic}, but claim issuer FID ${claim.issuerFid.toBase58()} is not trusted in this token's TIR. Ask TIR owner ${tirOwner} to add it.`;
          continue;
        }

        detail.trusted = parseIssuerEntryForTopic(issuerEntryInfo.data, claim.topic);
        if (!detail.trusted) {
          failureReason = `Claim exists for topic ${topic}, but claim issuer FID ${claim.issuerFid.toBase58()} is not trusted in this token's TIR. Ask TIR owner ${tirOwner} to add it.`;
          continue;
        }

        detail.signerValid = parseFidIsIssuerAndSigner(issuerFidInfo.data, claim.signerKey);
        if (!detail.signerValid) {
          failureReason = `Claim for required topic ${topic} has an invalid issuer FID profile or signer key mismatch.`;
          continue;
        }

        // If we reach here, we found a fully valid claim for this required topic!
        for (const account of accountMetas) {
          if (!remainingAccounts.some((entry) => entry.pubkey.equals(account.pubkey))) {
            remainingAccounts.push(account);
          }
        }
        hasFullyValidClaim = true;
        break;
      }

      if (!hasFullyValidClaim) {
        return {
          ok: false,
          reason: failureReason || `Investor has no valid claim for required topic ${topic}.`,
          requiredTopics,
          checkedClaims,
          remainingAccounts,
        };
      }
    }

    return { ok: true, requiredTopics, checkedClaims, remainingAccounts };
  }

  private pushModuleProgramAccount(
    push: (pubkey: PublicKey, isWritable?: boolean) => void,
    moduleProgramId: PublicKey
  ): void {
    if (!MODULE_PROGRAM_IDS.has(moduleProgramId.toBase58())) {
      return;
    }
    push(moduleProgramId);
  }

  private async readWalletIdentityCountry(walletIdentity: PublicKey): Promise<number | null> {
    const info = await this.provider.connection.getAccountInfo(walletIdentity, "confirmed");
    if (!info || info.data.length < 74) {
      return null;
    }
    return info.data.readUInt16LE(72);
  }

  private async prepareDailyLimitUsageAccounts(
    mintPubkey: PublicKey,
    wallet: PublicKey,
    ids: SuiteProgramIds,
  ): Promise<void> {
    const [complianceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("compliance_state"), mintPubkey.toBuffer()],
      ids.compliance
    );
    const complianceProgram = new Program(
      {
        ...(ComplianceIdl as unknown as Record<string, unknown>),
        address: ids.compliance.toBase58(),
      } as Idl,
      this.provider,
    );
    const dailyProgram = new Program(ModDailyLimitIdl as unknown as Idl, this.provider);
    const compliance = await (complianceProgram.account as any).complianceState.fetch(
      complianceStatePda
    );
    const moduleAccounts = compliance.modules as PublicKey[];
    const moduleInfos = await this.provider.connection.getMultipleAccountsInfo(
      moduleAccounts,
      "confirmed"
    );

    for (const [index, moduleAccount] of moduleAccounts.entries()) {
      const moduleInfo = moduleInfos[index];
      if (!moduleInfo?.owner.equals(MOD_DAILY_LIMIT)) {
        continue;
      }

      const [dailyUsage] = PublicKey.findProgramAddressSync(
        [Buffer.from("daily_usage"), moduleAccount.toBuffer(), wallet.toBuffer()],
        MOD_DAILY_LIMIT
      );
      const existingUsage = await this.provider.connection.getAccountInfo(
        dailyUsage,
        "confirmed"
      );
      if (existingUsage) {
        continue;
      }

      const module = await (dailyProgram.account as any).dailyTransferLimitModule.fetch(
        moduleAccount
      );
      const moduleOwner = module.owner as PublicKey;
      if (!moduleOwner.equals(this.provider.wallet.publicKey)) {
        // Older deployed daily-limit modules only let the module owner create
        // this support PDA. Mint should not be blocked for issuer-owned suites
        // where the admin initialized modules during deployment; compliance
        // falls back gracefully if the usage PDA is absent.
        continue;
      }

      await (dailyProgram.methods as any)
        .initializeWalletUsage(wallet)
        .accounts({
          owner: this.provider.wallet.publicKey,
          moduleState: moduleAccount,
          walletUsage: dailyUsage,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
    }
  }

  private u16LeBytes(value: number): Buffer {
    const bytes = Buffer.alloc(2);
    bytes.writeUInt16LE(value);
    return bytes;
  }

  private u64LeBytes(value: bigint): Buffer {
    const bytes = Buffer.alloc(8);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (typeof view.setBigUint64 === "function") {
      view.setBigUint64(0, value, true);
    } else {
      // Fallback for environments without setBigUint64
      const lo = Number(value & 0xffffffffn);
      const hi = Number((value >> 32n) & 0xffffffffn);
      bytes.writeUInt32LE(lo, 0);
      bytes.writeUInt32LE(hi, 4);
    }
    return bytes;
  }

  /**
   * Checks whether a specific claim topic for a given investor + provider is
   * valid in the context of a particular token suite (CTR/TIR + token state).
   * Returns a detailed result used by KYC flows to decide whether to forward
   * requests to the issuer.
   */
  async checkTokenScopedClaimForRequest(opts: {
    requestId?: string;
    mint: PublicKey;
    investorWallet: PublicKey;
    providerWallet: PublicKey;
    topic: bigint;
  }): Promise<TokenScopedClaimCheckResult> {
    const { requestId, mint, investorWallet, providerWallet, topic } = opts;
    const ids = await this.getProgramIds();
    const tokenStateData = await this.fetchTokenState(mint);
    const registry = await this.resolveMintRegistryContext(
      mint,
      investorWallet,
      ids,
      tokenStateData,
      { enforceOwnerInvariant: false },
    );
    const ctrState = registry.ctrState;
    const tirState = registry.tirState;
    const requiredTopics = registry.requiredTopics.map(String);
    const topicStr = topic.toString();

    const debugBase = {
      requestId: requestId ?? null,
      tokenMint: mint.toBase58(),
      investorWallet: investorWallet.toBase58(),
      providerWallet: providerWallet.toBase58(),
      ctrState: ctrState.toBase58(),
      tirState: tirState.toBase58(),
      irpState: registry.irpState.toBase58(),
      irpOwner: registry.irpOwner.toBase58(),
      irsState: registry.irsState.toBase58(),
      irsOwner: registry.irsOwner.toBase58(),
      registryOwnersAligned: registry.irpOwner.equals(registry.irsOwner),
      requiredTopics,
      selectedTopic: topicStr,
    } as Record<string, unknown>;

    const topicRequired = requiredTopics.includes(topicStr);
    console.info("[KYC TOKEN-SCOPED CLAIM DEBUG] base", debugBase);

    if (!topicRequired) {
      console.info("[KYC TOKEN-SCOPED CLAIM DEBUG] decision: topic not required", { ...debugBase, topicRequired });
      return {
        ok: false,
        reason: `This token does not require claim topic ${topicStr}.`,
        tokenMint: mint,
        ctrState,
        tirState,
        requiredTopics,
        topicRequired,
        investorHasActiveClaim: false,
        providerTrustedForToken: false,
      };
    }

    // Derive target and issuer FID PDAs (claim owner accounts)
    const [targetFid] = PublicKey.findProgramAddressSync([Buffer.from("fid"), investorWallet.toBuffer()], ids.fid);
    const [issuerFid] = PublicKey.findProgramAddressSync([Buffer.from("fid"), providerWallet.toBuffer()], ids.fid);

    // Derive claim_topic_index PDA for this target/issuer/topic
    const topicBytes = this.u64LeBytes(topic);
    const [claimTopicIndex] = PublicKey.findProgramAddressSync(
      [Buffer.from("claim_topic_index"), targetFid.toBuffer(), issuerFid.toBuffer(), topicBytes],
      ids.fid,
    );

    let investorHasActiveClaim = false;
    let claimRevoked = undefined;
    let claimExpired = undefined;
    let providerSignerValid = undefined;
    let claimSignerKey: PublicKey | null = null;
    let checkedClaimPubkey: PublicKey | null = null;

    try {
      const idxInfo = await this.provider.connection.getAccountInfo(claimTopicIndex, "confirmed");
      if (idxInfo && idxInfo.data.length > 116 && idxInfo.data.readUInt8(116) === 1) {
        investorHasActiveClaim = true;
        // extract active_claim pubkey and id
        const activeClaimPubkey = new PublicKey(idxInfo.data.subarray(80, 112));
        const activeClaimId = idxInfo.data.readUInt32LE(112);
        checkedClaimPubkey = activeClaimPubkey;

        // fetch claim account and parse
        const claimInfo = await this.provider.connection.getAccountInfo(activeClaimPubkey, "confirmed");
        if (claimInfo) {
          const parsed = parseClaimAccount(claimInfo.data);
          if (parsed) {
            claimSignerKey = parsed.signerKey;
            claimRevoked = parsed.revoked;
            const now = BigInt(Math.floor(Date.now() / 1000));
            claimExpired = parsed.expiresAt !== 0n && parsed.expiresAt < now;
            const issuerFidInfo = await this.provider.connection.getAccountInfo(
              issuerFid,
              "confirmed",
            );
            providerSignerValid = issuerFidInfo
              ? parsed.issuerFid.equals(issuerFid) &&
                parseFidIsIssuerAndSigner(issuerFidInfo.data, parsed.signerKey)
              : false;
          }
        }
      }
    } catch (err) {
      // swallow — we'll treat as missing claim
    }

    // Check provider trust in token's TIR
    const [issuerEntry] = PublicKey.findProgramAddressSync(
      [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
      ids.tir,
    );
    let providerTrustedForToken = false;
    try {
      const entryInfo = await this.provider.connection.getAccountInfo(issuerEntry, "confirmed");
      if (entryInfo) {
        providerTrustedForToken = parseIssuerEntryForTopic(entryInfo.data, topic);
      }
    } catch {
      providerTrustedForToken = false;
    }

    const finalDecision =
      investorHasActiveClaim &&
      !claimRevoked &&
      !claimExpired &&
      providerSignerValid !== false &&
      providerTrustedForToken;

    console.info("[KYC TOKEN-SCOPED CLAIM DEBUG] result", {
      ...debugBase,
      topicRequired,
      claimFound: investorHasActiveClaim,
      claimRevoked,
      claimExpired,
      providerSignerValid,
      claimSignerKey: claimSignerKey?.toBase58() ?? null,
      providerTrustedForToken,
      finalDecision,
      checkedClaimPubkey: checkedClaimPubkey?.toBase58() ?? null,
    });

    if (!finalDecision) {
      let reason = `Request cannot be forwarded until token-specific KYC requirements are satisfied.`;
      if (!investorHasActiveClaim) reason = `Investor is missing required claim topic ${topicStr} for this token.`;
      else if (claimRevoked) reason = `Investor claim topic ${topicStr} is revoked.`;
      else if (claimExpired) reason = `Investor claim topic ${topicStr} is expired.`;
      else if (providerSignerValid === false) reason = `Existing investor claim topic ${topicStr} was signed by an old issuer FID signer key. Revoke and reissue this claim.`;
      else if (!providerTrustedForToken) reason = `This KYC provider is not trusted in this token's TIR for topic ${topicStr}.`;

      return {
        ok: false,
        reason,
        tokenMint: mint,
        ctrState,
        tirState,
        requiredTopics,
        topicRequired,
        investorHasActiveClaim,
        claimRevoked,
        claimExpired,
        providerSignerValid,
        claimSignerKey,
        providerTrustedForToken,
        checkedClaimPubkey,
      };
    }

    return {
      ok: true,
      tokenMint: mint,
      ctrState,
      tirState,
      requiredTopics,
      topicRequired,
      investorHasActiveClaim,
      providerSignerValid,
      claimSignerKey,
      providerTrustedForToken,
      checkedClaimPubkey,
    };
  }

  /**
   * Burns tokens from a wallet's token account.
   */
  async burn(
    mintPubkey: PublicKey,
    from: PublicKey,
    amount: bigint
  ): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, authority);

    const ts = await this.fetchTokenState(mintPubkey);

    const { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID: SPL_T22 } = await import(
      "@solana/spl-token"
    );
    const sourceTokenAccount = getAssociatedTokenAddressSync(
      mintPubkey,
      from,
      false,
      SPL_T22
    );

    // Get current balance for from_balance_after
    let fromBalanceBefore = BigInt(0);
    try {
      const acct = await this.provider.connection.getTokenAccountBalance(
        sourceTokenAccount,
        "confirmed"
      );
      fromBalanceBefore = BigInt(acct.value.amount);
    } catch {
      // fallback
    }
    const fromBalanceAfter = fromBalanceBefore - amount;

    // Derive IRS state and wallet_identity PDA for the sender
    const irpStatePubkey = new PublicKey(ts.identityRegistry);
    const [irsState] = await this._deriveIrsStateFromIrp(irpStatePubkey);
    const [fromWalletIdentityPda] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), from.toBuffer()],
      IRS_PROGRAM_ID
    );

    try {
      const sig = await this.program.methods
        .burn(from, new BN(amount.toString()), new BN(fromBalanceAfter.toString()))
        .accounts({
          authority,
          tokenState,
          ownerState,
          agentRole,
          complianceState: new PublicKey(ts.compliance),
          complianceProgram: COMPLIANCE_PROGRAM_ID,
          irsState,
          fromWalletIdentity: fromWalletIdentityPda,
          tokenMintAccount: mintPubkey,
          sourceTokenAccount,
          tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Freezes a wallet for this token.
   */
  async freeze(mintPubkey: PublicKey, wallet: PublicKey): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, authority);
    const [frozenWallet] = this.findFrozenWalletPda(mintPubkey, wallet);

    try {
      const sig = await this.program.methods
        .freezeWallet()
        .accounts({
          authority,
          tokenState,
          ownerState,
          agentRole,
          wallet,
          frozenWallet,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Unfreezes a previously frozen wallet.
   */
  async unfreeze(mintPubkey: PublicKey, wallet: PublicKey): Promise<string> {
    const authority = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, authority);
    const [frozenWallet] = this.findFrozenWalletPda(mintPubkey, wallet);

    try {
      const sig = await this.program.methods
        .unfreezeWallet()
        .accounts({
          authority,
          tokenState,
          ownerState,
          agentRole,
          frozenWallet,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Pauses all transfers for this token. Owner-gated.
   */
  async pause(mintPubkey: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);

    try {
      const sig = await this.program.methods
        .pause()
        .accounts({
          owner,
          tokenState,
          ownerState,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Unpauses transfers for this token. Owner-gated.
   */
  async unpause(mintPubkey: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);

    try {
      const sig = await this.program.methods
        .unpause()
        .accounts({
          owner,
          tokenState,
          ownerState,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Grants agent role to a wallet. Owner-gated.
   */
  async addAgent(mintPubkey: PublicKey, agent: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, agent);

    try {
      const sig = await this.program.methods
        .addAgent(agent)
        .accounts({
          owner,
          tokenState,
          ownerState,
          agentRole,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Revokes agent role from a wallet. Owner-gated.
   */
  async removeAgent(mintPubkey: PublicKey, agent: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, agent);

    try {
      const sig = await this.program.methods
        .removeAgent()
        .accounts({
          owner,
          tokenState,
          ownerState,
          agentRole,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  /**
   * Reads the IRP state account to extract the IRS state PDA address.
   * The current deployment flow seeds IRS with the token mint as authority_seed.
   */
  private async _deriveIrsStateFromIrp(
    irpStatePubkey: PublicKey
  ): Promise<[PublicKey, number]> {
    // Fetch the IRP state to get the irs_account field
    try {
      const irpRaw = await this.provider.connection.getAccountInfo(
        irpStatePubkey,
        "confirmed"
      );
      if (irpRaw) {
        // The irs_account is at byte offset: disc(8) + token_mint(32) + owner(32) = 72
        const irsAccountBytes = irpRaw.data.slice(72, 104);
        return [new PublicKey(irsAccountBytes), 0];
      }
    } catch {
      // Surface the failure instead of guessing an IRS PDA from the wrong seed namespace.
    }
    throw new Error("Unable to resolve IRS state from the IRP account.");
  }
}
