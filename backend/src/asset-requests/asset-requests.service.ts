import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateAssetRequestDto } from "./dto/create-asset-request.dto";
import { UpdateAssetRequestStatusDto } from "./dto/update-asset-request-status.dto";

const ASSET_REQUEST_STATUSES = new Set([
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "DEPLOYED",
]);

@Injectable()
export class AssetRequestsService {
  constructor(private prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.assetRequest.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.assetRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException("Asset request not found");
    return request;
  }

  create(dto: CreateAssetRequestDto) {
    return this.prisma.assetRequest.create({
      data: {
        issuerWallet: dto.issuerWallet,
        legalOwner: dto.legalOwner || dto.issuerWallet,
        referenceId: dto.referenceId,
        name: dto.name,
        symbol: dto.symbol.toUpperCase(),
        description: dto.description,
        assetType: dto.assetType,
        currency: dto.currency,
        location: dto.location,
        underlyingValue: dto.underlyingValue,
        totalSupply: dto.totalSupply,
        decimals: dto.decimals,
        initialPrice: dto.initialPrice,
        claimTopics: dto.claimTopics ?? [],
        complianceModules: dto.complianceModules ?? [],
        trustedIssuers: dto.trustedIssuers as Prisma.InputJsonValue,
        documents: dto.documents as Prisma.InputJsonValue,
        metadata: dto.metadata as Prisma.InputJsonValue,
        status: "PENDING_REVIEW",
      },
    });
  }

  async updateStatus(id: string, dto: UpdateAssetRequestStatusDto) {
    if (!ASSET_REQUEST_STATUSES.has(dto.status)) {
      throw new BadRequestException("Invalid asset request status");
    }

    await this.findOne(id);
    const now = new Date();

    return this.prisma.assetRequest.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedAt: dto.status === "PENDING_REVIEW" ? null : now,
        reviewedBy: dto.reviewedBy,
        rejectionReason:
          dto.status === "REJECTED" ? dto.rejectionReason || null : null,
        deployedAssetId: dto.deployedAssetId,
        txHash: dto.txHash,
      },
    });
  }
}
