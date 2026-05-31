import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenTransferRequestDto } from './dto/create-token-transfer-request.dto';
import { UpdateTokenTransferRequestDto } from './dto/update-token-transfer-request.dto';

const CLOSED_STATUSES = ['TRANSFERRED', 'REJECTED', 'CANCELLED'];
const VALID_STATUSES = new Set([
  'DRAFT',
  'ACTION_REQUIRED_RECIPIENT_FID',
  'PENDING_KYC',
  'PENDING_AML',
  'PENDING_ISSUER_WHITELIST',
  'PENDING_ISSUER_ACTIVATION',
  'READY_TO_TRANSFER',
  'TRANSFER_SIMULATION_FAILED',
  'TRANSFERRED',
  'REJECTED',
  'CANCELLED',
  'SENDER_NOT_ELIGIBLE',
  'SENDER_FROZEN',
  'SENDER_CLAIM_EXPIRED',
  'INSUFFICIENT_TRANSFERABLE_BALANCE',
]);

@Injectable()
export class TokenTransferRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  private rowSelect() {
    return Prisma.sql`
      id,
      asset_id as "assetId",
      "tokenContract",
      "fromWallet",
      "toWallet",
      amount,
      status,
      required_claim_topics as "requiredClaimTopics",
      "kycProvider",
      "amlProvider",
      "issuerWallet",
      "preflightFailure",
      "simulationError",
      "transferTxHash",
      "transferredAt",
      "rejectionReason",
      "rejectedAt",
      "rejectedBy",
      "createdAt",
      "updatedAt"
    `;
  }

  async create(data: CreateTokenTransferRequestDto) {
    const status = data.status || 'DRAFT';
    if (!VALID_STATUSES.has(status)) {
      throw new ConflictException('Invalid token transfer request status.');
    }

    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TokenTransferRequest"
      WHERE "tokenContract" = ${data.tokenContract}
        AND "fromWallet" = ${data.fromWallet}
        AND "toWallet" = ${data.toWallet}
        AND status NOT IN (${Prisma.join(CLOSED_STATUSES)})
      LIMIT 1
    `;

    if (duplicate.length > 0) {
      throw new ConflictException('An open transfer request already exists for this sender, recipient, and token.');
    }

    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TokenTransferRequest" (
        id,
        asset_id,
        "tokenContract",
        "fromWallet",
        "toWallet",
        amount,
        status,
        required_claim_topics,
        "kycProvider",
        "amlProvider",
        "issuerWallet",
        "preflightFailure",
        "simulationError",
        "transferTxHash",
        "transferredAt",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${data.assetId || null},
        ${data.tokenContract},
        ${data.fromWallet},
        ${data.toWallet},
        ${data.amount},
        ${status},
        ${data.requiredClaimTopics || []},
        ${data.kycProvider || null},
        ${data.amlProvider || null},
        ${data.issuerWallet || null},
        ${data.preflightFailure || null},
        ${data.simulationError || null},
        ${data.transferTxHash || null},
        ${status === 'TRANSFERRED' ? new Date() : null},
        NOW()
      )
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }

  async findAll(query: Record<string, string>) {
    const filters: Prisma.Sql[] = [];
    if (query.fromWallet) filters.push(Prisma.sql`"fromWallet" = ${query.fromWallet}`);
    if (query.toWallet) filters.push(Prisma.sql`"toWallet" = ${query.toWallet}`);
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
      FROM "TokenTransferRequest"
      ${where}
      ORDER BY "createdAt" DESC
    `;
  }

  async findOne(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TokenTransferRequest"
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Token transfer request not found');
    return rows[0];
  }

  async updateStatus(id: string, data: UpdateTokenTransferRequestDto) {
    await this.findOne(id);
    const status = data.status;
    if (!status || !VALID_STATUSES.has(status)) {
      throw new ConflictException('Invalid token transfer request status.');
    }

    const updates: Prisma.Sql[] = [
      Prisma.sql`status = ${status}`,
      Prisma.sql`"updatedAt" = NOW()`,
    ];

    if (data.preflightFailure !== undefined) updates.push(Prisma.sql`"preflightFailure" = ${data.preflightFailure}`);
    if (data.simulationError !== undefined) updates.push(Prisma.sql`"simulationError" = ${data.simulationError}`);
    if (status === 'TRANSFERRED') {
      updates.push(Prisma.sql`"transferTxHash" = ${data.transferTxHash || null}`);
      updates.push(Prisma.sql`"transferredAt" = NOW()`);
    }
    if (status === 'REJECTED') {
      updates.push(Prisma.sql`"rejectionReason" = ${data.rejectionReason || 'Rejected'}`);
      updates.push(Prisma.sql`"rejectedAt" = NOW()`);
      updates.push(Prisma.sql`"rejectedBy" = ${data.reviewerWallet || null}`);
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenTransferRequest"
      SET ${Prisma.join(updates)}
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;

    return rows[0];
  }
}
