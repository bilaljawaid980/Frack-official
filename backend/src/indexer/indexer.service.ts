import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { getIndexerConfig } from "./indexer.config";
import {
  Connection,
  PublicKey,
  type AccountInfo,
  type GetProgramAccountsFilter,
} from "@solana/web3.js";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Prisma } from "@prisma/client";
import type { FactoryTokenInfo } from "./types";

@Injectable()
export class IndexerService {
  private config = getIndexerConfig();
  private activeRpcIndex = 0;
  private connection = this.createConnection(this.config.rpcEndpoints[0]);
  private rpcDelayMs = Number(process.env.INDEXER_RPC_DELAY_MS || 250);
  private rpcMaxRetries = Number(process.env.INDEXER_RPC_MAX_RETRIES || 5);

  constructor(private prisma: PrismaService) {}

  private createConnection(rpcEndpoint: string) {
    return new Connection(rpcEndpoint, "confirmed");
  }

  private switchToNextRpcEndpoint() {
    if (this.activeRpcIndex >= this.config.rpcEndpoints.length - 1) {
      return false;
    }

    this.activeRpcIndex += 1;
    const nextEndpoint = this.config.rpcEndpoints[this.activeRpcIndex];
    this.connection = this.createConnection(nextEndpoint);
    console.warn(
      `[Indexer] Switched Solana RPC endpoint to fallback #${this.activeRpcIndex + 1}`,
    );
    return true;
  }

  async syncOnce() {
    console.log(`[Indexer] Sync start ${new Date().toISOString()}`);
    await this.updateState("RUNNING");
    try {
      const factoryTokens = await this.fetchAllFactoryTokens();
      await this.upsertAssets(factoryTokens);

      const tokenContracts = [
        ...new Set([
          ...this.config.tokenContracts,
          ...factoryTokens.map((token) => token.contract_address),
        ]),
      ];

      for (const contract of tokenContracts) {
        try {
          await this.syncToken(contract);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[Indexer] Skipping token ${contract}: ${message}`);
        }
        await this.sleep(this.rpcDelayMs);
      }

      await this.updateState("IDLE", null);
      console.log(`[Indexer] Sync complete ${new Date().toISOString()}`);
    } catch (error: any) {
      const message =
        error instanceof Error
          ? `${error.message}\n${error.stack || ""}`.trim()
          : String(error);
      console.error("Indexer error:", message);
      await this.updateState("ERROR", message || "Indexer failed");
      console.log(`[Indexer] Sync failed ${new Date().toISOString()}`);
      throw error;
    }
  }

  private async fetchAllFactoryTokens(): Promise<FactoryTokenInfo[]> {
    const programId = new PublicKey(this.config.factoryProgram);
    const filters: GetProgramAccountsFilter[] = [
      { dataSize: TOKEN_DEPLOYMENT_SIZE },
    ];

    const accounts = await this.withRpcRetries("getProgramAccounts(factory)", () =>
      this.connection.getProgramAccounts(programId, {
        filters,
        commitment: "confirmed",
      }),
    );

    if (!accounts) return [];

    const tokens: FactoryTokenInfo[] = [];
    for (const account of accounts) {
      const deployment = parseTokenDeployment(account.account);
      if (!deployment) continue;

      const tokenStateInfo = await this.withRpcRetries(
        `getAccountInfo(tokenState:${deployment.tokenState.toBase58()})`,
        () => this.connection.getAccountInfo(deployment.tokenState, "confirmed"),
      );
      const tokenState = tokenStateInfo
        ? parseTokenState(tokenStateInfo)
        : null;
      const metadata = await this.buildIndexedMetadata(
        deployment.tokenMint,
        deployment.complianceState,
        tokenState?.decimals,
      );

      tokens.push({
        asset_id: Number(deployment.deploymentId),
        contract_address: deployment.tokenMint.toBase58(),
        name: tokenState?.name || "",
        symbol: tokenState?.symbol || "",
        reference_id: tokenState?.isin || deployment.tokenMint.toBase58(),
        description: "",
        legal_owner: deployment.issuer.toBase58(),
        metadata: metadata ? JSON.stringify(metadata) : undefined,
        deployed_at: Number(deployment.deployedAt),
      });
      await this.sleep(this.rpcDelayMs);
    }

    return tokens.sort((a, b) => a.asset_id - b.asset_id);
  }

  private async upsertAssets(tokens: FactoryTokenInfo[]) {
    for (const token of tokens) {
      const indexedMetadata = token.metadata
        ? this.safeParseJson(token.metadata)
        : null;
      const existing = await this.prisma.asset.findUnique({
        where: { tokenContract: token.contract_address },
        select: { metadata: true },
      });
      const metadata = this.mergeMetadata(existing?.metadata, indexedMetadata);
      const metadataUpdate =
        metadata === undefined ? {} : { metadata: metadata as Prisma.InputJsonValue };

      await this.prisma.asset.upsert({
        where: { tokenContract: token.contract_address },
        update: {
          factoryAssetId: token.asset_id,
          referenceId: token.reference_id,
          name: token.name,
          symbol: token.symbol,
          description: token.description,
          issuerWallet: token.legal_owner,
          legalOwner: token.legal_owner,
          ...metadataUpdate,
          deployedAt: new Date(token.deployed_at * 1000),
        },
        create: {
          factoryAssetId: token.asset_id,
          tokenContract: token.contract_address,
          referenceId: token.reference_id,
          name: token.name,
          symbol: token.symbol,
          description: token.description,
          issuerWallet: token.legal_owner,
          legalOwner: token.legal_owner,
          metadata:
            metadata === undefined
              ? Prisma.JsonNull
              : (metadata as Prisma.InputJsonValue),
          deployedAt: new Date(token.deployed_at * 1000),
        },
      });
    }
  }

  private async syncToken(tokenContract: string) {
    const tokenMint = new PublicKey(tokenContract);
    const [ownerState] = deriveOwnerStatePDA(tokenMint);
    const ownerInfo = await this.withRpcRetries(
      `getAccountInfo(ownerState:${ownerState.toBase58()})`,
      () => this.connection.getAccountInfo(ownerState, "confirmed"),
    );
    const ownerWallet = ownerInfo ? parseOwnerState(ownerInfo) : null;

    const mintInfo = await getMint(
      this.connection,
      tokenMint,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    ).catch(() => null);

    if (mintInfo) {
      await this.prisma.tokenState.upsert({
        where: { tokenContract },
        update: {
          decimals: mintInfo.decimals,
          totalSupply: mintInfo.supply.toString(),
        },
        create: {
          tokenContract,
          name: "",
          symbol: "",
          decimals: mintInfo.decimals,
          totalSupply: mintInfo.supply.toString(),
        },
      });
    }

    if (ownerWallet) {
      await this.prisma.asset.updateMany({
        where: { tokenContract },
        data: {
          issuerWallet: ownerWallet.toBase58(),
          legalOwner: ownerWallet.toBase58(),
        },
      });
    }

    const discoveredWallets = await this.discoverWalletsFromTxs(tokenContract);
    if (discoveredWallets.length > 0) {
      await this.prisma.trackedWallet.createMany({
        data: discoveredWallets.map((walletAddress) => ({
          walletAddress,
          label: "tx-scan",
        })),
        skipDuplicates: true,
      });
    }

    const userWallets = await this.prisma.user.findMany({
      where: { walletAddress: { not: null } },
      select: { walletAddress: true },
    });
    const trackedWallets = await this.prisma.trackedWallet.findMany({
      select: { walletAddress: true },
    });

    const walletAddresses = Array.from(
      new Set(
        [
          ...userWallets,
          ...trackedWallets,
          ...discoveredWallets.map((walletAddress) => ({ walletAddress })),
        ]
          .map((entry) => entry.walletAddress)
          .filter((address): address is string => !!address),
      ),
    );

    for (const walletAddress of walletAddresses) {
      let normalizedBalance = "0";
      try {
        const walletPk = new PublicKey(walletAddress);
        const ata = getAssociatedTokenAddressSync(
          tokenMint,
          walletPk,
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        const account = await getAccount(
          this.connection,
          ata,
          "confirmed",
          TOKEN_2022_PROGRAM_ID,
        );
        normalizedBalance = account.amount.toString();
      } catch {
        normalizedBalance = "0";
      }

      await this.prisma.tokenBalance.upsert({
        where: {
          tokenContract_walletAddress: {
            tokenContract,
            walletAddress,
          },
        },
        update: { balance: normalizedBalance },
        create: {
          tokenContract,
          walletAddress,
          balance: normalizedBalance,
        },
      });
    }
  }

  private async scanTokenAssets(tokenContract: string) {
    void tokenContract;
    return [];
  }

  private async withRpcRetries<T>(
    label: string,
    operation: () => Promise<T>,
  ): Promise<T | null> {
    for (let attempt = 0; attempt <= this.rpcMaxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!this.isRecoverableRpcError(error) || attempt === this.rpcMaxRetries) {
          throw error;
        }

        this.switchToNextRpcEndpoint();
        const delayMs = this.rpcDelayMs * 2 ** attempt;
        console.warn(
          `[Indexer] RPC failed during ${label}; retrying in ${delayMs}ms`,
        );
        await this.sleep(delayMs);
      }
    }

    return null;
  }

  private isRecoverableRpcError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("429") ||
      message.includes("Too Many Requests") ||
      message.includes("fetch failed") ||
      message.includes("Failed to fetch") ||
      message.includes("ECONNRESET") ||
      message.includes("ETIMEDOUT") ||
      message.includes("ENOTFOUND")
    );
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async updateState(status: string, error?: string | null) {
    const existing = await this.prisma.indexerState.findFirst();
    if (!existing) {
      await this.prisma.indexerState.create({
        data: { status, error: error ?? null, lastRunAt: new Date() },
      });
      return;
    }

    await this.prisma.indexerState.update({
      where: { id: existing.id },
      data: { status, error: error ?? null, lastRunAt: new Date() },
    });
  }

  private safeParseJson(raw: string) {
    try {
      return JSON.parse(raw);
    } catch {
      return { raw };
    }
  }

  private mergeMetadata(existing: unknown, indexed: unknown) {
    const existingObject = isRecord(existing) ? existing : null;
    const indexedObject = isRecord(indexed) ? indexed : null;

    if (!existingObject && !indexedObject) return undefined;
    if (!existingObject) return indexedObject;
    if (!indexedObject) return existingObject;

    return {
      ...existingObject,
      ...indexedObject,
      trustedIssuers:
        Array.isArray(indexedObject.trustedIssuers) &&
        indexedObject.trustedIssuers.length > 0
          ? indexedObject.trustedIssuers
          : existingObject.trustedIssuers,
      claimTopics:
        Array.isArray(indexedObject.claimTopics) &&
        indexedObject.claimTopics.length > 0
          ? indexedObject.claimTopics
          : existingObject.claimTopics,
      complianceModules:
        Array.isArray(indexedObject.complianceModules) &&
        indexedObject.complianceModules.length > 0
          ? indexedObject.complianceModules
          : existingObject.complianceModules,
      complianceModuleParams:
        isRecord(indexedObject.complianceModuleParams) &&
        Object.keys(indexedObject.complianceModuleParams).length > 0
          ? indexedObject.complianceModuleParams
          : existingObject.complianceModuleParams,
    };
  }

  private async buildIndexedMetadata(
    tokenMint: PublicKey,
    complianceState: PublicKey,
    decimals?: number,
  ) {
    const [ctrState] = PublicKey.findProgramAddressSync(
      [Buffer.from("ctr_state"), tokenMint.toBuffer()],
      getCtrProgramId(),
    );
    const [tirState] = PublicKey.findProgramAddressSync(
      [Buffer.from("tir_state"), tokenMint.toBuffer()],
      getTirProgramId(),
    );

    const claimTopics = await this.readClaimTopics(ctrState);
    const trustedIssuers = await this.readTrustedIssuers(tirState);
    const complianceMetadata = await this.readComplianceMetadata(
      complianceState,
      decimals,
    );

    if (
      claimTopics.length === 0 &&
      trustedIssuers.length === 0 &&
      complianceMetadata.complianceModules.length === 0 &&
      decimals === undefined
    ) {
      return null;
    }

    return {
      ...(decimals === undefined ? {} : { decimals }),
      claimTopics,
      trustedIssuers,
      ...complianceMetadata,
    };
  }

  private async readClaimTopics(ctrState: PublicKey): Promise<string[]> {
    const account = await this.withRpcRetries(
      `getAccountInfo(ctrState:${ctrState.toBase58()})`,
      () => this.connection.getAccountInfo(ctrState, "confirmed"),
    );
    if (!account) return [];
    return parseClaimTopicsState(account);
  }

  private async readTrustedIssuers(tirState: PublicKey) {
    const accounts = await this.withRpcRetries("getProgramAccounts(tir issuers)", () =>
      this.connection.getProgramAccounts(getTirProgramId(), {
        commitment: "confirmed",
        filters: [
          { dataSize: ISSUER_ENTRY_SIZE },
          { memcmp: { offset: 8 + 32, bytes: tirState.toBase58() } },
        ],
      }),
    );

    if (!accounts) return [];

    const issuers = [];
    for (const account of accounts) {
      const issuer = parseIssuerEntry(account.account);
      if (!issuer) continue;

      const walletAddress = await this.readFidOwner(issuer.issuerFid);
      issuers.push({
        label: issuer.label,
        issuerFid: issuer.issuerFid.toBase58(),
        walletAddress: walletAddress || "",
        topics: issuer.topics,
        active: issuer.active,
      });
      await this.sleep(this.rpcDelayMs);
    }

    return issuers;
  }

  private async readComplianceMetadata(
    complianceState: PublicKey,
    decimals = 6,
  ) {
    const account = await this.withRpcRetries(
      `getAccountInfo(complianceState:${complianceState.toBase58()})`,
      () => this.connection.getAccountInfo(complianceState, "confirmed"),
    );
    const moduleStates = account ? parseComplianceState(account) : [];
    if (moduleStates.length === 0) {
      return { complianceModules: [], complianceModuleParams: {} };
    }

    const moduleAccounts = await this.withRpcRetries(
      `getMultipleAccountsInfo(complianceModules:${complianceState.toBase58()})`,
      () => this.connection.getMultipleAccountsInfo(moduleStates, "confirmed"),
    );
    const complianceModules: string[] = [];
    const complianceModuleParams: Record<string, Record<string, string>> = {};

    for (const [index] of moduleStates.entries()) {
      const moduleAccount = moduleAccounts?.[index];
      if (!moduleAccount) continue;

      const programId = moduleAccount.owner.toBase58();
      const params = parseComplianceModuleParams(moduleAccount, decimals);
      if (!params) continue;

      complianceModules.push(programId);
      complianceModuleParams[programId] = params;
    }

    return { complianceModules, complianceModuleParams };
  }

  private async readFidOwner(fid: PublicKey) {
    const account = await this.withRpcRetries(
      `getAccountInfo(fid:${fid.toBase58()})`,
      () => this.connection.getAccountInfo(fid, "confirmed"),
    );
    if (!account || account.data.length < 40) return "";
    return new PublicKey(account.data.subarray(8, 40)).toBase58();
  }

  private async discoverWalletsFromTxs(
    tokenContract: string
  ): Promise<string[]> {
    void tokenContract;
    return [];
  }
}

const TOKEN_DEPLOYMENT_SIZE = 345;
const ISSUER_ENTRY_SIZE = 8 + 32 + 32 + 4 + 8 * 20 + 1 + 4 + 64 + 1;

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTokenDeployment(account: AccountInfo<Buffer>) {
  const data = account.data;
  if (data.length < TOKEN_DEPLOYMENT_SIZE) return null;
  let offset = 8;
  const deploymentId = data.readBigUInt64LE(offset);
  offset += 8;
  const issuer = readPubkey(data, offset);
  offset += 32;
  offset += 32; // salt
  const tokenMint = readPubkey(data, offset);
  offset += 32;
  const tokenState = readPubkey(data, offset);
  offset += 32;
  offset += 32; // owner_state
  offset += 32; // irp_state
  offset += 32; // irs_state
  offset += 32; // tir_state
  offset += 32; // ctr_state
  const complianceState = readPubkey(data, offset);
  offset += 32;
  const deployedAt = data.readBigInt64LE(offset);

  return {
    deploymentId,
    issuer,
    tokenMint,
    tokenState,
    complianceState,
    deployedAt,
  };
}

function parseTokenState(account: AccountInfo<Buffer>) {
  const data = account.data;
  let offset = 8 + 32 + 32 + 32; // discriminator + token_mint + identity_registry + compliance
  if (data.length < offset + 2) return null;
  const paused = data.readUInt8(offset) === 1;
  offset += 1;
  const decimals = data.readUInt8(offset);
  offset += 1;

  const nameResult = readAnchorString(data, offset);
  const symbolResult = nameResult ? readAnchorString(data, nameResult.nextOffset) : null;
  const isinResult = symbolResult ? readAnchorString(data, symbolResult.nextOffset) : null;

  return {
    paused,
    decimals,
    name: nameResult?.value || "",
    symbol: symbolResult?.value || "",
    isin: isinResult?.value || "",
  };
}

function readAnchorString(data: Buffer, offset: number) {
  if (data.length < offset + 4) return null;
  const len = data.readUInt32LE(offset);
  const start = offset + 4;
  const end = start + len;
  if (data.length < end) return null;
  return { value: data.subarray(start, end).toString("utf8"), nextOffset: end };
}

function parseOwnerState(account: AccountInfo<Buffer>) {
  const data = account.data;
  if (data.length < 8 + 32) return null;
  return new PublicKey(data.subarray(8, 40));
}

function parseComplianceState(account: AccountInfo<Buffer>) {
  const data = account.data;
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return [];

  const moduleCount = data.readUInt32LE(offset);
  offset += 4;

  const modules: PublicKey[] = [];
  for (let index = 0; index < moduleCount; index += 1) {
    if (data.length < offset + 32) break;
    modules.push(readPubkey(data, offset));
    offset += 32;
  }

  return modules;
}

function parseClaimTopicsState(account: AccountInfo<Buffer>) {
  const data = account.data;
  let offset = 8 + 32 + 32;
  if (data.length < offset + 4) return [];
  const topicCount = data.readUInt32LE(offset);
  offset += 4;

  const topics: string[] = [];
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) break;
    topics.push(data.readBigUInt64LE(offset).toString());
    offset += 8;
  }
  return topics;
}

function parseIssuerEntry(account: AccountInfo<Buffer>) {
  const data = account.data;
  let offset = 8;
  if (data.length < ISSUER_ENTRY_SIZE) return null;

  const issuerFid = readPubkey(data, offset);
  offset += 32;
  offset += 32; // tir

  const topicCount = data.readUInt32LE(offset);
  offset += 4;

  const topics: string[] = [];
  for (let index = 0; index < topicCount; index += 1) {
    if (data.length < offset + 8) return null;
    topics.push(data.readBigUInt64LE(offset).toString());
    offset += 8;
  }

  if (data.length < offset + 1 + 4) return null;
  const active = data.readUInt8(offset) === 1;
  offset += 1;

  const labelLength = data.readUInt32LE(offset);
  offset += 4;
  if (data.length < offset + labelLength) return null;
  const label = data.subarray(offset, offset + labelLength).toString("utf8");

  return { issuerFid, topics, active, label };
}

function getCtrProgramId() {
  return new PublicKey(
    process.env.FRACKS_CTR || "8MuWrtbZ1zPzrDhSKPjDd78SMQAMtBuprPnc1Zam1Gig",
  );
}

function getTirProgramId() {
  return new PublicKey(
    process.env.FRACKS_TIR || "9bgANehpsEDdgyo5DwpY36wmnPdpCihSiAP9TLoBBf4L",
  );
}

const MODULE_PROGRAM_IDS = {
  maxInvestors: () =>
    new PublicKey(
      process.env.MOD_MAX_INVESTORS || "2zfQv7RxmL5BAgXXFagZXBNby4Q41YGH6hnSJAcsXQeU",
    ).toBase58(),
  countryRestrict: () =>
    new PublicKey(
      process.env.MOD_COUNTRY_RESTRICT || "4ChDAU375yPJXZLG5XqtbbKdirAr3xHU5vnhppUjgu2d",
    ).toBase58(),
  maxBalance: () =>
    new PublicKey(
      process.env.MOD_MAX_BALANCE || "HEjNS1GC9nffSdXbi6aQ9WNQBNFyJQBGUshyrSeLpE9j",
    ).toBase58(),
  maxTransfer: () =>
    new PublicKey(
      process.env.MOD_MAX_TRANSFER || "4gJbGvgnBhJ91gByKNo7eEVmCbsUkK5opyeo3M1VEJsy",
    ).toBase58(),
  lockup: () =>
    new PublicKey(
      process.env.MOD_LOCKUP || "EvDVqTUjs3ZsAUfPQdyVskYCzoPTbWybF5tcBtWYfAuz",
    ).toBase58(),
  dailyLimit: () =>
    new PublicKey(
      process.env.MOD_DAILY_LIMIT || "5dfHskP5MijaDY2gYsE44CPAuomt1vWgbPdGi62cquoT",
    ).toBase58(),
  supplyCap: () =>
    new PublicKey(
      process.env.MOD_SUPPLY_CAP || "6tfb66btx776wdsPS5EHDTwWnvPSLJQje7gFQ4EDGxGc",
    ).toBase58(),
  countryCap: () =>
    new PublicKey(
      process.env.MOD_COUNTRY_CAP || "EcLffdKdSsCpNczazKsSeRw7FCN6vVjKAEMH5CZGBndr",
    ).toBase58(),
};

function parseComplianceModuleParams(
  account: AccountInfo<Buffer>,
  decimals: number,
): Record<string, string> | null {
  const data = account.data;
  const programId = account.owner.toBase58();

  if (programId === MODULE_PROGRAM_IDS.countryRestrict()) {
    const countries = readU16Vector(data, 72);
    return countries.length > 0 ? { allowed_countries: countries.join(",") } : null;
  }

  if (programId === MODULE_PROGRAM_IDS.countryCap()) {
    const caps = readCountryCapVector(data, 104);
    return caps.length > 0 ? { country_caps: caps.join(",") } : null;
  }

  if (programId === MODULE_PROGRAM_IDS.maxBalance() && data.length >= 80) {
    return { max_balance: formatBaseUnits(data.readBigUInt64LE(72), decimals) };
  }

  if (programId === MODULE_PROGRAM_IDS.maxTransfer() && data.length >= 80) {
    return { max_amount: formatBaseUnits(data.readBigUInt64LE(72), decimals) };
  }

  if (programId === MODULE_PROGRAM_IDS.lockup() && data.length >= 80) {
    return { lockup_end: data.readBigInt64LE(72).toString() };
  }

  if (programId === MODULE_PROGRAM_IDS.maxInvestors() && data.length >= 112) {
    return { max_investors: data.readBigUInt64LE(104).toString() };
  }

  if (programId === MODULE_PROGRAM_IDS.dailyLimit() && data.length >= 112) {
    return { daily_limit: formatBaseUnits(data.readBigUInt64LE(104), decimals) };
  }

  if (programId === MODULE_PROGRAM_IDS.supplyCap() && data.length >= 112) {
    return { max_supply: formatBaseUnits(data.readBigUInt64LE(104), decimals) };
  }

  return null;
}

function readU16Vector(data: Buffer, offset: number) {
  if (data.length < offset + 4) return [];
  const count = data.readUInt32LE(offset);
  offset += 4;

  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.length < offset + 2) break;
    values.push(data.readUInt16LE(offset));
    offset += 2;
  }
  return values;
}

function readCountryCapVector(data: Buffer, offset: number) {
  if (data.length < offset + 4) return [];
  const count = data.readUInt32LE(offset);
  offset += 4;

  const caps: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (data.length < offset + 10) break;
    const country = data.readUInt16LE(offset);
    offset += 2;
    const cap = data.readBigUInt64LE(offset);
    offset += 8;
    caps.push(`${country}:${cap.toString()}`);
  }
  return caps;
}

function formatBaseUnits(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(Math.max(0, decimals));
  if (scale === 1n) return value.toString();

  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();

  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
}

function deriveOwnerStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  const tokenProgram = new PublicKey(
    process.env.FRACKS_TOKEN_PROGRAM || "6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj",
  );

  return PublicKey.findProgramAddressSync(
    [Buffer.from("owner"), tokenMint.toBuffer()],
    tokenProgram,
  );
}
