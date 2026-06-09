import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RecordBlockchainTransactionDto } from './dto/record-blockchain-transaction.dto';

export type BlockchainTransactionEntry = Omit<
  RecordBlockchainTransactionDto,
  'actorWallet' | 'entityType' | 'entityId' | 'assetId' | 'tokenContract'
> & {
  actorWallet?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  assetId?: string | null;
  tokenContract?: string | null;
};

@Injectable()
export class BlockchainTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  list(limit = 250) {
    const take = Math.min(Math.max(Number(limit) || 250, 1), 1000);
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        id,
        "txHash",
        "actionType",
        "actorWallet",
        "entityType",
        "entityId",
        "assetId",
        "tokenContract",
        metadata,
        "networkFeeLamports"::text AS "networkFeeLamports",
        "rentDepositLamports"::text AS "rentDepositLamports",
        "rentRefundLamports"::text AS "rentRefundLamports",
        "netSolChangeLamports"::text AS "netSolChangeLamports",
        "occurredAt",
        "createdAt"
      FROM "BlockchainTransaction"
      ORDER BY "occurredAt" DESC, "createdAt" DESC
      LIMIT ${take}
    `;
  }

  async count() {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "BlockchainTransaction"
    `;
    return { count: Number(rows[0]?.count || 0n) };
  }

  async record(entry: BlockchainTransactionEntry) {
    const metadata = entry.metadata ? JSON.stringify(entry.metadata) : null;
    const occurredAt = entry.occurredAt ? new Date(entry.occurredAt) : new Date();

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "BlockchainTransaction" (
        id,
        "txHash",
        "actionType",
        "actorWallet",
        "entityType",
        "entityId",
        "assetId",
        "tokenContract",
        metadata,
        "networkFeeLamports",
        "rentDepositLamports",
        "rentRefundLamports",
        "netSolChangeLamports",
        "occurredAt"
      )
      VALUES (
        ${randomUUID()},
        ${entry.txHash},
        ${entry.actionType},
        ${entry.actorWallet || null},
        ${entry.entityType || null},
        ${entry.entityId || null},
        ${entry.assetId || null},
        ${entry.tokenContract || null},
        ${metadata}::jsonb,
        ${entry.networkFeeLamports || null}::bigint,
        ${entry.rentDepositLamports || null}::bigint,
        ${entry.rentRefundLamports || null}::bigint,
        ${entry.netSolChangeLamports || null}::bigint,
        ${occurredAt}
      )
      ON CONFLICT ("txHash") DO UPDATE
      SET
        "actionType" = EXCLUDED."actionType",
        "actorWallet" = COALESCE(EXCLUDED."actorWallet", "BlockchainTransaction"."actorWallet"),
        "entityType" = COALESCE(EXCLUDED."entityType", "BlockchainTransaction"."entityType"),
        "entityId" = COALESCE(EXCLUDED."entityId", "BlockchainTransaction"."entityId"),
        "assetId" = COALESCE(EXCLUDED."assetId", "BlockchainTransaction"."assetId"),
        "tokenContract" = COALESCE(EXCLUDED."tokenContract", "BlockchainTransaction"."tokenContract"),
        "networkFeeLamports" = COALESCE(EXCLUDED."networkFeeLamports", "BlockchainTransaction"."networkFeeLamports"),
        "rentDepositLamports" = COALESCE(EXCLUDED."rentDepositLamports", "BlockchainTransaction"."rentDepositLamports"),
        "rentRefundLamports" = COALESCE(EXCLUDED."rentRefundLamports", "BlockchainTransaction"."rentRefundLamports"),
        "netSolChangeLamports" = COALESCE(EXCLUDED."netSolChangeLamports", "BlockchainTransaction"."netSolChangeLamports"),
        metadata = COALESCE(EXCLUDED.metadata, "BlockchainTransaction".metadata)
      RETURNING
        id,
        "txHash",
        "actionType",
        "actorWallet",
        "entityType",
        "entityId",
        "assetId",
        "tokenContract",
        metadata,
        "networkFeeLamports"::text AS "networkFeeLamports",
        "rentDepositLamports"::text AS "rentDepositLamports",
        "rentRefundLamports"::text AS "rentRefundLamports",
        "netSolChangeLamports"::text AS "netSolChangeLamports",
        "occurredAt",
        "createdAt"
    `;

    return rows[0];
  }
}
