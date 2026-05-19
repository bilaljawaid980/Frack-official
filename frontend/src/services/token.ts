// ─── Token Service ────────────────────────────────────────────────────────────
//
// Wraps the fracks_token Anchor program for all token state reads and
// agent-gated write operations (mint, burn, freeze, pause, agents).
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, Idl, Program, BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  COMPLIANCE_PROGRAM_ID,
  FID_PROGRAM_ID,
  IRS_PROGRAM_ID,
  TIR_PROGRAM_ID,
  CTR_PROGRAM_ID,
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
import { IdentityService } from "@/services/identity";
import type { TokenMintHealth, TokenState, OwnerState } from "@/types";
import TokenIdl from "@/lib/solana/idl/fracks_token.json";
import FidIdl from "@/lib/solana/idl/fracks_fid.json";
import ComplianceIdl from "@/lib/solana/idl/fracks_compliance.json";
import ModDailyLimitIdl from "@/idl/mod_daily_limit.json";

type TokenProgram = Program<Idl>;
type RemainingAccount = { pubkey: PublicKey; isSigner: boolean; isWritable: boolean };

const CLAIM_ACCOUNT_DISCRIMINATOR = Buffer.from([113, 109, 47, 96, 242, 219, 61, 165]);
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

// ─── TokenService ─────────────────────────────────────────────────────────────

export class TokenService {
  private program: TokenProgram;
  private provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(TokenIdl as unknown as Idl, provider);
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /** Seeds: ["token_state", mint] */
  findTokenStatePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_TOKEN_STATE, mint.toBuffer()],
      TOKEN_PROGRAM_ID
    );
  }

  /** Seeds: ["owner", mint] */
  findOwnerStatePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_OWNER, mint.toBuffer()],
      TOKEN_PROGRAM_ID
    );
  }

  /** Seeds: ["agent", mint, agent] */
  findAgentRolePda(mint: PublicKey, agent: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_AGENT, mint.toBuffer(), agent.toBuffer()],
      TOKEN_PROGRAM_ID
    );
  }

  /**
   * Seeds: ["frozen", mint, wallet]
   * Note: The on-chain IDL seed is "frozen" (6 bytes), matching the bytes
   * [102, 114, 111, 122, 101, 110] in fracks_token.json.
   */
  findFrozenWalletPda(mint: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("frozen"), mint.toBuffer(), wallet.toBuffer()],
      TOKEN_PROGRAM_ID
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  async fetchTokenState(mint: PublicKey): Promise<TokenState> {
    const [tokenStatePda] = this.findTokenStatePda(mint);
    const raw = await (this.program.account as any).tokenState.fetch(tokenStatePda);
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
    const [ownerStatePda] = this.findOwnerStatePda(mint);
    const raw = await (this.program.account as any).ownerState.fetch(ownerStatePda);
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
    const authority = this.provider.wallet.publicKey;
    const [tokenState] = this.findTokenStatePda(mintPubkey);
    const [ownerState] = this.findOwnerStatePda(mintPubkey);
    const [agentRole] = this.findAgentRolePda(mintPubkey, authority);

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
    const [toFrozen] = this.findFrozenWalletPda(mintPubkey, recipient);

    // Fetch current balance for to_balance_after calculation
    const toBalanceBefore = destinationAccount.amount;
    const toBalanceAfter = toBalanceBefore + amount;

    // Derive IRP/IRS/TIR/CTR state addresses from the identity registry
    const irpStatePubkey = new PublicKey(ts.identityRegistry);
    const [irsState] = await this._deriveIrsStateFromIrp(irpStatePubkey);
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), mintPubkey.toBuffer()],
      TIR_PROGRAM_ID
    );
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), mintPubkey.toBuffer()],
      CTR_PROGRAM_ID
    );

    // Derive wallet_identity PDA for recipient
    const [walletIdentity] = PublicKey.findProgramAddressSync(
      [SEED_WALLET_IDENTITY, irsState.toBuffer(), recipient.toBuffer()],
      IRS_PROGRAM_ID
    );
    const identityService = new IdentityService(this.provider);
    let recipientIdentity = await identityService.fetchWalletIdentity(
      mintPubkey,
      recipient,
    );
    if (!recipientIdentity) {
      const recipientFid = await identityService.fetchFid(recipient);
      if (!recipientFid) {
        throw new Error("Investor must register FID before tokens can be minted.");
      }
      const [recipientFidPda] = identityService.findFidPda(recipient);
      await identityService.registerIdentity(
        mintPubkey,
        recipient,
        recipientFidPda,
        recipientFid.country,
      );
      recipientIdentity = await identityService.fetchWalletIdentity(
        mintPubkey,
        recipient,
      );
    }
    if (!recipientIdentity?.isActive) {
      await identityService.setIdentityActivation(mintPubkey, recipient, true);
    }

    const verificationAndComplianceAccounts =
      await this.getMintRemainingAccounts(recipient, mintPubkey, tirState, walletIdentity);
    await this.prepareDailyLimitUsageAccounts(mintPubkey, recipient);

    try {
      const sig = await this.program.methods
        .mint(recipient, new BN(amount.toString()), new BN(toBalanceAfter.toString()))
        .accounts({
          authority,
          tokenState,
          ownerState,
          agentRole,
          irpState: irpStatePubkey,
          irsState,
          tirState,
          ctrState,
          complianceState: new PublicKey(ts.compliance),
          complianceProgram: COMPLIANCE_PROGRAM_ID,
          walletIdentity,
          toFrozen,
          tokenMintAccount: mintPubkey,
          destinationTokenAccount,
          tokenProgram: new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"),
        })
        .remainingAccounts(verificationAndComplianceAccounts)
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  private async getMintRemainingAccounts(
    recipient: PublicKey,
    mintPubkey: PublicKey,
    tirState: PublicKey,
    walletIdentity: PublicKey
  ): Promise<RemainingAccount[]> {
    const accounts: RemainingAccount[] = [];
    const seen = new Set<string>();
    const push = (pubkey: PublicKey, isWritable = false) => {
      const key = pubkey.toBase58();
      if (seen.has(key)) return;
      seen.add(key);
      accounts.push({ pubkey, isSigner: false, isWritable });
    };

    const fidProgram = new Program(FidIdl as unknown as Idl, this.provider);
    const [targetFid] = PublicKey.findProgramAddressSync(
      [Buffer.from("fid"), recipient.toBuffer()],
      FID_PROGRAM_ID
    );

    const claimAccounts = await this.provider.connection.getProgramAccounts(FID_PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        {
          memcmp: {
            offset: 0,
            bytes: CLAIM_ACCOUNT_DISCRIMINATOR.toString("base64"),
            encoding: "base64",
          },
        },
        { memcmp: { offset: 8, bytes: targetFid.toBase58() } },
      ],
    });

    for (const { pubkey, account } of claimAccounts) {
      try {
        const claim = fidProgram.coder.accounts.decode("claimAccount", account.data);
        const issuerFid = claim.issuerFid as PublicKey;
        const [issuerEntry] = PublicKey.findProgramAddressSync(
          [Buffer.from("issuer_entry"), tirState.toBuffer(), issuerFid.toBuffer()],
          TIR_PROGRAM_ID
        );
        push(pubkey);
        push(issuerEntry);
        push(issuerFid);
      } catch {
        // Ignore malformed/unexpected accounts.
      }
    }

    try {
      const [complianceStatePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("compliance_state"), mintPubkey.toBuffer()],
        COMPLIANCE_PROGRAM_ID
      );
      const complianceProgram = new Program(ComplianceIdl as unknown as Idl, this.provider);
      const compliance = await (complianceProgram.account as any).complianceState.fetch(
        complianceStatePda
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
    wallet: PublicKey
  ): Promise<void> {
    const [complianceStatePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("compliance_state"), mintPubkey.toBuffer()],
      COMPLIANCE_PROGRAM_ID
    );
    const complianceProgram = new Program(ComplianceIdl as unknown as Idl, this.provider);
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
