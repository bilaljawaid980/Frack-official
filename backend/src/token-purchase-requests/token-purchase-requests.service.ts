import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenPurchaseRequestDto } from './dto/create-token-purchase-request.dto';
import { UpdateTokenPurchaseRequestDto } from './dto/update-token-purchase-request.dto';

const CLOSED_STATUSES = ['REJECTED', 'MINTED'];
const VALID_STATUSES = new Set([
  'SUBMITTED',
  'PENDING_KYC',
  'PENDING_AML',
  'PENDING_ISSUER_REVIEW',
  'APPROVED_FOR_MINT',
  'ACTION_REQUIRED_INVESTOR_IDENTITY',
  'REJECTED',
  'MINTED',
]);

@Injectable()
export class TokenPurchaseRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  private getInitialStatus(data: CreateTokenPurchaseRequestDto) {
    if (data.investorFidRegistered === false) {
      return 'ACTION_REQUIRED_INVESTOR_IDENTITY';
    }

    const topics = new Set((data.requiredClaimTopics || []).map(String));
    if (topics.has('1') && data.kycProvider) return 'PENDING_KYC';
    if (topics.has('2') && data.amlProvider) return 'PENDING_AML';
    return 'PENDING_ISSUER_REVIEW';
  }

  private getResumeStatus(request: Record<string, unknown>) {
    const topics = new Set(
      (Array.isArray(request.requiredClaimTopics)
        ? request.requiredClaimTopics
        : []
      ).map(String),
    );

    if (topics.has('1') && request.kycProvider) return 'PENDING_KYC';
    if (topics.has('2') && request.amlProvider) return 'PENDING_AML';
    return 'PENDING_ISSUER_REVIEW';
  }

  private rowSelect() {
    return Prisma.sql`
      id,
      asset_id as "assetId",
      "tokenContract",
      "investorWallet",
      amount,
      "fullName",
      email,
      nationality,
      country,
      "idDocumentUrl",
      "proofOfAddressUrl",
      "kycProvider",
      "amlProvider",
      "issuerWallet",
      required_claim_topics as "requiredClaimTopics",
      documents,
      status,
      "kycApprovedAt",
      "kycApprovedBy",
      "kycClaimTxHash",
      "amlApprovedAt",
      "amlApprovedBy",
      "amlClaimTxHash",
      "issuerApprovedAt",
      "issuerApprovedBy",
      "mintTxHash",
      "mintedAt",
      "rejectionReason",
      "rejectedAt",
      "rejectedBy",
      "createdAt",
      "updatedAt"
    `;
  }

  async create(data: CreateTokenPurchaseRequestDto) {
    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TokenPurchaseRequest"
      WHERE "tokenContract" = ${data.tokenContract}
        AND "investorWallet" = ${data.investorWallet}
        AND status NOT IN (${Prisma.join(CLOSED_STATUSES)})
      LIMIT 1
    `;

    if (duplicate.length > 0) {
      throw new ConflictException(
        'An open purchase request already exists for this investor and token.',
      );
    }

    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TokenPurchaseRequest" (
        id,
        asset_id,
        "tokenContract",
        "investorWallet",
        "issuerWallet",
        "kycProvider",
        "amlProvider",
        amount,
        "fullName",
        email,
        nationality,
        country,
        "idDocumentUrl",
        "proofOfAddressUrl",
        required_claim_topics,
        documents,
        status,
        "updatedAt"
      )
      VALUES (
        ${id},
        ${data.assetId || null},
        ${data.tokenContract},
        ${data.investorWallet},
        ${data.issuerWallet},
        ${data.kycProvider || null},
        ${data.amlProvider || null},
        ${data.amount},
        ${data.fullName || null},
        ${data.email || null},
        ${data.nationality || null},
        ${data.country || null},
        ${data.idDocumentUrl || null},
        ${data.proofOfAddressUrl || null},
        ${data.requiredClaimTopics || []},
        ${data.documents ? JSON.stringify(data.documents) : null}::jsonb,
        ${this.getInitialStatus(data)},
        NOW()
      )
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async findAll(query: {
    investorWallet?: string;
    kycProvider?: string;
    amlProvider?: string;
    issuerWallet?: string;
    status?: string;
    tokenContract?: string;
  }) {
    const filters: Prisma.Sql[] = [];
    if (query.investorWallet) filters.push(Prisma.sql`"investorWallet" = ${query.investorWallet}`);
    if (query.kycProvider) filters.push(Prisma.sql`"kycProvider" = ${query.kycProvider}`);
    if (query.amlProvider) filters.push(Prisma.sql`"amlProvider" = ${query.amlProvider}`);
    if (query.issuerWallet) filters.push(Prisma.sql`"issuerWallet" = ${query.issuerWallet}`);
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    if (query.tokenContract) filters.push(Prisma.sql`"tokenContract" = ${query.tokenContract}`);

    const where =
      filters.length > 0
        ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`
        : Prisma.empty;

    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TokenPurchaseRequest"
      ${where}
      ORDER BY "createdAt" DESC
    `;
  }

  async findOne(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TokenPurchaseRequest"
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Token purchase request not found');
    return rows[0];
  }

  async update(id: string, data: UpdateTokenPurchaseRequestDto) {
    const status = data.status;
    if (status) return this.updateStatus(id, data);
    await this.findOne(id);
    return this.findOne(id);
  }

  async updateStatus(id: string, data: UpdateTokenPurchaseRequestDto) {
    const existing = await this.findOne(id);
    const currentStatus = String(existing.status);
    const status = data.status;
    if (!status || !VALID_STATUSES.has(status)) {
      throw new ConflictException('Invalid token purchase request status.');
    }

    const now = new Date();
    const updateFragments: Prisma.Sql[] = [
      Prisma.sql`status = ${status}`,
      Prisma.sql`"updatedAt" = NOW()`,
    ];

    if (status === 'PENDING_AML') {
      updateFragments.push(Prisma.sql`"kycApprovedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"kycApprovedBy" = ${data.reviewerWallet || null}`);
      updateFragments.push(Prisma.sql`"kycClaimTxHash" = ${data.claimTxHash || null}`);
    }

    if (status === 'PENDING_ISSUER_REVIEW') {
      if (currentStatus === 'PENDING_KYC') {
        updateFragments.push(Prisma.sql`"kycApprovedAt" = ${now}`);
        updateFragments.push(Prisma.sql`"kycApprovedBy" = ${data.reviewerWallet || null}`);
        updateFragments.push(Prisma.sql`"kycClaimTxHash" = ${data.claimTxHash || null}`);
      }
      if (currentStatus === 'PENDING_AML') {
        updateFragments.push(Prisma.sql`"amlApprovedAt" = ${now}`);
        updateFragments.push(Prisma.sql`"amlApprovedBy" = ${data.reviewerWallet || null}`);
        updateFragments.push(Prisma.sql`"amlClaimTxHash" = ${data.claimTxHash || null}`);
      }
    }

    if (status === 'APPROVED_FOR_MINT') {
      updateFragments.push(Prisma.sql`"issuerApprovedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"issuerApprovedBy" = ${data.reviewerWallet || null}`);
    }

    if (status === 'MINTED') {
      updateFragments.push(Prisma.sql`"mintedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"mintTxHash" = ${data.mintTxHash || null}`);
      updateFragments.push(Prisma.sql`"issuerApprovedBy" = ${data.reviewerWallet || null}`);
    }

    if (status === 'REJECTED') {
      updateFragments.push(Prisma.sql`"rejectedAt" = ${now}`);
      updateFragments.push(Prisma.sql`"rejectedBy" = ${data.reviewerWallet || null}`);
      updateFragments.push(Prisma.sql`"rejectionReason" = ${data.rejectionReason || 'Rejected'}`);
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenPurchaseRequest"
      SET ${Prisma.join(updateFragments)}
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async resumeAfterIdentity(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'ACTION_REQUIRED_INVESTOR_IDENTITY') {
      return existing;
    }

    const nextStatus = this.getResumeStatus(existing);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenPurchaseRequest"
      SET status = ${nextStatus}, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.tokenPurchaseRequest.delete({
      where: { id },
    });
  }
}
