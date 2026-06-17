import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type WorkflowClient = Pick<Prisma.TransactionClient, 'workflowTransition'>;

export type RecordWorkflowTransitionInput = {
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorWallet?: string | null;
  actorUserId?: string | null;
  txHash?: string | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  environment?: string;
  network?: string;
};

@Injectable()
export class WorkflowsService {
  constructor(private readonly prisma: PrismaService) {}

  record(input: RecordWorkflowTransitionInput) {
    return this.recordWithClient(this.prisma, input);
  }

  recordWithClient(client: WorkflowClient, input: RecordWorkflowTransitionInput) {
    if (input.fromStatus === input.toStatus) return null;
    return client.workflowTransition.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        fromStatus: input.fromStatus || null,
        toStatus: input.toStatus,
        actorWallet: input.actorWallet || null,
        actorUserId: input.actorUserId || null,
        txHash: input.txHash || null,
        reason: input.reason || null,
        metadata: input.metadata || undefined,
        environment: input.environment || process.env.APP_ENVIRONMENT || 'sandbox',
        network: input.network || process.env.SOLANA_CLUSTER || 'devnet',
      },
    });
  }
}
