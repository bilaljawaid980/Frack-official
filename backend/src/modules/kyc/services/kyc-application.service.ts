import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { KycApplication } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { WorkflowsService } from "../../../workflows/workflows.service";
import {
  CreateKycApplicationDto,
  ApproveKycApplicationDto,
  RejectKycApplicationDto,
  UpdateKycApplicationDto,
  KycApplicationStatus,
} from "../dto/kyc-application.dto";

@Injectable()
export class KycApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
  ) {}

  async create(dto: CreateKycApplicationDto): Promise<KycApplication> {
    const existing = await this.prisma.kycApplication.findUnique({
      where: { walletAddress: dto.walletAddress },
    });

    if (existing) {
      if (existing.status === KycApplicationStatus.REJECTED) {
        const updated = await this.prisma.kycApplication.update({
          where: { id: existing.id },
          data: {
            ...dto,
            status: KycApplicationStatus.PENDING,
            submittedAt: new Date(),
            reviewedAt: null,
            reviewedBy: null,
            rejectionReason: null,
          },
        });
        await this.workflows.record({
          entityType: "KycApplication",
          entityId: existing.id,
          fromStatus: existing.status,
          toStatus: KycApplicationStatus.PENDING,
          reason: "KYC resubmitted",
        });
        return updated;
      }

      throw new ConflictException(
        `KYC application already exists for wallet ${dto.walletAddress} with status ${existing.status}`
      );
    }

    return this.prisma.kycApplication.create({
      data: {
        ...dto,
        status: KycApplicationStatus.PENDING,
      },
    });
  }

  async findAll(
    status?: KycApplicationStatus,
    limit: number = 50,
    offset: number = 0,
    role?: string
  ): Promise<KycApplication[]> {
    let walletAddresses: string[] | undefined = undefined;

    if (role) {
      const users = await this.prisma.user.findMany({
        where: { requestedRole: role, walletAddress: { not: null } },
        select: { walletAddress: true }
      });
      walletAddresses = users.map(u => u.walletAddress as string);
    }

    const whereClause: any = {};
    if (status) whereClause.status = status;
    if (walletAddresses) whereClause.walletAddress = { in: walletAddresses };

    return this.prisma.kycApplication.findMany({
      where: whereClause,
      orderBy: { submittedAt: "desc" },
      skip: offset,
      take: limit,
    });
  }

  async findOne(id: string): Promise<KycApplication> {
    const application = await this.prisma.kycApplication.findUnique({
      where: { id },
    });

    if (!application) {
      throw new NotFoundException(`KYC application ${id} not found`);
    }

    return application;
  }

  async findByWallet(walletAddress: string): Promise<KycApplication | null> {
    return this.prisma.kycApplication.findUnique({
      where: { walletAddress },
    });
  }

  async approve(
    id: string,
    dto: ApproveKycApplicationDto
  ): Promise<KycApplication> {
    const application = await this.findOne(id);

    if (
      application.status !== KycApplicationStatus.PENDING &&
      application.status !== KycApplicationStatus.UNDER_REVIEW
    ) {
      throw new BadRequestException(
        `Cannot approve application with status ${application.status}`
      );
    }

    const updatedApp = await this.prisma.kycApplication.update({
      where: { id },
      data: {
        status: KycApplicationStatus.APPROVED,
        reviewedAt: new Date(),
        reviewedBy: dto.reviewedBy,
        notes: dto.notes,
        onchainIdAddress: dto.onchainIdAddress,
        onchainIdCreated: !!dto.onchainIdAddress,
      },
    });

    await this.workflows.record({
      entityType: "KycApplication",
      entityId: id,
      fromStatus: application.status,
      toStatus: KycApplicationStatus.APPROVED,
      actorWallet: dto.reviewedBy,
      txHash: dto.onchainIdAddress || null,
      reason: dto.notes || null,
    });

    const user = await this.prisma.user.findUnique({
      where: { walletAddress: application.walletAddress },
    });

    if (user && user.requestedRole) {
      const newRoles = user.roles.includes(user.requestedRole)
        ? user.roles
        : [...user.roles, user.requestedRole];

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          roleStatus: "APPROVED",
          roles: newRoles,
        },
      });
    }

    return updatedApp;
  }

  async reject(
    id: string,
    dto: RejectKycApplicationDto
  ): Promise<KycApplication> {
    const application = await this.findOne(id);

    if (application.status === KycApplicationStatus.APPROVED) {
      throw new BadRequestException("Cannot reject an approved application");
    }

    const updated = await this.prisma.kycApplication.update({
      where: { id },
      data: {
        status: KycApplicationStatus.REJECTED,
        reviewedAt: new Date(),
        reviewedBy: dto.reviewedBy,
        rejectionReason: dto.rejectionReason,
        notes: dto.notes,
      },
    });

    await this.workflows.record({
      entityType: "KycApplication",
      entityId: id,
      fromStatus: application.status,
      toStatus: KycApplicationStatus.REJECTED,
      actorWallet: dto.reviewedBy,
      reason: dto.rejectionReason || dto.notes || null,
    });

    return updated;
  }

  async update(
    id: string,
    dto: UpdateKycApplicationDto
  ): Promise<KycApplication> {
    const existing = await this.findOne(id);

    const updated = await this.prisma.kycApplication.update({
      where: { id },
      data: dto,
    });

    if (dto.status && dto.status !== existing.status) {
      await this.workflows.record({
        entityType: "KycApplication",
        entityId: id,
        fromStatus: existing.status,
        toStatus: dto.status,
        reason: dto.notes || null,
      });
    }

    return updated;
  }

  async markOnchainIdCreated(
    id: string,
    onchainIdAddress: string
  ): Promise<KycApplication> {
    return this.prisma.kycApplication.update({
      where: { id },
      data: {
        onchainIdAddress,
        onchainIdCreated: true,
      },
    });
  }

  async getPendingCount(): Promise<number> {
    return this.prisma.kycApplication.count({
      where: { status: KycApplicationStatus.PENDING },
    });
  }

  async getStatistics() {
    const [total, pending, approved, rejected, underReview] = await Promise.all(
      [
        this.prisma.kycApplication.count(),
        this.prisma.kycApplication.count({
          where: { status: KycApplicationStatus.PENDING },
        }),
        this.prisma.kycApplication.count({
          where: { status: KycApplicationStatus.APPROVED },
        }),
        this.prisma.kycApplication.count({
          where: { status: KycApplicationStatus.REJECTED },
        }),
        this.prisma.kycApplication.count({
          where: { status: KycApplicationStatus.UNDER_REVIEW },
        }),
      ]
    );

    return {
      total,
      pending,
      approved,
      rejected,
      underReview,
    };
  }
}
