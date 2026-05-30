// ─── Compliance Service ───────────────────────────────────────────────────────
//
// Wraps the fracks_compliance Anchor program plus all module IDLs for reading
// and writing compliance state and per-module configurations.
// ─────────────────────────────────────────────────────────────────────────────

import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import {
  COMPLIANCE_PROGRAM_ID,
  SEED_COMPLIANCE_STATE,
  MOD_DAILY_LIMIT,
  MOD_MAX_BALANCE,
  MOD_MAX_TRANSFER,
  MOD_LOCKUP,
  MOD_SUPPLY_CAP,
  MOD_MAX_INVESTORS,
  MOD_COUNTRY_RESTRICT,
  MOD_COUNTRY_CAP,
} from "@/lib/constants";
import { formatTransactionError } from "@/lib/errors";
import type { ComplianceState } from "@/types";
import ComplianceIdl from "@/idl/fracks_compliance.json";
import DailyLimitIdl from "@/idl/mod_daily_limit.json";
import MaxBalanceIdl from "@/idl/mod_max_balance.json";
import MaxTransferIdl from "@/idl/mod_max_transfer.json";
import LockupIdl from "@/idl/mod_lockup.json";
import SupplyCapIdl from "@/idl/mod_supply_cap.json";
import MaxInvestorsIdl from "@/idl/mod_max_investors.json";
import CountryRestrictIdl from "@/idl/mod_country_restrict.json";
import CountryCapIdl from "@/idl/mod_country_cap.json";

type ComplianceProgram = Program<Idl>;
const SET_MAX_SUPPLY_DISCRIMINATOR = Buffer.from([
  16, 207, 140, 77, 107, 20, 202, 158,
]);

// ─── Module state account seeds (derived from IDLs) ──────────────────────────

const MODULE_SEEDS: Record<string, Buffer> = {
  daily_limit: Buffer.from("mod_daily_limit"),
  max_balance: Buffer.from("mod_max_balance"),
  max_transfer: Buffer.from("mod_max_transfer"),
  lockup: Buffer.from("mod_lockup"),
  supply_cap: Buffer.from("mod_supply_cap"),
  max_investors: Buffer.from("mod_max_investors"),
  country_restrict: Buffer.from("mod_country"),
  country_cap: Buffer.from("mod_country_cap"),
};

// Map program ID => module type identifier
const PROGRAM_TO_MODULE_TYPE: Record<string, string> = {
  [MOD_DAILY_LIMIT.toBase58()]: "daily_limit",
  [MOD_MAX_BALANCE.toBase58()]: "max_balance",
  [MOD_MAX_TRANSFER.toBase58()]: "max_transfer",
  [MOD_LOCKUP.toBase58()]: "lockup",
  [MOD_SUPPLY_CAP.toBase58()]: "supply_cap",
  [MOD_MAX_INVESTORS.toBase58()]: "max_investors",
  [MOD_COUNTRY_RESTRICT.toBase58()]: "country_restrict",
  [MOD_COUNTRY_CAP.toBase58()]: "country_cap",
};

// ─── ComplianceService ────────────────────────────────────────────────────────

export class ComplianceService {
  private program: ComplianceProgram;
  private provider: AnchorProvider;

  constructor(provider: AnchorProvider) {
    this.provider = provider;
    this.program = new Program(
      ComplianceIdl as unknown as Idl,
      provider
    );
  }

  // ── PDA Derivation ───────────────────────────────────────────────────────────

  /** Seeds: ["compliance_state", mint] */
  findComplianceStatePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [SEED_COMPLIANCE_STATE, mint.toBuffer()],
      COMPLIANCE_PROGRAM_ID
    );
  }

  // ── Read Methods ─────────────────────────────────────────────────────────────

  async fetchComplianceState(mint: PublicKey): Promise<ComplianceState> {
    const [complianceStatePda] = this.findComplianceStatePda(mint);
    const raw = await (this.program.account as any).complianceState.fetch(
      complianceStatePda
    );
    return {
      owner: raw.owner.toBase58(),
      tokenMint: raw.tokenMint.toBase58(),
      modules: raw.modules.map((m: PublicKey) => m.toBase58()),
      modulesPaused: raw.modulesPaused,
      bump: raw.bump,
    };
  }

  /**
   * Fetches the on-chain state for a specific compliance module.
   * Dispatches to the correct module IDL based on moduleType.
   */
  async fetchModuleState(
    moduleType: string,
    moduleProgramId: PublicKey,
    mint: PublicKey
  ): Promise<unknown> {
    const seed = MODULE_SEEDS[moduleType];
    if (!seed) {
      throw new Error(`Unknown module type: ${moduleType}`);
    }

    const [moduleStatePda] = PublicKey.findProgramAddressSync(
      [seed, mint.toBuffer()],
      moduleProgramId
    );

    switch (moduleType) {
      case "daily_limit": {
        const prog = new Program(DailyLimitIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).dailyTransferLimitModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          hookAuthority: raw.hookAuthority.toBase58(),
          dailyLimit: BigInt(raw.dailyLimit.toString()),
          bump: raw.bump,
        };
      }
      case "max_balance": {
        const prog = new Program(MaxBalanceIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).maxBalanceModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          maxBalance: BigInt(raw.maxBalance.toString()),
          bump: raw.bump,
        };
      }
      case "max_transfer": {
        const prog = new Program(MaxTransferIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).maxTransferModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          maxAmount: BigInt(raw.maxAmount.toString()),
          bump: raw.bump,
        };
      }
      case "lockup": {
        const prog = new Program(LockupIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).lockupModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          lockupEnd: Number(raw.lockupEnd.toString()),
          bump: raw.bump,
        };
      }
      case "supply_cap": {
        const prog = new Program(SupplyCapIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).supplyCapModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          hookAuthority: raw.hookAuthority.toBase58(),
          maxSupply: BigInt(raw.maxSupply.toString()),
          totalSupply: BigInt(raw.totalSupply.toString()),
          bump: raw.bump,
        };
      }
      case "max_investors": {
        const prog = new Program(MaxInvestorsIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).maxInvestorsModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          hookAuthority: raw.hookAuthority.toBase58(),
          maxInvestors: BigInt(raw.maxInvestors.toString()),
          holderCount: BigInt(raw.holderCount.toString()),
          bump: raw.bump,
        };
      }
      case "country_restrict": {
        const prog = new Program(CountryRestrictIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).countryRestrictModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          allowedCountries: raw.allowedCountries as number[],
          bump: raw.bump,
        };
      }
      case "country_cap": {
        const prog = new Program(CountryCapIdl as unknown as Idl, this.provider);
        const raw = await (prog.account as any).investorCountryCapModule.fetch(moduleStatePda);
        return {
          owner: raw.owner.toBase58(),
          tokenMint: raw.tokenMint.toBase58(),
          hookAuthority: raw.hookAuthority.toBase58(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          countryCaps: (raw.countryCaps as any[]).map((cc) => ({
            country: cc.country as number,
            cap: BigInt(cc.cap.toString()),
          })),
          bump: raw.bump,
        };
      }
      default:
        throw new Error(`Unsupported module type: ${moduleType}`);
    }
  }

  // ── Write Methods ─────────────────────────────────────────────────────────────

  /**
   * Binds a compliance module to the token's compliance state.
   */
  async bindModule(mint: PublicKey, modulePubkey: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [complianceState] = this.findComplianceStatePda(mint);

    try {
      const sig = await this.program.methods
        .bindModule(modulePubkey)
        .accounts({
          owner,
          complianceState,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Unbinds a compliance module from the token's compliance state.
   */
  async unbindModule(mint: PublicKey, modulePubkey: PublicKey): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [complianceState] = this.findComplianceStatePda(mint);

    try {
      const sig = await this.program.methods
        .unbindModule(modulePubkey)
        .accounts({
          owner,
          complianceState,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Pauses or unpauses all compliance module checks.
   */
  async setModulesPaused(mint: PublicKey, paused: boolean): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [complianceState] = this.findComplianceStatePda(mint);

    try {
      const sig = await this.program.methods
        .setModulesPaused(paused)
        .accounts({
          owner,
          complianceState,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  /**
   * Configures a compliance module by calling its module-specific set instruction
   * via the compliance program's call_module_function CPI.
   *
   * @param moduleType - Module identifier (e.g. "daily_limit")
   * @param mint       - Token mint
   * @param params     - Module-specific parameters
   */
  async configureModule(
    moduleType: string,
    mint: PublicKey,
    params: Record<string, unknown>
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [complianceState] = this.findComplianceStatePda(mint);

    // Encode the discriminator + args as raw bytes for call_module_function
    const encoded = this._encodeModuleConfigData(moduleType, params);
    const moduleProgram = this._getModuleProgramId(moduleType);

    try {
      const sig = await this.program.methods
        .callModuleFunction(encoded)
        .accounts({
          owner,
          complianceState,
          moduleProgram,
        })
        .rpc({ commitment: "confirmed" });
      return sig;
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  async setSupplyCap(
    mint: PublicKey,
    readableMaxSupply: string,
    decimals: number,
  ): Promise<string> {
    const owner = this.provider.wallet.publicKey;
    const [moduleState] = PublicKey.findProgramAddressSync(
      [MODULE_SEEDS.supply_cap, mint.toBuffer()],
      MOD_SUPPLY_CAP,
    );
    const maxSupply = this._toTokenAmount(readableMaxSupply, decimals);

    try {
      const ix = new TransactionInstruction({
        programId: MOD_SUPPLY_CAP,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: false },
          { pubkey: moduleState, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([
          SET_MAX_SUPPLY_DISCRIMINATOR,
          this._encodeBN(maxSupply),
        ]),
      });
      return await this.provider.sendAndConfirm(
        new Transaction().add(ix),
        [],
        { commitment: "confirmed" },
      );
    } catch (err) {
      throw new Error(formatTransactionError(err));
    }
  }

  // ── Private Helpers ───────────────────────────────────────────────────────────

  private _getModuleProgramId(moduleType: string): PublicKey {
    const entry = Object.entries(PROGRAM_TO_MODULE_TYPE).find(
      ([, v]) => v === moduleType
    );
    if (!entry) throw new Error(`No program ID found for module type: ${moduleType}`);
    return new PublicKey(entry[0]);
  }

  /**
   * Encodes module configuration parameters into the raw bytes expected by
   * call_module_function. Each module has a discriminator + serialized args.
   *
   * This implementation encodes using the Anchor-style discriminator for the
   * module's "set_*" instruction based on the IDL.
   */
  private _encodeModuleConfigData(
    moduleType: string,
    params: Record<string, unknown>
  ): Buffer {
    // Each module exposes a configure-style instruction.
    // We build a minimal byte buffer: 8-byte discriminator + serialized params.
    // For the purposes of this service the raw bytes are assembled from the
    // module IDL discriminators.
    const MODULE_DISCRIMINATORS: Record<string, number[]> = {
      daily_limit: [115, 149, 71, 136, 202, 55, 13, 36],
      max_balance: [198, 43, 168, 97, 33, 238, 35, 103],
      max_transfer: [83, 34, 139, 201, 192, 100, 217, 145],
      lockup: [175, 232, 189, 58, 200, 162, 121, 86],
      supply_cap: [45, 86, 210, 133, 77, 26, 65, 217],
      max_investors: [220, 15, 138, 207, 175, 92, 68, 53],
      country_restrict: [151, 32, 53, 99, 41, 185, 74, 198],
      country_cap: [205, 134, 48, 118, 33, 208, 67, 90],
    };

    const disc = MODULE_DISCRIMINATORS[moduleType];
    if (!disc) throw new Error(`Unknown module type for encoding: ${moduleType}`);

    const discBuffer = Buffer.from(disc);

    // Serialize the primary numeric param as a little-endian u64 / i64
    let paramBuffer: Uint8Array = new Uint8Array(0);
    if (moduleType === "daily_limit" && params.daily_limit !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.daily_limit as string | number));
    } else if (moduleType === "max_balance" && params.max_balance !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.max_balance as string | number));
    } else if (moduleType === "max_transfer" && params.max_amount !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.max_amount as string | number));
    } else if (moduleType === "lockup" && params.lockup_end !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.lockup_end as string | number));
    } else if (moduleType === "supply_cap" && params.max_supply !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.max_supply as string | number));
    } else if (moduleType === "max_investors" && params.max_investors !== undefined) {
      paramBuffer = this._encodeBN(BigInt(params.max_investors as string | number));
    }
    // country_restrict and country_cap require more complex encoding (vec);
    // callers should use raw CPI for those

    return Buffer.concat([discBuffer, paramBuffer]);
  }

  private _encodeBN(value: bigint): Uint8Array {
    const buf = Buffer.alloc(8);
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (typeof view.setBigUint64 === "function") {
      view.setBigUint64(0, value, true);
    } else {
      const lo = Number(value & 0xffffffffn);
      const hi = Number((value >> 32n) & 0xffffffffn);
      buf.writeUInt32LE(lo, 0);
      buf.writeUInt32LE(hi, 4);
    }
    return buf;
  }

  private _toTokenAmount(value: string, decimals: number): bigint {
    const [wholeRaw, fractionRaw = ""] = value.trim().split(".");
    const whole = wholeRaw || "0";
    const fraction = fractionRaw.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction || "0");
  }
}
