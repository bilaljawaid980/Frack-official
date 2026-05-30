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
      const metadata = await this.buildIndexedMetadata(deployment.tokenMint);

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
    };
  }

  private async buildIndexedMetadata(tokenMint: PublicKey) {
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

    if (claimTopics.length === 0 && trustedIssuers.length === 0) {
      return null;
    }

    return {
      claimTopics,
      trustedIssuers,
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
  offset += 32; // compliance_state
  const deployedAt = data.readBigInt64LE(offset);

  return {
    deploymentId,
    issuer,
    tokenMint,
    tokenState,
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

function deriveOwnerStatePDA(tokenMint: PublicKey): [PublicKey, number] {
  const tokenProgram = new PublicKey(
    process.env.FRACKS_TOKEN_PROGRAM || "6Naj8HsuNdUJQyyzmPssm1mZRDF7F5VMQ91n9QyMoyGj",
  );

  return PublicKey.findProgramAddressSync(
    [Buffer.from("owner"), tokenMint.toBuffer()],
    tokenProgram,
  );
}
