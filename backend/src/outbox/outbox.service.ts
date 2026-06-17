import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type EnqueueOutboxEventInput = {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
  availableAt?: Date | string;
  environment?: string;
  network?: string;
};

@Injectable()
export class OutboxService {
  constructor(private readonly prisma: PrismaService) {}

  enqueue(input: EnqueueOutboxEventInput) {
    return this.prisma.outboxEvent.create({
      data: {
        eventType: input.eventType,
        aggregateType: input.aggregateType,
        aggregateId: input.aggregateId,
        payload: input.payload,
        availableAt: input.availableAt ? new Date(input.availableAt) : undefined,
        environment: input.environment || process.env.APP_ENVIRONMENT || 'sandbox',
        network: input.network || process.env.SOLANA_CLUSTER || 'devnet',
      },
    });
  }

  async nextPending(limit = 10) {
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT *
      FROM "OutboxEvent"
      WHERE status = 'PENDING'
        AND "availableAt" <= NOW()
      ORDER BY "availableAt" ASC
      LIMIT ${Math.min(Math.max(limit, 1), 100)}
    `;
  }
}
