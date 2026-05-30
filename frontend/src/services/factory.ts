// ─── Factory Service ──────────────────────────────────────────────────────────
//
// Wraps the fracks_factory Anchor program for deploying token suites and
// reading factory/deployment state.
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, Idl, Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Keypair,
  Transaction,
  TransactionInstruction,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022,
  ExtensionType,
  getMintLen,
  createInitializeMetadataPointerInstruction,
  createInitializeTransferHookInstruction,
  createInitializePermanentDelegateInstruction,
  createInitializeMintInstruction,
} from "@solana/spl-token";
import {
  FACTORY_PROGRAM_ID,
  TOKEN_HOOK_PROGRAM_ID,
  MOD_MAX_INVESTORS,
  MOD_COUNTRY_RESTRICT,
  MOD_MAX_BALANCE,
  MOD_MAX_TRANSFER,
  MOD_LOCKUP,
  MOD_DAILY_LIMIT,
  MOD_SUPPLY_CAP,
  MOD_COUNTRY_CAP,
  SEED_FACTORY_STATE,
  SEED_DEPLOYMENT,
} from "@/lib/constants";
import { ROLE_WALLETS } from "@/lib/zigchain-config";
import { formatTransactionError, parseAnchorError } from "@/lib/errors";
import { fetchFactoryStateAccount } from "@/lib/solana";
import type {
  FactoryState,
  TokenDeployment,
  DeployTokenSuiteArgs,
} from "@/types";
import FactoryIdl from "@/idl/fracks_factory.json";
import IrpIdl from "@/idl/fracks_irp.json";
import IrsIdl from "@/idl/fracks_irs.json";
import ModCountryCapIdl from "@/idl/mod_country_cap.json";
import ModCountryRestrictIdl from "@/idl/mod_country_restrict.json";
import ModDailyLimitIdl from "@/idl/mod_daily_limit.json";
import ModLockupIdl from "@/idl/mod_lockup.json";
import ModMaxBalanceIdl from "@/idl/mod_max_balance.json";
import ModMaxInvestorsIdl from "@/idl/mod_max_investors.json";
import ModMaxTransferIdl from "@/idl/mod_max_transfer.json";
import ModSupplyCapIdl from "@/idl/mod_supply_cap.json";

// IDL type alias
type FactoryProgram = Program<Idl>;
type WalletSendOptions = {
  skipPreflight?: boolean;
  preflightCommitment?: "processed" | "confirmed" | "finalized";
  maxRetries?: number;
};
type SendWalletTransaction = (
  transaction: Transaction | VersionedTransaction,
  connection: AnchorProvider["connection"],
  options?: WalletSendOptions,
) => Promise<string>;
type TransactionSigner = Keypair;
type InstructionBuilder = {
  accounts(accounts: Record<string, unknown>): {
    instruction(): Promise<TransactionInstruction>;
    remainingAccounts?(
      accounts: Array<{
        pubkey: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }>,
    ): { instruction(): Promise<TransactionInstruction> };
  };
};
type FactoryDeployBuilder = {
  accounts(accounts: Record<string, unknown>): {
    remainingAccounts(
      accounts: Array<{
        pubkey: PublicKey;
        isSigner: boolean;
        isWritable: boolean;
      }>,
    ): { instruction(): Promise<TransactionInstruction> };
  };
};
type FactoryProgramMethods = {
  deployTokenSuite(args: unknown): FactoryDeployBuilder;
  initializeModule(...args: unknown[]): InstructionBuilder;
  setHookAuthority(...args: unknown[]): InstructionBuilder;
};



// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Discriminator bytes for the TokenDeployment account (from IDL). */
const DEPLOYMENT_DISCRIMINATOR = Buffer.from([
  253, 218, 24, 4, 169, 51, 36, 214,
]);

/**
 * Maps each compliance module program ID to the PDA seed used by that module.
 * The seed is combined with the token mint to derive the module state PDA.
 * Note: country_restrict uses "mod_country" (not "mod_country_restrict").
 */
const MODULE_STATE_SEEDS: Record<string, string> = {
  [MOD_MAX_INVESTORS.toBase58()]: "mod_max_investors",
  [MOD_COUNTRY_RESTRICT.toBase58()]: "mod_country",
  [MOD_MAX_BALANCE.toBase58()]: "mod_max_balance",
  [MOD_MAX_TRANSFER.toBase58()]: "mod_max_transfer",
  [MOD_LOCKUP.toBase58()]: "mod_lockup",
  [MOD_DAILY_LIMIT.toBase58()]: "mod_daily_limit",
  [MOD_SUPPLY_CAP.toBase58()]: "mod_supply_cap",
  [MOD_COUNTRY_CAP.toBase58()]: "mod_country_cap",
};

const PERMISSIVE_U64_LIMIT = new BN("18446744073709551615");
const NO_LOCKUP = new BN(0);
const HOOK_BASE_EXTRA_METAS = 5;
const HOOK_MAX_MODULE_EXTRA_METAS = 4;
const HOOK_EXTRA_ACCOUNT_META_SIZE = 35;
const HOOK_EXTRA_ACCOUNT_METAS_SPACE =
  12 + 4 + HOOK_EXTRA_ACCOUNT_META_SIZE * (HOOK_BASE_EXTRA_METAS + 15 * HOOK_MAX_MODULE_EXTRA_METAS);
const TOKEN_METADATA_FIXED_BYTES = 32 + 32 + 4 + 4 + 4 + 4;
const TOKEN_METADATA_MAX_NAME_LEN = 64;
const TOKEN_METADATA_MAX_SYMBOL_LEN = 12;
const TOKEN_METADATA_MAX_URI_LEN = 24;

type SimulatedAccountSnapshot = {
  pubkey: string;
  lamports: number;
  owner: string;
  executable: boolean;
  dataLength: number;
  rentExemptLamports: number;
  rentExemptSatisfied: boolean;
} | null;

function estimateTokenMetadataLength(input: {
  name: string;
  symbol: string;
  uri: string;
}): number {
  return (
    TOKEN_METADATA_FIXED_BYTES +
    Buffer.byteLength(input.name, "utf8") +
    Buffer.byteLength(input.symbol, "utf8") +
    Buffer.byteLength(input.uri, "utf8")
  );
}

function estimateMaxSupportedTokenMetadataLength(): number {
  return estimateTokenMetadataLength({
    name: "N".repeat(TOKEN_METADATA_MAX_NAME_LEN),
    symbol: "S".repeat(TOKEN_METADATA_MAX_SYMBOL_LEN),
    uri: "U".repeat(TOKEN_METADATA_MAX_URI_LEN),
  });
}

// ─── FactoryService ───────────────────────────────────────────────────────────

export class FactoryService {
  private program: FactoryProgram;
  private provider: AnchorProvider;

  constructor(
    provider: AnchorProvider,
    _sendWalletTransaction?: SendWalletTransaction,
  ) {
    void _sendWalletTransaction;
    this.provider = provider;
    this.program = new Program(FactoryIdl as unknown as Idl, provider);
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /**
   * Derives the FactoryState PDA.
   * Seeds: ["factory_state"]
   */
  getFactoryStatePda(): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_FACTORY_STATE],
      FACTORY_PROGRAM_ID,
    );
  }

  /**
   * Derives the TokenDeployment PDA for a specific issuer + salt combo.
   * Seeds: ["deployment", issuer, salt]
   */
  getDeploymentPda(issuer: PublicKey, salt: Uint8Array): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_DEPLOYMENT, issuer.toBuffer(), Buffer.from(salt)],
      FACTORY_PROGRAM_ID,
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  /**
   * Fetches and returns the factory state account.
   */
  async fetchFactoryState(): Promise<FactoryState> {
    const raw = await fetchFactoryStateAccount();
    if (!raw) {
      throw new Error("Factory state account not found for the configured factory program.");
    }
    return {
      owner: raw.owner.toBase58(),
      tokenProgramId: raw.tokenProgramId.toBase58(),
      fidProgramId: raw.fidProgramId.toBase58(),
      irpProgramId: raw.irpProgramId.toBase58(),
      irsProgramId: raw.irsProgramId.toBase58(),
      tirProgramId: raw.tirProgramId.toBase58(),
      ctrProgramId: raw.ctrProgramId.toBase58(),
      complianceProgramId: raw.complianceProgramId.toBase58(),
      deploymentCount: raw.deploymentCount,
      bump: raw.bump,
    };
  }

  /**
   * Fetches the TokenDeployment account for a given issuer and salt.
   */
  async fetchDeployment(
    issuer: PublicKey,
    salt: Uint8Array,
  ): Promise<TokenDeployment> {
    const [deploymentPda] = this.getDeploymentPda(issuer, salt);
    const accounts = this.program.account as unknown as {
      tokenDeployment: { fetch(address: PublicKey): Promise<unknown> };
    };
    const raw = await accounts.tokenDeployment.fetch(deploymentPda);
    return this._mapDeployment(raw, deploymentPda);
  }

  /**
   * Fetches all TokenDeployment accounts owned by this program using a
   * discriminator memcmp filter to avoid fetching unrelated accounts.
   */
  async fetchAllDeployments(): Promise<TokenDeployment[]> {
    const accounts = await this.provider.connection.getProgramAccounts(
      FACTORY_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          {
            memcmp: {
              offset: 0,
              bytes: DEPLOYMENT_DISCRIMINATOR.toString("base64"),
              encoding: "base64",
            },
          },
        ],
      },
    );

    const deployments: TokenDeployment[] = [];
    for (const { account } of accounts) {
      try {
        const decoded = this.program.coder.accounts.decode(
          "TokenDeployment",
          account.data,
        );
        deployments.push(this._mapDeployment(decoded));
      } catch {
        // Skip accounts that fail to decode
      }
    }
    return deployments;
  }

  // ── Write Methods ─────────────────────────────────────────────────────────────

  /**
   * Deploys a full token suite via the factory's deploy_token_suite instruction.
   * Handles building all required PDAs and remaining accounts.
   *
   * @returns Transaction signature
   */
  /**
   * Generates a new random keypair for a token mint.
   * Call this before deployTokenSuite to get the pubkey for the review screen.
   */
  static generateMintKeypair(): Keypair {
    return Keypair.generate();
  }

  /**
   * Derives the compliance module state PDA for a given module program ID and mint.
   * Throws if the program ID is not a known compliance module.
   */
  private getModuleStatePda(
    moduleProgramId: PublicKey,
    tokenMint: PublicKey,
  ): PublicKey {
    const seed = MODULE_STATE_SEEDS[moduleProgramId.toBase58()];
    if (!seed) {
      throw new Error(
        `Unknown compliance module program: ${moduleProgramId.toBase58()}`,
      );
    }
    return PublicKey.findProgramAddressSync(
      [Buffer.from(seed), tokenMint.toBuffer()],
      moduleProgramId,
    )[0];
  }

  private getModuleProgram(moduleProgramId: PublicKey): Program<Idl> {
    const idlByProgramId: Record<string, Idl> = {
      [MOD_MAX_INVESTORS.toBase58()]: ModMaxInvestorsIdl as unknown as Idl,
      [MOD_COUNTRY_RESTRICT.toBase58()]: ModCountryRestrictIdl as unknown as Idl,
      [MOD_MAX_BALANCE.toBase58()]: ModMaxBalanceIdl as unknown as Idl,
      [MOD_MAX_TRANSFER.toBase58()]: ModMaxTransferIdl as unknown as Idl,
      [MOD_LOCKUP.toBase58()]: ModLockupIdl as unknown as Idl,
      [MOD_DAILY_LIMIT.toBase58()]: ModDailyLimitIdl as unknown as Idl,
      [MOD_SUPPLY_CAP.toBase58()]: ModSupplyCapIdl as unknown as Idl,
      [MOD_COUNTRY_CAP.toBase58()]: ModCountryCapIdl as unknown as Idl,
    };
    const idl = idlByProgramId[moduleProgramId.toBase58()];
    if (!idl) {
      throw new Error(`Unknown compliance module program: ${moduleProgramId.toBase58()}`);
    }
    return new Program(
      { ...(idl as unknown as Record<string, unknown>), address: moduleProgramId.toBase58() } as Idl,
      this.provider,
    );
  }

  private moduleUsesHookAuthority(moduleProgramId: PublicKey): boolean {
    return (
      moduleProgramId.equals(MOD_MAX_INVESTORS) ||
      moduleProgramId.equals(MOD_DAILY_LIMIT) ||
      moduleProgramId.equals(MOD_SUPPLY_CAP) ||
      moduleProgramId.equals(MOD_COUNTRY_CAP)
    );
  }

  private async initializeComplianceModule(
    moduleProgramId: PublicKey,
    tokenMint: PublicKey,
    moduleState: PublicKey,
    params: Record<string, unknown> = {},
    decimals = 0,
  ): Promise<TransactionInstruction> {
    const admin = this.provider.wallet.publicKey;
    const program = this.getModuleProgram(moduleProgramId);
    const accounts = {
      owner: admin,
      moduleState,
      systemProgram: SystemProgram.programId,
    };

    if (moduleProgramId.equals(MOD_COUNTRY_RESTRICT)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.parseCountryList(params.blocked_countries))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_LOCKUP)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toBn(params.lockup_end, NO_LOCKUP))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_COUNTRY_CAP)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.parseCountryCaps(params.country_caps))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_DAILY_LIMIT)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toTokenAmountBn(params.daily_limit, decimals, PERMISSIVE_U64_LIMIT))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_MAX_BALANCE)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toTokenAmountBn(params.max_balance, decimals, PERMISSIVE_U64_LIMIT))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_MAX_TRANSFER)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toTokenAmountBn(params.max_amount, decimals, PERMISSIVE_U64_LIMIT))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_SUPPLY_CAP)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toTokenAmountBn(params.max_supply, decimals, PERMISSIVE_U64_LIMIT))
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_MAX_INVESTORS)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, this.toBn(params.max_investors, PERMISSIVE_U64_LIMIT))
        .accounts(accounts)
        .instruction();
    }

    return (program.methods as unknown as FactoryProgramMethods)
      .initializeModule(tokenMint, PERMISSIVE_U64_LIMIT)
      .accounts(accounts)
      .instruction();
  }

  private async setModuleHookAuthority(
    moduleProgramId: PublicKey,
    moduleState: PublicKey,
    hookAuthority: PublicKey,
  ): Promise<TransactionInstruction | null> {
    if (!this.moduleUsesHookAuthority(moduleProgramId)) {
      return null;
    }

    const admin = this.provider.wallet.publicKey;
    const program = this.getModuleProgram(moduleProgramId);
    return (program.methods as unknown as FactoryProgramMethods)
      .setHookAuthority(hookAuthority)
      .accounts({
        owner: admin,
        moduleState,
      })
      .instruction();
  }

  private async buildComplianceModuleInitializationTransactions(
    moduleProgramIds: string[],
    tokenMint: PublicKey,
    complianceState: PublicKey,
    moduleParams: Record<string, Record<string, unknown>> = {},
    decimals = 0,
  ): Promise<Array<{ transaction: Transaction }>> {
    const instructions: TransactionInstruction[] = [];

    for (const moduleProgramIdStr of moduleProgramIds) {
      const moduleProgramId = new PublicKey(moduleProgramIdStr);
      const moduleState = this.getModuleStatePda(moduleProgramId, tokenMint);
      const existingModule = await this.provider.connection.getAccountInfo(
        moduleState,
        "confirmed",
      );

      if (!existingModule) {
        instructions.push(
          await this.initializeComplianceModule(
            moduleProgramId,
            tokenMint,
            moduleState,
            moduleParams[moduleProgramId.toBase58()] ?? {},
            decimals,
          ),
        );
      }

      // Stateful modules must accept CPI mutations from the compliance PDA after binding.
      const hookAuthorityIx = await this.setModuleHookAuthority(
        moduleProgramId,
        moduleState,
        complianceState,
      );
      if (hookAuthorityIx) {
        instructions.push(hookAuthorityIx);
      }
    }

    const transactions: Array<{ transaction: Transaction }> = [];
    let currentBatch: TransactionInstruction[] = [];

    for (const instruction of instructions) {
      const candidate = [...currentBatch, instruction];
      if (candidate.length > 1 && !this.transactionFitsLegacyLimit(candidate)) {
        transactions.push({
          transaction: new Transaction().add(...currentBatch),
        });
        currentBatch = [instruction];
      } else {
        currentBatch = candidate;
      }
    }

    if (currentBatch.length > 0) {
      transactions.push({
        transaction: new Transaction().add(...currentBatch),
      });
    }

    return transactions;
  }

  /**
   * Full two-step deployment targeting the devnet-deployed factory:
   * 1. Create the SPL Token-2022 mint directly via spl-token instructions
   * 2. deploy_token_suite — initialises all FRACKS state accounts
   *
   * The deployed factory on devnet does not have a create_token_mint instruction,
   * so step 1 uses raw SPL Token-2022 instructions instead.
   *
   * @param args        Deployment arguments (tokenMint must match mintKeypair.publicKey)
   * @param mintKeypair The signer keypair for the new mint (required for step 1)
   */
  async deployTokenSuite(
    args: DeployTokenSuiteArgs,
    mintKeypair?: Keypair,
  ): Promise<string> {
    const admin = this.provider.wallet.publicKey;
    if (args.sharedIrs) {
      throw new Error(
        "Shared IRS deployment is disabled in the direct admin-to-issuer flow",
      );
    }
    const issuer = new PublicKey(args.issuer);
    const tokenMint = new PublicKey(args.tokenMint);

    // ── Derive PDAs ────────────────────────────────────────────────────────────
    const [factoryState] = this.getFactoryStatePda();

    const factory = await this.fetchFactoryState();
    const tokenProgramId = new PublicKey(factory.tokenProgramId);
    const irpProgramId = new PublicKey(factory.irpProgramId);
    const irsProgramId = new PublicKey(factory.irsProgramId);
    const tirProgramId = new PublicKey(factory.tirProgramId);
    const ctrProgramId = new PublicKey(factory.ctrProgramId);
    const complianceProgramId = new PublicKey(factory.complianceProgramId);
    const hookProgramId = TOKEN_HOOK_PROGRAM_ID;
    const isEnvAdmin =
      !!ROLE_WALLETS.platformOwner &&
      admin.toBase58().toLowerCase() ===
        ROLE_WALLETS.platformOwner.toLowerCase();

    if (factory.owner !== admin.toBase58() && !isEnvAdmin) {
      throw new Error(
        `Only the platform admin can deploy token suites. Connected wallet ${admin.toBase58()} is not the factory owner ${factory.owner}. Connect the platform admin wallet, then enter the issuer wallet as the final token-suite owner.`,
      );
    }

    const [deploymentPda] = this.getDeploymentPda(issuer, args.salt);

    const [tokenState] = PublicKey.findProgramAddressSync(
      [Buffer.from("token_state"), tokenMint.toBuffer()],
      tokenProgramId,
    );
    const [ownerState] = PublicKey.findProgramAddressSync(
      [Buffer.from("owner"), tokenMint.toBuffer()],
      tokenProgramId,
    );
    const [irpState] = PublicKey.findProgramAddressSync(
      [Buffer.from("irp_state"), tokenMint.toBuffer()],
      irpProgramId,
    );
    const [irsState] = PublicKey.findProgramAddressSync(
      [Buffer.from("irs_state"), tokenMint.toBuffer()],
      irsProgramId,
    );
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), tokenMint.toBuffer()],
      tirProgramId,
    );
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), tokenMint.toBuffer()],
      ctrProgramId,
    );
    const [complianceState] = PublicKey.findProgramAddressSync(
      [Buffer.from("compliance_state"), tokenMint.toBuffer()],
      complianceProgramId,
    );
    const [extraAccountMetas] = PublicKey.findProgramAddressSync(
      [Buffer.from("extra-account-metas"), tokenMint.toBuffer()],
      hookProgramId,
    );

    // ── Compliance module state PDAs (derived from program IDs + mint) ─────────
    const moduleProgramIds = args.complianceModules.map(
      (programIdStr) => new PublicKey(programIdStr),
    );
    const moduleStatePdas = moduleProgramIds.map((programId) =>
      this.getModuleStatePda(programId, tokenMint),
    );

    // ── issuerEntry PDAs for each trusted issuer (remaining accounts) ──────────
    // Seeds: ["issuer_entry", tirState, issuerFid] on TIR_PROGRAM_ID
    const issuerEntryPdas = args.trustedIssuers.map((ti) => {
      const issuerFid = new PublicKey(ti.issuerFid);
      return PublicKey.findProgramAddressSync(
        [
          Buffer.from("issuer_entry"),
          tirState.toBuffer(),
          issuerFid.toBuffer(),
        ],
        tirProgramId,
      )[0];
    });

    // ── Remaining accounts: issuer entries (writable) then module states ───────
    const remainingAccounts = [
      ...issuerEntryPdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
      ...moduleStatePdas.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: false,
      })),
    ];

    // ── Instruction args ───────────────────────────────────────────────────────
    const trustedIssuers = args.trustedIssuers.map((ti) => ({
      issuerFid: new PublicKey(ti.issuerFid),
      topics: ti.topics.map((topic) => new BN(topic.toString())),
      label: ti.label,
    }));

    const ixArgs = {
      issuer,
      tokenMint,
      tokenName: args.tokenName,
      tokenSymbol: args.tokenSymbol,
      decimals: args.decimals,
      isin: args.isin,
      claimTopics: args.claimTopics.map((topic) => new BN(topic.toString())),
      trustedIssuers,
      complianceModules: moduleStatePdas, // deployed factory expects state PDAs, not program IDs
      sharedIrs: args.sharedIrs ? new PublicKey(args.sharedIrs) : null,
      salt: Array.from(args.salt),
    };

    try {
      // ── Step 1: Create and populate the address lookup table ───────────────────
      // The factory deploy touches many PDA accounts. Keep them in the ALT so the
      // second transaction stays below Solana's 1232-byte raw transaction limit.
      const slot = await this.provider.connection.getSlot("confirmed");
      const [createLutIx, lutAddress] =
        AddressLookupTableProgram.createLookupTable({
          authority: admin,
          payer: admin,
          recentSlot: slot - 1,
        });

      const lutAddresses = Array.from(
        new Set([
          FACTORY_PROGRAM_ID.toBase58(),
          factoryState.toBase58(),
          deploymentPda.toBase58(),
          tokenProgramId.toBase58(),
          irpProgramId.toBase58(),
          irsProgramId.toBase58(),
          tirProgramId.toBase58(),
          ctrProgramId.toBase58(),
          complianceProgramId.toBase58(),
          hookProgramId.toBase58(),
          SPL_TOKEN_2022.toBase58(),
          SystemProgram.programId.toBase58(),
          admin.toBase58(),
          issuer.toBase58(),
          tokenMint.toBase58(),
          tokenState.toBase58(),
          ownerState.toBase58(),
          irsState.toBase58(),
          tirState.toBase58(),
          ctrState.toBase58(),
          irpState.toBase58(),
          complianceState.toBase58(),
          extraAccountMetas.toBase58(),
          ...issuerEntryPdas.map((pubkey) => pubkey.toBase58()),
          ...moduleStatePdas.map((pubkey) => pubkey.toBase58()),
        ]),
      ).map((address) => new PublicKey(address));

      const setupTransactions: Array<{
        transaction: Transaction;
        signers?: TransactionSigner[];
      }> = [{ transaction: new Transaction().add(createLutIx) }];

      const lutAddressChunks = this.chunkPublicKeys(lutAddresses, 20);
      for (const addresses of lutAddressChunks) {
        const extendLutIx = AddressLookupTableProgram.extendLookupTable({
          payer: admin,
          authority: admin,
          lookupTable: lutAddress,
          addresses,
        });
        setupTransactions.push({
          transaction: new Transaction().add(extendLutIx),
        });
      }

      // ── Step 2: Create the Token-2022 mint if it does not already exist ─────────
      if (mintKeypair) {
        const tokenMetadataLength = estimateTokenMetadataLength({
          name: args.tokenName,
          symbol: args.tokenSymbol,
          uri: args.isin,
        });
        const reservedTokenMetadataLength = Math.max(
          tokenMetadataLength,
          estimateMaxSupportedTokenMetadataLength(),
        );
        const mintBaseLen = getMintLen([
          ExtensionType.MetadataPointer,
          ExtensionType.TransferHook,
          ExtensionType.PermanentDelegate,
        ]);
        const mintLenWithMetadata = getMintLen([
          ExtensionType.MetadataPointer,
          ExtensionType.TransferHook,
          ExtensionType.PermanentDelegate,
        ], {
          [ExtensionType.TokenMetadata]: reservedTokenMetadataLength,
        });
        const lamports =
          await this.provider.connection.getMinimumBalanceForRentExemption(
            mintLenWithMetadata,
          );
        console.info("[FRACKS Deploy] Token-2022 mint sizing:", {
          tokenMint: tokenMint.toBase58(),
          baseExtensions: [
            "MetadataPointer",
            "TransferHook",
            "PermanentDelegate",
          ],
          tokenMetadataLength,
          reservedTokenMetadataLength,
          mintBaseLen,
          mintLenWithMetadata,
          rentExemptLamports: lamports,
        });
        // Skip mint creation if the account already exists (e.g. from a previous failed attempt)
        const mintAccountInfo = await this.provider.connection.getAccountInfo(
          tokenMint,
          "confirmed",
        );
        if (mintAccountInfo) {
          const ownerMatches = mintAccountInfo.owner.equals(SPL_TOKEN_2022);
          const sizeMatches = mintAccountInfo.data.length >= mintBaseLen;
          const rentMatches = mintAccountInfo.lamports >= lamports;
          if (!ownerMatches || !sizeMatches || !rentMatches) {
            throw new Error(
              `Existing mint ${tokenMint.toBase58()} is incompatible with the current deployment requirements. Required owner=${SPL_TOKEN_2022.toBase58()}, dataLen>=${mintBaseLen}, lamports>=${lamports}. Found owner=${mintAccountInfo.owner.toBase58()}, dataLen=${mintAccountInfo.data.length}, lamports=${mintAccountInfo.lamports}. Generate a fresh mint and retry deployment.`,
            );
          }
        } else {
          const mintTx = new Transaction().add(
            SystemProgram.createAccount({
              fromPubkey: admin,
              newAccountPubkey: tokenMint,
              space: mintBaseLen,
              lamports,
              programId: SPL_TOKEN_2022,
            }),
            createInitializeTransferHookInstruction(
              tokenMint,
              admin,
              hookProgramId,
              SPL_TOKEN_2022,
            ),
            createInitializeMetadataPointerInstruction(
              tokenMint,
              admin,
              tokenMint,
              SPL_TOKEN_2022,
            ),
            createInitializePermanentDelegateInstruction(
              tokenMint,
              tokenState,
              SPL_TOKEN_2022,
            ),
            createInitializeMintInstruction(
              tokenMint,
              args.decimals,
              tokenState,
              null,
              SPL_TOKEN_2022,
            ),
          );
          setupTransactions.push({
            transaction: mintTx,
            signers: [mintKeypair],
          });
        }
      }

      // The currently deployed factory binds module state PDAs, but it does not
      // create them. Initialize them here so newly deployed tokens transfer
      // correctly instead of failing later inside the Token-2022 hook.
      setupTransactions.push(
        ...(await this.buildComplianceModuleInitializationTransactions(
          args.complianceModules,
          tokenMint,
          complianceState,
          args.complianceModuleParams,
          args.decimals,
        )),
      );

      await this.sendTransactionsConfirmedBatch(setupTransactions);

      // Wait for the ALT to be fully active and indexed across RPC nodes
      await new Promise((r) => setTimeout(r, 2000));

      const lutAccountInfo =
        await this.provider.connection.getAddressLookupTable(lutAddress, {
          commitment: "confirmed",
        });
      if (!lutAccountInfo.value) {
        throw new Error("Address Lookup Table not found after creation.");
      }

      // ── Step 3: Build deploy instruction ──────────────────────────────────────
      const extraAccountMetasInfo = await this.provider.connection.getAccountInfo(
        extraAccountMetas,
        "confirmed",
      );
      const expectedHookModuleMetaCount = moduleProgramIds.reduce(
        (sum, programId) => sum + this.getHookModuleExtraMetaCount(programId),
        0,
      );
      const expectedHookTotalMetas =
        HOOK_BASE_EXTRA_METAS + expectedHookModuleMetaCount;
      const extraAccountMetasRentLamports =
        await this.provider.connection.getMinimumBalanceForRentExemption(
          HOOK_EXTRA_ACCOUNT_METAS_SPACE,
          "confirmed",
        );
      console.info("[FRACKS Deploy] --- PDA and Seed Diagnostics ---");
      console.info("[FRACKS Deploy] Factory Program ID:", FACTORY_PROGRAM_ID.toBase58());
      console.info("[FRACKS Deploy] Issuer / Suite Owner:", issuer.toBase58());
      console.info("[FRACKS Deploy] Salt (bytes):", Array.from(args.salt));
      console.info("[FRACKS Deploy] Salt (hex):", Buffer.from(args.salt).toString("hex"));
      console.info("[FRACKS Deploy] Derived Deployment PDA:", deploymentPda.toBase58());
      console.info("[FRACKS Deploy] Expected deployment seeds: [\"deployment\", issuer, salt]");
      console.info("[FRACKS Deploy] Token Mint Account:", tokenMint.toBase58());
      console.info("[FRACKS Deploy] Extra Account Metas:", extraAccountMetas.toBase58());
      console.info("[FRACKS Deploy] Factory State:", factoryState.toBase58());
      console.info("[FRACKS Deploy] Hook extra-account-metas sizing:", {
        extraAccountMetas: extraAccountMetas.toBase58(),
        currentAccountInfo: extraAccountMetasInfo
          ? {
              lamports: extraAccountMetasInfo.lamports,
              dataLength: extraAccountMetasInfo.data.length,
              owner: extraAccountMetasInfo.owner.toBase58(),
              executable: extraAccountMetasInfo.executable,
            }
          : null,
        complianceModulesLength: args.complianceModules.length,
        baseHookMetasCount: HOOK_BASE_EXTRA_METAS,
        expectedModuleExtraMetasCount: expectedHookModuleMetaCount,
        totalMetasCount: expectedHookTotalMetas,
        expectedAccountSize: HOOK_EXTRA_ACCOUNT_METAS_SPACE,
        rentExemptLamports: extraAccountMetasRentLamports,
      });
      console.info("[DEPLOY PROGRAM ACCOUNT DEBUG]", {
        factoryProgram: FACTORY_PROGRAM_ID.toBase58(),
        factoryState: factoryState.toBase58(),
        connectedWallet: admin.toBase58(),
        realIssuer: issuer.toBase58(),
        argsIssuer: args.issuer,
        fracksTokenProgram: tokenProgramId.toBase58(),
        splToken2022Program: TOKEN_2022_PROGRAM_ID.toBase58(),
        hookProgram: hookProgramId.toBase58(),
        irpProgram: irpProgramId.toBase58(),
        irsProgram: irsProgramId.toBase58(),
        tirProgram: tirProgramId.toBase58(),
        ctrProgram: ctrProgramId.toBase58(),
        complianceProgram: complianceProgramId.toBase58(),
        systemProgram: SystemProgram.programId.toBase58(),
        tokenMint: tokenMint.toBase58(),
      });
      const deployIx = await (
        this.program.methods as unknown as FactoryProgramMethods
      )
        .deployTokenSuite(ixArgs)
        .accounts({
          admin,
          factoryState,
          issuer,
          deployment: deploymentPda,

          tokenState,
          ownerState,
          irsState,
          tirState,
          ctrState,
          irpState,
          complianceState,
          tokenMintAccount: tokenMint,
          extraAccountMetas,
          tokenProgram: tokenProgramId,
          token2022Program: TOKEN_2022_PROGRAM_ID,
          hookProgram: hookProgramId,
          irpProgram: irpProgramId,
          irsProgram: irsProgramId,
          tirProgram: tirProgramId,
          ctrProgram: ctrProgramId,
          complianceProgram: complianceProgramId,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts(remainingAccounts)
        .instruction();

      // ── Step 4: Send deployment as versioned (v0) transaction with the ALT ────
      const expectedNamedAccounts = [
        { name: "admin", pubkey: admin, writable: true },
        { name: "factory_state", pubkey: factoryState, writable: true },
        { name: "issuer", pubkey: issuer, writable: false },
        { name: "deployment", pubkey: deploymentPda, writable: true },
        { name: "token_state", pubkey: tokenState, writable: true },
        { name: "owner_state", pubkey: ownerState, writable: true },
        { name: "irs_state", pubkey: irsState, writable: true },
        { name: "tir_state", pubkey: tirState, writable: true },
        { name: "ctr_state", pubkey: ctrState, writable: true },
        { name: "irp_state", pubkey: irpState, writable: true },
        { name: "compliance_state", pubkey: complianceState, writable: true },
        { name: "token_mint_account", pubkey: tokenMint, writable: true },
        { name: "extra_account_metas", pubkey: extraAccountMetas, writable: true },
        { name: "token_program", pubkey: tokenProgramId, writable: false },
        { name: "token_2022_program", pubkey: TOKEN_2022_PROGRAM_ID, writable: false },
        { name: "hook_program", pubkey: hookProgramId, writable: false },
        { name: "irp_program", pubkey: irpProgramId, writable: false },
        { name: "irs_program", pubkey: irsProgramId, writable: false },
        { name: "tir_program", pubkey: tirProgramId, writable: false },
        { name: "ctr_program", pubkey: ctrProgramId, writable: false },
        { name: "compliance_program", pubkey: complianceProgramId, writable: false },
        { name: "system_program", pubkey: SystemProgram.programId, writable: false },
      ];
      console.info(
        "[DEPLOY PROGRAM ACCOUNT DEBUG] instruction accounts",
        deployIx.keys.map((key, index) => {
          const expected = expectedNamedAccounts[index];
          return {
            index,
            name: expected?.name ?? `remaining_${index - expectedNamedAccounts.length}`,
            pubkey: key.pubkey.toBase58(),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
            expectedPubkey: expected?.pubkey.toBase58() ?? null,
            matchesExpected: expected ? key.pubkey.equals(expected.pubkey) : null,
            expectedWritable: expected?.writable ?? null,
            writableMatches: expected ? key.isWritable === expected.writable : null,
          };
        }),
      );

      const { blockhash, lastValidBlockHeight } =
        await this.provider.connection.getLatestBlockhash("confirmed");

      const message = new TransactionMessage({
        payerKey: admin,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 10_000 }),
          deployIx,
        ],
      }).compileToV0Message([lutAccountInfo.value]);

      const vtx = new VersionedTransaction(message);
      const knownAccountNames = new Map<string, string>(
        [
          ...expectedNamedAccounts.map((account) => [
            account.pubkey.toBase58(),
            account.name,
          ] as const),
          ...remainingAccounts.map((account, index) => [
            account.pubkey.toBase58(),
            `remaining_${index}`,
          ] as const),
        ],
      );
      const compiledAccountKeys = (vtx.message as {
        getAccountKeys?: (args?: {
          addressLookupTableAccounts?: unknown[];
        }) => {
          get?: (index: number) => PublicKey | undefined;
          staticAccountKeys?: PublicKey[];
          accountKeysFromLookups?: {
            writable: PublicKey[];
            readonly: PublicKey[];
          };
        };
        isAccountSigner?: (index: number) => boolean;
        isAccountWritable?: (index: number) => boolean;
      }).getAccountKeys?.({
        addressLookupTableAccounts: [lutAccountInfo.value],
      });
      if (compiledAccountKeys) {
        const totalCompiledAccountKeys =
          (compiledAccountKeys.staticAccountKeys?.length ?? 0) +
          (compiledAccountKeys.accountKeysFromLookups?.writable.length ?? 0) +
          (compiledAccountKeys.accountKeysFromLookups?.readonly.length ?? 0);
        const compiledEntries = Array.from(
          { length: totalCompiledAccountKeys },
          (_, compiledIndex) => {
            const pubkey = compiledAccountKeys.get?.(compiledIndex);
            const key = pubkey?.toBase58() ?? null;
            return {
              compiledIndex,
              pubkey: key,
              isSigner:
                (vtx.message as { isAccountSigner?: (index: number) => boolean }).isAccountSigner?.(
                  compiledIndex,
                ) ?? null,
              isWritable:
                (vtx.message as { isAccountWritable?: (index: number) => boolean }).isAccountWritable?.(
                  compiledIndex,
                ) ?? null,
              guessedName: key ? knownAccountNames.get(key) ?? null : null,
            };
          },
        );
        console.info(
          "[COMPILED TX ACCOUNT KEYS DEBUG]",
          compiledEntries,
        );
        console.info(
          "[COMPILED TX ACCOUNT INDEX 12]",
          compiledEntries.find((entry) => entry.compiledIndex === 12) ?? null,
        );
      }
      const txSize = vtx.serialize().length;
      if (txSize > 1232) {
        throw new Error(
          `Deploy transaction is ${txSize} bytes, above Solana's 1232-byte limit. Reduce selected modules/trusted issuers or update the lookup-table packing.`,
        );
      }
      const adminLamportsBeforeSimulation = await this.provider.connection.getBalance(
        admin,
        "confirmed",
      );
      const simulatedAddresses = [
        tokenMint.toBase58(),
        extraAccountMetas.toBase58(),
        admin.toBase58(),
        ...(remainingAccounts[0] ? [remainingAccounts[0].pubkey.toBase58()] : []),
      ];
      const simulation = await (
        this.provider.connection.simulateTransaction as (
          transaction: VersionedTransaction,
          config: {
            sigVerify: boolean;
            commitment: "confirmed";
            replaceRecentBlockhash: boolean;
            accounts: {
              addresses: string[];
              encoding: "base64";
            };
          },
        ) => Promise<{
          value: {
            err: unknown;
            logs?: string[] | null;
            accounts?: Array<{
              lamports: number;
              owner: string;
              executable: boolean;
              data?: [string, string] | string;
            } | null>;
          };
        }>
      )(vtx, {
        sigVerify: false,
        commitment: "confirmed",
        replaceRecentBlockhash: true,
        accounts: {
          addresses: simulatedAddresses,
          encoding: "base64",
        },
      });
      const simulatedTokenMint = await this.buildSimulatedAccountSnapshot(
        tokenMint,
        simulation.value.accounts?.[0],
      );
      const simulatedExtraAccountMetas = await this.buildSimulatedAccountSnapshot(
        extraAccountMetas,
        simulation.value.accounts?.[1],
      );
      const simulatedAdmin = await this.buildSimulatedAccountSnapshot(
        admin,
        simulation.value.accounts?.[2],
      );
      const simulatedRemainingZero = remainingAccounts[0]
        ? await this.buildSimulatedAccountSnapshot(
            remainingAccounts[0].pubkey,
            simulation.value.accounts?.[3],
          )
        : null;
      if (simulation.value.err) {
        const simulationLogs = simulation.value.logs?.join("\n") || "(no logs)";
        console.error("[FRACKS Deploy] Post-simulation account state:", {
          tokenMint: simulatedTokenMint,
          extraAccountMetas: simulatedExtraAccountMetas,
          remaining0: simulatedRemainingZero,
          admin: {
            preSimulationLamports: adminLamportsBeforeSimulation,
            postSimulation: simulatedAdmin,
          },
        });
        throw new Error(
          `[FRACKS Deploy] Preflight simulation failed before send.\nError: ${JSON.stringify(simulation.value.err)}\n\nLogs:\n${simulationLogs}`,
        );
      }
      const sig = await this.sendPreparedVersionedTransaction(
        vtx,
        blockhash,
        lastValidBlockHeight,
      );

      const result = await this.getConfirmedTransactionResult(sig);

      if (result.value.err) {
        const txInfo = await this.provider.connection.getTransaction(sig, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        const logs = txInfo?.meta?.logMessages ?? [];
        const logsStr = logs.join("\n");

        // Always dump the full logs so the developer can see what failed
        console.error("[FRACKS Deploy] Transaction failed. Signature:", sig);
        console.error("[FRACKS Deploy] Full logs:\n" + (logsStr || "(none)"));
        console.error(
          "[FRACKS Deploy] Raw error:",
          JSON.stringify(result.value.err),
        );

        // Find which program failed first
        const failedProgramMatch = logsStr.match(/Program (\S+) failed:/);
        const failedProgram = failedProgramMatch?.[1] ?? "unknown";

        // Extract the error code
        const customErrMatch = logsStr.match(
          /custom program error:\s*0x([0-9a-fA-F]+)/i,
        );
        if (customErrMatch) {
          const code = parseInt(customErrMatch[1], 16);
          const decoded = parseAnchorError({ code });
          // Only use the decoded message if it's a known error (not generic UnknownProgramError)
          if (decoded && decoded.name !== "UnknownProgramError") {
            throw new Error(decoded.userMessage);
          }
          throw new Error(
            `On-chain error code ${code} (0x${code.toString(16)}) from program ${failedProgram}.\n\nLogs:\n${logsStr}`,
          );
        }

        throw new Error(
          `Transaction failed (program: ${failedProgram}).\nError: ${JSON.stringify(result.value.err)}\n\nLogs:\n${logsStr || "(no logs)"}`,
        );
      }

      const invariant = await this.ensureRegistryOwnership({
        irpState,
        irsState,
        tokenMint,
        issuer,
        irpProgramId,
        irsProgramId,
      });
      console.info("[FRACKS Deploy] Registry owner invariant:", {
        tokenMint: tokenMint.toBase58(),
        irpState: irpState.toBase58(),
        irpOwner: invariant.irpOwner.toBase58(),
        irsState: irsState.toBase58(),
        irsOwner: invariant.irsOwner.toBase58(),
        expectedOwner: issuer.toBase58(),
        aligned: invariant.irpOwner.equals(issuer) && invariant.irsOwner.equals(issuer),
      });

      const persistedDeployment = await this.provider.connection.getAccountInfo(
        deploymentPda,
        "confirmed",
      );
      const persistedTokenMint = await this.provider.connection.getAccountInfo(
        tokenMint,
        "confirmed",
      );
      const persistedTokenState = await this.provider.connection.getAccountInfo(
        tokenState,
        "confirmed",
      );
      const persistedIrpState = await this.provider.connection.getAccountInfo(
        irpState,
        "confirmed",
      );
      const persistedIrsState = await this.provider.connection.getAccountInfo(
        irsState,
        "confirmed",
      );
      const persistedTirState = await this.provider.connection.getAccountInfo(
        tirState,
        "confirmed",
      );
      const persistedCtrState = await this.provider.connection.getAccountInfo(
        ctrState,
        "confirmed",
      );
      const persistedComplianceState = await this.provider.connection.getAccountInfo(
        complianceState,
        "confirmed",
      );
      const persistedExtraAccountMetas = await this.provider.connection.getAccountInfo(
        extraAccountMetas,
        "confirmed",
      );
      const persistedExtraAccountMetasRent =
        persistedExtraAccountMetas
          ? await this.provider.connection.getMinimumBalanceForRentExemption(
              persistedExtraAccountMetas.data.length,
              "confirmed",
            )
          : 0;
      console.info("[FRACKS Deploy] Post-deploy persistence:", {
        deploymentPda: deploymentPda.toBase58(),
        deploymentAccount: persistedDeployment
          ? {
              lamports: persistedDeployment.lamports,
              dataLength: persistedDeployment.data.length,
              owner: persistedDeployment.owner.toBase58(),
              executable: persistedDeployment.executable,
            }
          : null,
        tokenMint: tokenMint.toBase58(),
        tokenMintAccount: persistedTokenMint
          ? {
              lamports: persistedTokenMint.lamports,
              dataLength: persistedTokenMint.data.length,
              owner: persistedTokenMint.owner.toBase58(),
              executable: persistedTokenMint.executable,
            }
          : null,
        tokenState: tokenState.toBase58(),
        tokenStateAccount: persistedTokenState
          ? {
              lamports: persistedTokenState.lamports,
              dataLength: persistedTokenState.data.length,
              owner: persistedTokenState.owner.toBase58(),
              executable: persistedTokenState.executable,
            }
          : null,
        irpState: irpState.toBase58(),
        irpStateAccount: persistedIrpState
          ? {
              lamports: persistedIrpState.lamports,
              dataLength: persistedIrpState.data.length,
              owner: persistedIrpState.owner.toBase58(),
              executable: persistedIrpState.executable,
            }
          : null,
        irsState: irsState.toBase58(),
        irsStateAccount: persistedIrsState
          ? {
              lamports: persistedIrsState.lamports,
              dataLength: persistedIrsState.data.length,
              owner: persistedIrsState.owner.toBase58(),
              executable: persistedIrsState.executable,
            }
          : null,
        tirState: tirState.toBase58(),
        tirStateAccount: persistedTirState
          ? {
              lamports: persistedTirState.lamports,
              dataLength: persistedTirState.data.length,
              owner: persistedTirState.owner.toBase58(),
              executable: persistedTirState.executable,
            }
          : null,
        ctrState: ctrState.toBase58(),
        ctrStateAccount: persistedCtrState
          ? {
              lamports: persistedCtrState.lamports,
              dataLength: persistedCtrState.data.length,
              owner: persistedCtrState.owner.toBase58(),
              executable: persistedCtrState.executable,
            }
          : null,
        complianceState: complianceState.toBase58(),
        complianceStateAccount: persistedComplianceState
          ? {
              lamports: persistedComplianceState.lamports,
              dataLength: persistedComplianceState.data.length,
              owner: persistedComplianceState.owner.toBase58(),
              executable: persistedComplianceState.executable,
            }
          : null,
        extraAccountMetas: extraAccountMetas.toBase58(),
        extraAccountMetasAccount: persistedExtraAccountMetas
          ? {
              lamports: persistedExtraAccountMetas.lamports,
              dataLength: persistedExtraAccountMetas.data.length,
              owner: persistedExtraAccountMetas.owner.toBase58(),
              executable: persistedExtraAccountMetas.executable,
              rentExemptLamports: persistedExtraAccountMetasRent,
              rentExemptSatisfied:
                persistedExtraAccountMetas.lamports >=
                persistedExtraAccountMetasRent,
            }
          : null,
      });

      return sig;
    } catch (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new Error(formatTransactionError(err));
    }
  }

  private toBn(value: unknown, fallback: BN): BN {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    return new BN(String(value));
  }

  private toTokenAmountBn(value: unknown, decimals: number, fallback: BN): BN {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }

    const [wholeRaw, fractionRaw = ""] = String(value).trim().split(".");
    const whole = wholeRaw || "0";
    const fraction = fractionRaw.padEnd(decimals, "0").slice(0, decimals);
    const scale = new BN(10).pow(new BN(decimals));
    return new BN(whole).mul(scale).add(new BN(fraction || "0"));
  }

  private parseCountryList(value: unknown): number[] {
    if (Array.isArray(value)) {
      return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
    }
    return String(value ?? "")
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item));
  }

  private parseCountryCaps(value: unknown): Array<{ country: number; cap: BN }> {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          const record = entry as { country?: unknown; cap?: unknown };
          return { country: Number(record.country), cap: this.toBn(record.cap, new BN(0)) };
        })
        .filter((entry) => Number.isFinite(entry.country));
    }
    return String(value ?? "")
      .split(",")
      .map((entry) => {
        const [country, cap] = entry.split(":").map((item) => item.trim());
        return { country: Number(country), cap: this.toBn(cap, new BN(0)) };
      })
      .filter((entry) => Number.isFinite(entry.country));
  }

  private chunkPublicKeys(keys: PublicKey[], size: number): PublicKey[][] {
    const chunks: PublicKey[][] = [];
    for (let index = 0; index < keys.length; index += size) {
      chunks.push(keys.slice(index, index + size));
    }
    return chunks;
  }

  private getHookModuleExtraMetaCount(moduleProgramId: PublicKey): number {
    if (moduleProgramId.equals(MOD_MAX_INVESTORS)) {
      return 2;
    }
    if (moduleProgramId.equals(MOD_DAILY_LIMIT)) {
      return 3;
    }
    if (moduleProgramId.equals(MOD_COUNTRY_CAP)) {
      return 4;
    }
    return 1;
  }

  private async ensureRegistryOwnership(input: {
    irpState: PublicKey;
    irsState: PublicKey;
    tokenMint: PublicKey;
    issuer: PublicKey;
    irpProgramId: PublicKey;
    irsProgramId: PublicKey;
  }): Promise<{ irpOwner: PublicKey; irsOwner: PublicKey }> {
    let owners = await this.fetchRegistryOwners(input);
    const admin = this.provider.wallet.publicKey;

    if (!owners.irpOwner.equals(input.issuer)) {
      if (!owners.irpOwner.equals(admin)) {
        throw new Error(
          `Deployment ownership repair failed: IRP owner ${owners.irpOwner.toBase58()} is neither connected admin ${admin.toBase58()} nor issuer ${input.issuer.toBase58()} for token ${input.tokenMint.toBase58()}.`,
        );
      }
      const signature = await this.transferIrpOwnership(
        input.irpProgramId,
        input.irpState,
        input.issuer,
      );
      console.info("[FRACKS Deploy] Repaired IRP ownership:", {
        tokenMint: input.tokenMint.toBase58(),
        irpState: input.irpState.toBase58(),
        newOwner: input.issuer.toBase58(),
        signature,
      });
    }

    owners = await this.fetchRegistryOwners(input);
    if (!owners.irsOwner.equals(input.issuer)) {
      if (!owners.irsOwner.equals(admin)) {
        throw new Error(
          `Deployment ownership repair failed: IRS owner ${owners.irsOwner.toBase58()} is neither connected admin ${admin.toBase58()} nor issuer ${input.issuer.toBase58()} for token ${input.tokenMint.toBase58()}.`,
        );
      }
      const signature = await this.transferIrsOwnership(
        input.irsProgramId,
        input.irsState,
        input.issuer,
      );
      console.info("[FRACKS Deploy] Repaired IRS ownership:", {
        tokenMint: input.tokenMint.toBase58(),
        irsState: input.irsState.toBase58(),
        newOwner: input.issuer.toBase58(),
        signature,
      });
    }

    owners = await this.fetchRegistryOwners(input);
    if (!owners.irpOwner.equals(input.issuer) || !owners.irsOwner.equals(input.issuer)) {
      throw new Error(
        `Deployment invariant failed: expected IRP and IRS owners to be issuer ${input.issuer.toBase58()}, got IRP ${owners.irpOwner.toBase58()} and IRS ${owners.irsOwner.toBase58()} for token ${input.tokenMint.toBase58()}.`,
      );
    }

    return owners;
  }

  private async fetchRegistryOwners(input: {
    irpState: PublicKey;
    irsState: PublicKey;
    tokenMint: PublicKey;
  }): Promise<{ irpOwner: PublicKey; irsOwner: PublicKey }> {
    const [irpInfo, irsInfo] = await this.provider.connection.getMultipleAccountsInfo(
      [input.irpState, input.irsState],
      "confirmed",
    );
    if (!irpInfo || irpInfo.data.length < 72) {
      throw new Error(
        `Deployment invariant failed: IRP state ${input.irpState.toBase58()} is missing or malformed for token ${input.tokenMint.toBase58()}.`,
      );
    }
    if (!irsInfo || irsInfo.data.length < 40) {
      throw new Error(
        `Deployment invariant failed: IRS state ${input.irsState.toBase58()} is missing or malformed for token ${input.tokenMint.toBase58()}.`,
      );
    }
    const irpOwner = new PublicKey(irpInfo.data.subarray(40, 72));
    const irsOwner = new PublicKey(irsInfo.data.subarray(8, 40));
    return { irpOwner, irsOwner };
  }

  private async transferIrpOwnership(
    irpProgramId: PublicKey,
    irpState: PublicKey,
    issuer: PublicKey,
  ): Promise<string> {
    const program = new Program(
      {
        ...(IrpIdl as unknown as Record<string, unknown>),
        address: irpProgramId.toBase58(),
      } as Idl,
      this.provider,
    );
    return (program.methods as any)
      .transferRegistryOwnership(issuer)
      .accounts({
        owner: this.provider.wallet.publicKey,
        registryState: irpState,
      })
      .rpc({ commitment: "confirmed" });
  }

  private async transferIrsOwnership(
    irsProgramId: PublicKey,
    irsState: PublicKey,
    issuer: PublicKey,
  ): Promise<string> {
    const program = new Program(
      {
        ...(IrsIdl as unknown as Record<string, unknown>),
        address: irsProgramId.toBase58(),
      } as Idl,
      this.provider,
    );
    return (program.methods as any)
      .transferOwnership(issuer)
      .accounts({
        owner: this.provider.wallet.publicKey,
        irsState,
      })
      .rpc({ commitment: "confirmed" });
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  private async sendTransactionConfirmed(
    transaction: Transaction,
    signers: TransactionSigner[] = [],
  ): Promise<string> {
    const { blockhash, lastValidBlockHeight } =
      await this.provider.connection.getLatestBlockhash("confirmed");
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = this.provider.wallet.publicKey;

    if (signers.length > 0) {
      transaction.partialSign(...signers);
    }

    let signed: Transaction;
    try {
      signed = await this.provider.wallet.signTransaction(transaction);
    } catch (err) {
      const message = formatTransactionError(err);
      throw new Error(
        `Wallet could not sign the deployment transaction. ${message}. If this happened while deploying with compliance modules, reconnect Phantom and retry; the frontend now sends lookup-table setup in smaller transactions.`,
      );
    }
    let signature: string;
    try {
      signature = await this.provider.connection.sendRawTransaction(
        signed.serialize(),
        { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
      );
    } catch (err) {
      throw await this.buildDetailedDeploymentError(err);
    }

    await this.confirmSubmittedTransaction(
      signature,
      blockhash,
      lastValidBlockHeight,
    );
    return signature;
  }

  private async sendTransactionsConfirmedBatch(
    items: Array<{ transaction: Transaction; signers?: TransactionSigner[] }>,
  ): Promise<string[]> {
    if (items.length === 0) return [];
    if (items.length === 1) {
      return [
        await this.sendTransactionConfirmed(
          items[0].transaction,
          items[0].signers ?? [],
        ),
      ];
    }

    const { blockhash, lastValidBlockHeight } =
      await this.provider.connection.getLatestBlockhash("confirmed");
    const transactions = items.map(({ transaction, signers }) => {
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = this.provider.wallet.publicKey;
      if (signers?.length) {
        transaction.partialSign(...signers);
      }
      return transaction;
    });

    const walletWithBatchSigner = this.provider.wallet as typeof this.provider.wallet & {
      signAllTransactions?: (transactions: Transaction[]) => Promise<Transaction[]>;
    };

    let signedTransactions: Transaction[];
    if (walletWithBatchSigner.signAllTransactions) {
      try {
        signedTransactions = await walletWithBatchSigner.signAllTransactions(transactions);
      } catch (err) {
        const message = formatTransactionError(err);
        throw new Error(
          `Wallet could not batch-sign the deployment setup transactions. ${message}. Reconnect Phantom and retry.`,
        );
      }
    } else {
      signedTransactions = [];
      for (const transaction of transactions) {
        signedTransactions.push(await this.provider.wallet.signTransaction(transaction));
      }
    }

    const signatures: string[] = [];
    for (const signedTransaction of signedTransactions) {
      let signature: string;
      try {
        signature = await this.provider.connection.sendRawTransaction(
          signedTransaction.serialize(),
          { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
        );
      } catch (err) {
        throw await this.buildDetailedDeploymentError(err);
      }

      await this.confirmSubmittedTransaction(
        signature,
        blockhash,
        lastValidBlockHeight,
      );
      signatures.push(signature);
    }

    return signatures;
  }

  private async sendInstructionsInBatches(
    instructions: TransactionInstruction[],
  ): Promise<string[]> {
    const signatures: string[] = [];
    const batches: TransactionInstruction[][] = [];
    let currentBatch: TransactionInstruction[] = [];

    for (const instruction of instructions) {
      const candidate = [...currentBatch, instruction];
      if (candidate.length > 1 && !this.transactionFitsLegacyLimit(candidate)) {
        batches.push(currentBatch);
        currentBatch = [instruction];
      } else {
        currentBatch = candidate;
      }
    }

    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    for (const batch of batches) {
      signatures.push(
        await this.sendTransactionConfirmed(new Transaction().add(...batch)),
      );
    }

    return signatures;
  }

  private transactionFitsLegacyLimit(
    instructions: TransactionInstruction[],
  ): boolean {
    const tx = new Transaction({
      feePayer: this.provider.wallet.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
    }).add(...instructions);

    try {
      const size = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      }).length;
      // Leave headroom for wallet differences and RPC-side serialization.
      return size <= 1_100;
    } catch {
      return false;
    }
  }

  private async sendPreparedVersionedTransaction(
    transaction: VersionedTransaction,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<string> {
    const signedVtx = await this.provider.wallet.signTransaction(transaction);
    const signerIndex = signedVtx.message.staticAccountKeys.findIndex((key) =>
      key.equals(this.provider.wallet.publicKey),
    );
    if (
      signerIndex < 0 ||
      !signedVtx.signatures[signerIndex] ||
      signedVtx.signatures[signerIndex].every((byte) => byte === 0)
    ) {
      throw new Error(
        "Wallet did not sign the versioned deployment transaction. Try a wallet adapter that supports v0 transactions or reconnect the wallet.",
      );
    }

    let signature: string;
    try {
      signature = await this.provider.connection.sendRawTransaction(
        signedVtx.serialize(),
        { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
      );
    } catch (err) {
      throw await this.buildDetailedDeploymentError(err);
    }

    await this.confirmSubmittedTransaction(
      signature,
      blockhash,
      lastValidBlockHeight,
    );
    return signature;
  }

  private async confirmSubmittedTransaction(
    signature: string,
    blockhash: string,
    lastValidBlockHeight: number,
  ): Promise<void> {
    try {
      const result = await this.provider.connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      if (result.value.err) {
        throw new Error(JSON.stringify(result.value.err));
      }
      return;
    } catch (err) {
      const message = formatTransactionError(err);
      if (!message.includes("Transaction expired")) {
        throw err;
      }

      for (let attempt = 0; attempt < 15; attempt += 1) {
        const status = await this.provider.connection.getSignatureStatus(
          signature,
          {
            searchTransactionHistory: true,
          },
        );
        if (status.value?.err) {
          throw new Error(JSON.stringify(status.value.err));
        }
        if (
          status.value?.confirmationStatus === "confirmed" ||
          status.value?.confirmationStatus === "finalized"
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }

      throw new Error(
        "Transaction was submitted but confirmation is delayed on devnet. Check explorer/history before retrying deployment.",
      );
    }
  }

  private async getConfirmedTransactionResult(signature: string) {
    const txInfo = await this.provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    return { value: { err: txInfo?.meta?.err ?? null } };
  }

  private async buildSimulatedAccountSnapshot(
    pubkey: PublicKey,
    account:
      | {
          lamports: number;
          owner: string;
          executable: boolean;
          data?: [string, string] | string;
        }
      | null
      | undefined,
  ): Promise<SimulatedAccountSnapshot> {
    if (!account) return null;

    let dataLength = 0;
    const rawData = account.data;
    if (Array.isArray(rawData) && typeof rawData[0] === "string") {
      try {
        dataLength = Buffer.from(rawData[0], "base64").length;
      } catch {
        dataLength = 0;
      }
    } else if (typeof rawData === "string") {
      try {
        dataLength = Buffer.from(rawData, "base64").length;
      } catch {
        dataLength = 0;
      }
    }

    const rentExemptLamports =
      dataLength > 0
        ? await this.provider.connection.getMinimumBalanceForRentExemption(
            dataLength,
            "confirmed",
          )
        : 0;

    return {
      pubkey: pubkey.toBase58(),
      lamports: account.lamports,
      owner: account.owner,
      executable: account.executable,
      dataLength,
      rentExemptLamports,
      rentExemptSatisfied:
        dataLength === 0 ? account.lamports > 0 : account.lamports >= rentExemptLamports,
    };
  }

  private async buildDetailedDeploymentError(err: unknown): Promise<Error> {
    const decoded = parseAnchorError(err);
    const baseMessage = decoded?.userMessage ?? formatTransactionError(err);
    const logGetter = err as {
      getLogs?: (connection: AnchorProvider["connection"]) => Promise<string[]>;
      logs?: string[];
      message?: unknown;
    };

    let logs: string[] = [];
    try {
      if (Array.isArray(logGetter.logs) && logGetter.logs.length > 0) {
        logs = logGetter.logs;
      } else if (typeof logGetter.getLogs === "function") {
        logs = (await logGetter.getLogs(this.provider.connection)) ?? [];
      }
    } catch {
      logs = [];
    }

    if (logs.length === 0) {
      return new Error(baseMessage);
    }

    const conciseLogs = logs.slice(-12).join("\n");
    return new Error(`${baseMessage}\n\nDeployment logs:\n${conciseLogs}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private _mapDeployment(raw: any, pda?: PublicKey): TokenDeployment {
    const issuerPubkey = raw.issuer as PublicKey;
    const salt = new Uint8Array(raw.salt as number[]);
    const derivedPda = pda ?? this.getDeploymentPda(issuerPubkey, salt)[0];
    return {
      deploymentId: BigInt(raw.deploymentId.toString()),
      deploymentPda: derivedPda.toBase58(),
      issuer: issuerPubkey.toBase58(),
      salt,
      tokenMint: (raw.tokenMint as PublicKey).toBase58(),
      tokenState: (raw.tokenState as PublicKey).toBase58(),
      ownerState: (raw.ownerState as PublicKey).toBase58(),
      irpState: (raw.irpState as PublicKey).toBase58(),
      irsState: (raw.irsState as PublicKey).toBase58(),
      tirState: (raw.tirState as PublicKey).toBase58(),
      ctrState: (raw.ctrState as PublicKey).toBase58(),
      complianceState: (raw.complianceState as PublicKey).toBase58(),
      deployedAt: Number(raw.deployedAt.toString()),
      bump: raw.bump,
    };
  }
}
