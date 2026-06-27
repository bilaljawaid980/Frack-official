import { randomUUID } from "crypto";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { computeFactoryAssetId } from "../custody/custody.service";
import { AssetDocumentsService } from "../asset-documents/asset-documents.service";
import { CreateAssetRequestDto } from "./dto/create-asset-request.dto";
import { UpdateAssetRequestStatusDto } from "./dto/update-asset-request-status.dto";

const ASSET_REQUEST_STATUSES = new Set([
  "PENDING_REVIEW",
  "APPROVED",
  "REJECTED",
  "DEPLOYED",
  "CANCELED",
]);

@Injectable()
export class AssetRequestsService {
  constructor(
    private prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly assetDocuments: AssetDocumentsService,
  ) {}

  findAll(status?: string) {
    return this.prisma.assetRequest.findMany({
      where: status ? { status } : undefined,
      include: { assetDocuments: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async findOne(id: string) {
    const request = await this.prisma.assetRequest.findUnique({
      where: { id },
      include: { assetDocuments: { where: { deletedAt: null }, orderBy: { uploadedAt: "desc" } } },
    });
    if (!request) throw new NotFoundException("Asset request not found");
    return request;
  }

  async create(dto: CreateAssetRequestDto) {
    const id = randomUUID();
    const request = await this.prisma.assetRequest.create({
      data: {
        id,
        factoryAssetId: computeFactoryAssetId(id),
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

    await this.assetDocuments.createManyForAssetRequest(request.id, dto.documents, dto.issuerWallet);
    return this.findOne(request.id);
  }

  async updateStatus(id: string, dto: UpdateAssetRequestStatusDto) {
    if (!ASSET_REQUEST_STATUSES.has(dto.status)) {
      throw new BadRequestException("Invalid asset request status");
    }

    const existing = await this.findOne(id);
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.assetRequest.update({
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
      if (dto.status === "DEPLOYED" && dto.deployedAssetId && updated.factoryAssetId) {
        await tx.$executeRaw`
          UPDATE "asset_valuer_assignments"
          SET
            "deployed_asset_id" = ${dto.deployedAssetId},
            "token_contract" = ${dto.deployedAssetId},
            "asset_registry_address" = ${null},
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "asset_request_id" = ${id}
            AND "token_contract" IS NULL
        `;
        await tx.$executeRaw`
          UPDATE "asset_valuations"
          SET
            "deployed_asset_id" = ${dto.deployedAssetId},
            "token_contract" = ${dto.deployedAssetId},
            "updated_at" = CURRENT_TIMESTAMP
          WHERE "asset_request_id" = ${id}
            AND "token_contract" IS NULL
        `;
      }
      await this.workflows.recordWithClient(tx, {
        entityType: "AssetRequest",
        entityId: id,
        fromStatus: existing.status,
        toStatus: dto.status,
        actorWallet: dto.reviewedBy || null,
        txHash: dto.txHash || null,
        reason: dto.rejectionReason || null,
      });
      return updated;
    });
  }
}
