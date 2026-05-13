import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssetDto } from "./dto/create-asset.dto";

@Injectable()
export class AssetsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.asset.findMany({ orderBy: { createdAt: "desc" } });
  }

  create(dto: CreateAssetDto) {
    return this.prisma.asset.create({ data: dto });
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
}
