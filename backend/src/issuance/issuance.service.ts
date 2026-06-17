import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WorkflowsService } from "../workflows/workflows.service";
import { CreateIssuanceDto } from "./dto/create-issuance.dto";
import { UpdateIssuanceStatusDto } from "./dto/update-issuance-status.dto";

@Injectable()
export class IssuanceService {
  constructor(
    private prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  findAll(filters?: { tokenContract?: string; status?: string }) {
    const { tokenContract, status } = filters || {};

    return this.prisma.issuanceRequest.findMany({
      where: {
        ...(tokenContract ? { tokenContract } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
  }

  create(dto: CreateIssuanceDto) {
    return this.prisma.issuanceRequest.create({ data: dto });
  }

  async updateStatus(id: string, dto: UpdateIssuanceStatusDto) {
    const existing = await this.prisma.issuanceRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException("Issuance request not found");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.issuanceRequest.update({
        where: { id },
        data: { status: dto.status, txHash: dto.txHash },
      });
      await this.workflows.recordWithClient(tx, {
        entityType: "IssuanceRequest",
        entityId: id,
        fromStatus: existing.status,
        toStatus: dto.status,
        txHash: dto.txHash || null,
      });
      return updated;
    });
  }

  async markMinted(id: string, txHash: string) {
    const existing = await this.prisma.issuanceRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException("Issuance request not found");
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.issuanceRequest.update({
        where: { id },
        data: { status: "MINTED", txHash },
      });
      await this.workflows.recordWithClient(tx, {
        entityType: "IssuanceRequest",
        entityId: id,
        fromStatus: existing.status,
        toStatus: "MINTED",
        txHash,
      });
      return updated;
    });
  }
}
