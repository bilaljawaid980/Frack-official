import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

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

  createDeployed(dto: CreateAssetDto) {
    return this.prisma.asset.upsert({
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
