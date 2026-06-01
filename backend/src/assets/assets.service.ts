import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { BlockchainTransactionsService } from "../blockchain-transactions/blockchain-transactions.service";

@Injectable()
export class AssetsService {
  constructor(
    private prisma: PrismaService,
    private blockchainTransactions: BlockchainTransactionsService
  ) {}

  findAll() {
    return this.prisma.asset.findMany({
      where: {
        OR: [
          { lifecycleState: "PENDING_APPROVAL" },
          { tokenContract: { not: { startsWith: "zig1" } } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
  }

  create(dto: CreateAssetDto) {
    return this.prisma.asset.create({ data: dto });
  }

  async createDeployed(dto: CreateAssetDto) {
    const asset = await this.prisma.asset.upsert({
      where: { tokenContract: dto.tokenContract },
      update: {
        factoryAssetId: dto.factoryAssetId,
        referenceId: dto.referenceId,
        name: dto.name,
        symbol: dto.symbol,
        description: dto.description,
        issuerWallet: dto.issuerWallet,
        legalOwner: dto.legalOwner,
        deployedAt: dto.deployedAt ? new Date(dto.deployedAt) : new Date(),
        lifecycleState: dto.lifecycleState || "ISSUED",
        metadata: dto.metadata,
      },
      create: {
        ...dto,
        deployedAt: dto.deployedAt ? new Date(dto.deployedAt) : new Date(),
        lifecycleState: dto.lifecycleState || "ISSUED",
      },
    });

    const metadata =
      dto.metadata && typeof dto.metadata === "object" && !Array.isArray(dto.metadata)
        ? (dto.metadata as Record<string, unknown>)
        : {};
    if (typeof metadata.txHash === "string" && metadata.txHash) {
      await this.blockchainTransactions.record({
        txHash: metadata.txHash,
        actionType: "TOKEN_DEPLOYED",
        actorWallet: dto.issuerWallet,
        entityType: "asset",
        entityId: asset.id,
        assetId: asset.id,
        tokenContract: dto.tokenContract,
        occurredAt: dto.deployedAt,
      });
    }

    return asset;
  }

  async apply(dto: any, issuerWallet: string) {
    const { assetDetails, complianceRequirements, tokenDetails } = dto;
    const { v4: uuidv4 } = require("uuid");

    return this.prisma.asset.create({
      data: {
        tokenContract: `pending-${uuidv4()}`,
        name: assetDetails.name,
        symbol: assetDetails.symbol,
        description: assetDetails.description,
        issuerWallet,
        legalOwner: assetDetails.legalOwner || issuerWallet,
        lifecycleState: "PENDING_APPROVAL",
        metadata: {
          assetType: assetDetails.assetType,
          underlyingValue: assetDetails.underlyingValue,
          totalSupply: assetDetails.totalSupply,
          location: assetDetails.location,
          currency: assetDetails.currency,
          tokenDetails,
          complianceRequirements,
        },
      },
    });
  }

  remove(id: string) {
    return this.prisma.asset.delete({
      where: { id },
    });
  }

  update(id: string, dto: UpdateAssetDto) {
    const { deployedAt, ...rest } = dto;
    return this.prisma.asset.update({
      where: { id },
      data: {
        ...rest,
        ...(deployedAt ? { deployedAt: new Date(deployedAt) } : {}),
      },
    });
  }
}
