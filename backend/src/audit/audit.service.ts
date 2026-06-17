import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export type RecordAuditLogInput = {
  actorUserId?: string | null;
  actorWallet?: string | null;
  organizationId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  requestId?: string | null;
  correlationId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  result: string;
  failureCode?: string | null;
  environment?: string;
  network?: string;
};

function hash(value?: string | null) {
  if (!value) return null;
  return createHash('sha256').update(value).digest('hex');
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordAuditLogInput) {
    return this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId || null,
        actorWallet: input.actorWallet || null,
        organizationId: input.organizationId || null,
        action: input.action,
        resourceType: input.resourceType || null,
        resourceId: input.resourceId || null,
        requestId: input.requestId || null,
        correlationId: input.correlationId || null,
        ipAddressHash: hash(input.ipAddress),
        userAgentHash: hash(input.userAgent),
        before: input.before || undefined,
        after: input.after || undefined,
        result: input.result,
        failureCode: input.failureCode || null,
        environment: input.environment || process.env.APP_ENVIRONMENT || 'sandbox',
        network: input.network || process.env.SOLANA_CLUSTER || 'devnet',
      },
    });
  }
}
