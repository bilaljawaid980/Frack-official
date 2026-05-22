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
  TOKEN_2022_PROGRAM_ID as SPL_TOKEN_2022,
  ExtensionType,
  getMintLen,
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
    throw new Error(
      `Compliance module initialization is unavailable because the frontend does not include an IDL for module program ${moduleProgramId.toBase58()}. Deploy without selected compliance modules or add the matching module IDL first.`,
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
        .initializeModule(tokenMint, [])
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_LOCKUP)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, NO_LOCKUP)
        .accounts(accounts)
        .instruction();
    }

    if (moduleProgramId.equals(MOD_COUNTRY_CAP)) {
      return (program.methods as unknown as FactoryProgramMethods)
        .initializeModule(tokenMint, [])
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

  private async ensureComplianceModulesInitialized(
    moduleProgramIds: string[],
    tokenMint: PublicKey,
    complianceState: PublicKey,
  ): Promise<void> {
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

    if (instructions.length > 0) {
      await this.sendInstructionsInBatches(instructions);
    }
  }

  /**
   * Full two-step deployment targeting the testnet-deployed factory:
   * 1. Create the SPL Token-2022 mint directly via spl-token instructions
   * 2. deploy_token_suite — initialises all FRACKS state accounts
   *
   * The deployed factory on testnet does not have a create_token_mint instruction,
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
    const moduleStatePdas = args.complianceModules.map((programIdStr) =>
      this.getModuleStatePda(new PublicKey(programIdStr), tokenMint),
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

      const extendLutIx = AddressLookupTableProgram.extendLookupTable({
        payer: admin,
        authority: admin,
        lookupTable: lutAddress,
        addresses: lutAddresses,
      });

      await this.sendTransactionConfirmed(
        new Transaction().add(createLutIx, extendLutIx),
      );

      // ── Step 2: Create the Token-2022 mint if it does not already exist ─────────
      if (mintKeypair) {
        // Skip mint creation if the account already exists (e.g. from a previous failed attempt)
        const mintAccountInfo = await this.provider.connection.getAccountInfo(
          tokenMint,
          "confirmed",
        );
        if (!mintAccountInfo) {
          const mintLen = getMintLen([
            ExtensionType.TransferHook,
            ExtensionType.PermanentDelegate,
          ]);
          const lamports =
            await this.provider.connection.getMinimumBalanceForRentExemption(
              mintLen,
            );
          const mintTx = new Transaction().add(
            SystemProgram.createAccount({
              fromPubkey: admin,
              newAccountPubkey: tokenMint,
              space: mintLen,
              lamports,
              programId: SPL_TOKEN_2022,
            }),
            createInitializeTransferHookInstruction(
              tokenMint,
              admin,
              hookProgramId,
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
          await this.sendTransactionConfirmed(mintTx, [mintKeypair]);
        }
      }

      // The currently deployed factory binds module state PDAs, but it does not
      // create them. Initialize them here so newly deployed tokens transfer
      // correctly instead of failing later inside the Token-2022 hook.
      await this.ensureComplianceModulesInitialized(
        args.complianceModules,
        tokenMint,
        complianceState,
      );

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
      const txSize = vtx.serialize().length;
      if (txSize > 1232) {
        throw new Error(
          `Deploy transaction is ${txSize} bytes, above Solana's 1232-byte limit. Reduce selected modules/trusted issuers or update the lookup-table packing.`,
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

      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
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

    const signed = await this.provider.wallet.signTransaction(transaction);
    const signature = await this.provider.connection.sendRawTransaction(
      signed.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
    );

    await this.confirmSubmittedTransaction(
      signature,
      blockhash,
      lastValidBlockHeight,
    );
    return signature;
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

    const signature = await this.provider.connection.sendRawTransaction(
      signedVtx.serialize(),
      { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
    );

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
        "Transaction was submitted but confirmation is delayed on testnet. Check explorer/history before retrying deployment.",
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
