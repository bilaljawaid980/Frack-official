import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTokenBuyIntentDto } from './dto/create-token-buy-intent.dto';
import { CreateTokenSellListingDto } from './dto/create-token-sell-listing.dto';
import { UpdateTokenBuyIntentDto } from './dto/update-token-buy-intent.dto';
import { UpdateTokenSellListingDto } from './dto/update-token-sell-listing.dto';
import { BlockchainTransactionsService } from '../blockchain-transactions/blockchain-transactions.service';

const LISTING_STATUSES = new Set(['LISTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED']);
const OPEN_LISTING_STATUSES = ['LISTED', 'PARTIALLY_FILLED'];
const BUY_INTENT_STATUSES = new Set([
  'BUYER_INTERESTED',
  'BUYER_CHECKING_ELIGIBILITY',
  'ACTION_REQUIRED_BUYER_FID',
  'PENDING_KYC',
  'PENDING_AML',
  'PENDING_ISSUER_WHITELIST',
  'PENDING_ISSUER_ACTIVATION',
  'BUYER_ELIGIBLE',
  'READY_FOR_SELLER_ACCEPTANCE',
  'SELLER_ACCEPTED',
  'READY_TO_TRANSFER',
  'TRANSFER_SIMULATION_FAILED',
  'TRANSFERRED',
  'REJECTED',
  'CANCELLED',
  'EXPIRED',
  'SELLER_NOT_ELIGIBLE',
  'SELLER_FROZEN',
  'SELLER_CLAIM_EXPIRED',
  'INSUFFICIENT_TRANSFERABLE_BALANCE',
]);
const BUY_INTENT_CLOSED_STATUSES = ['TRANSFERRED', 'REJECTED', 'CANCELLED', 'EXPIRED'];
const SELLER_ACCEPTANCE_STATUSES = new Set(['SELLER_ACCEPTED', 'READY_TO_TRANSFER']);

function parseAmount(value: string, label: string): bigint {
  if (!/^\d+$/.test(value)) {
    throw new ConflictException(`${label} must be a non-negative base-unit integer string.`);
  }
  return BigInt(value);
}

function normalizeWallet(value: string, label: string): string {
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new ConflictException(`${label} must be a valid Solana wallet address.`);
  }
}

@Injectable()
export class TokenListingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainTransactions: BlockchainTransactionsService,
  ) {}

  private listingSelect() {
    return Prisma.sql`
      id,
      asset_id as "assetId",
      "tokenContract",
      "sellerWallet",
      "targetBuyerWallet",
      "amountBaseUnits",
      "amountRemaining",
      price,
      currency,
      status,
      "settlementTerms",
      "expiresAt",
      "createdAt",
      "updatedAt"
    `;
  }

  private buyIntentSelect() {
    return Prisma.sql`
      id,
      "listingId",
      asset_id as "assetId",
      "tokenContract",
      "sellerWallet",
      "buyerWallet",
      "amountBaseUnits",
      "fullName",
      email,
      nationality,
      country,
      "idDocumentUrl",
      "proofOfAddressUrl",
      status,
      required_claim_topics as "requiredClaimTopics",
      "kycProvider",
      "amlProvider",
      "issuerWallet",
      "preflightFailure",
      "simulationError",
      "kycClaimTxHash",
      "kycClaimedAt",
      "amlClaimTxHash",
      "amlClaimedAt",
      "whitelistTxHash",
      "whitelistedAt",
      "activationTxHash",
      "activatedAt",
      "transferTxHash",
      "transferredAt",
      "rejectionReason",
      "rejectedAt",
      "rejectedBy",
      "createdAt",
      "updatedAt"
    `;
  }

  async createListing(dto: CreateTokenSellListingDto) {
    const amount = parseAmount(dto.amountBaseUnits, 'amountBaseUnits');
    if (amount <= 0n) throw new ConflictException('Listing amount must be greater than zero.');
    const sellerWallet = normalizeWallet(dto.sellerWallet, 'sellerWallet');
    const targetBuyerWallet = dto.targetBuyerWallet
      ? normalizeWallet(dto.targetBuyerWallet, 'targetBuyerWallet')
      : null;
    if (targetBuyerWallet === sellerWallet) {
      throw new ConflictException('targetBuyerWallet must be different from sellerWallet.');
    }
    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TokenSellListing" (
        id,
        asset_id,
        "tokenContract",
        "sellerWallet",
        "targetBuyerWallet",
        "amountBaseUnits",
        "amountRemaining",
        price,
        currency,
        status,
        "settlementTerms",
        "expiresAt",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${dto.assetId || null},
        ${dto.tokenContract},
        ${sellerWallet},
        ${targetBuyerWallet},
        ${dto.amountBaseUnits},
        ${dto.amountBaseUnits},
        ${dto.price ?? null},
        ${dto.currency || null},
        'LISTED',
        ${dto.settlementTerms || null},
        ${dto.expiresAt ? new Date(dto.expiresAt) : null},
        NOW()
      )
      RETURNING ${this.listingSelect()}
    `;
    return rows[0];
  }

  async findListings(query: Record<string, string>) {
    const filters: Prisma.Sql[] = [];
    if (query.assetId) filters.push(Prisma.sql`asset_id = ${query.assetId}`);
    if (query.tokenContract) filters.push(Prisma.sql`"tokenContract" = ${query.tokenContract}`);
    if (query.sellerWallet) filters.push(Prisma.sql`"sellerWallet" = ${query.sellerWallet}`);
    if (query.targetBuyerWallet) {
      filters.push(Prisma.sql`"targetBuyerWallet" = ${query.targetBuyerWallet}`);
    } else if (!query.sellerWallet) {
      filters.push(Prisma.sql`"targetBuyerWallet" IS NULL`);
    }
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    if (query.open === 'true') {
      filters.push(Prisma.sql`status IN (${Prisma.join(OPEN_LISTING_STATUSES)})`);
      filters.push(Prisma.sql`("expiresAt" IS NULL OR "expiresAt" > NOW())`);
    }

    const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.listingSelect()}
      FROM "TokenSellListing"
      ${where}
      ORDER BY "createdAt" DESC
    `;
  }

  async findListing(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.listingSelect()}
      FROM "TokenSellListing"
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Token listing not found.');
    return rows[0];
  }

  async updateListingStatus(id: string, dto: UpdateTokenSellListingDto) {
    if (!LISTING_STATUSES.has(dto.status)) throw new ConflictException('Invalid listing status.');
    await this.findListing(id);
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenSellListing"
      SET status = ${dto.status}, "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING ${this.listingSelect()}
    `;
    return rows[0];
  }

  async createBuyIntent(listingId: string, dto: CreateTokenBuyIntentDto) {
    const listing = await this.findListing(listingId);
    const listingStatus = String(listing.status);
    if (!OPEN_LISTING_STATUSES.includes(listingStatus)) {
      throw new ConflictException('Listing is not open for buyer requests.');
    }
    if (listing.expiresAt && new Date(String(listing.expiresAt)).getTime() <= Date.now()) {
      throw new ConflictException('Listing is expired.');
    }
    const buyerWallet = normalizeWallet(dto.buyerWallet, 'buyerWallet');
    if (listing.targetBuyerWallet && listing.targetBuyerWallet !== buyerWallet) {
      throw new ConflictException('This listing is reserved for another wallet.');
    }
    const requested = parseAmount(dto.amountBaseUnits, 'amountBaseUnits');
    const remaining = parseAmount(String(listing.amountRemaining), 'amountRemaining');
    if (requested <= 0n) throw new ConflictException('Requested amount must be greater than zero.');
    if (requested !== remaining) throw new ConflictException('Requested amount must match the listing amount.');
    const status = dto.status || 'BUYER_INTERESTED';
    if (!BUY_INTENT_STATUSES.has(status)) throw new ConflictException('Invalid buy intent status.');

    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TokenBuyIntent"
      WHERE "listingId" = ${listingId}
        AND "buyerWallet" = ${buyerWallet}
        AND status NOT IN (${Prisma.join(BUY_INTENT_CLOSED_STATUSES)})
      LIMIT 1
    `;
    if (duplicate.length > 0) {
      throw new ConflictException('This buyer already has an open request for this listing.');
    }

    const id = randomUUID();
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TokenBuyIntent" (
        id,
        "listingId",
        asset_id,
        "tokenContract",
        "sellerWallet",
        "buyerWallet",
        "amountBaseUnits",
        "fullName",
        email,
        nationality,
        country,
        "idDocumentUrl",
        "proofOfAddressUrl",
        status,
        required_claim_topics,
        "kycProvider",
        "amlProvider",
        "issuerWallet",
        "preflightFailure",
        "simulationError",
        "updatedAt"
      )
      VALUES (
        ${id},
        ${listingId},
        ${listing.assetId ? String(listing.assetId) : null},
        ${String(listing.tokenContract)},
        ${String(listing.sellerWallet)},
        ${buyerWallet},
        ${dto.amountBaseUnits},
        ${dto.fullName || null},
        ${dto.email || null},
        ${dto.nationality || null},
        ${dto.country || null},
        ${dto.idDocumentUrl || null},
        ${dto.proofOfAddressUrl || null},
        ${status},
        ${dto.requiredClaimTopics || []},
        ${dto.kycProvider || null},
        ${dto.amlProvider || null},
        ${dto.issuerWallet || null},
        ${dto.preflightFailure || null},
        ${dto.simulationError || null},
        NOW()
      )
      RETURNING ${this.buyIntentSelect()}
    `;
    return rows[0];
  }

  async findBuyIntents(query: Record<string, string>) {
    const filters: Prisma.Sql[] = [];
    if (query.listingId) filters.push(Prisma.sql`"listingId" = ${query.listingId}`);
    if (query.buyerWallet) filters.push(Prisma.sql`"buyerWallet" = ${query.buyerWallet}`);
    if (query.sellerWallet) filters.push(Prisma.sql`"sellerWallet" = ${query.sellerWallet}`);
    if (query.kycProvider) filters.push(Prisma.sql`"kycProvider" = ${query.kycProvider}`);
    if (query.amlProvider) filters.push(Prisma.sql`"amlProvider" = ${query.amlProvider}`);
    if (query.issuerWallet) filters.push(Prisma.sql`"issuerWallet" = ${query.issuerWallet}`);
    if (query.status) filters.push(Prisma.sql`status = ${query.status}`);
    const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.buyIntentSelect()}
      FROM "TokenBuyIntent"
      ${where}
      ORDER BY "createdAt" DESC
    `;
  }

  async findBuyIntent(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.buyIntentSelect()}
      FROM "TokenBuyIntent"
      WHERE id = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Buy intent not found.');
    return rows[0];
  }

  async updateBuyIntentStatus(id: string, dto: UpdateTokenBuyIntentDto) {
    if (!BUY_INTENT_STATUSES.has(dto.status)) throw new ConflictException('Invalid buy intent status.');
    const intent = await this.findBuyIntent(id);
    const listing = await this.findListing(String(intent.listingId));
    const requested = parseAmount(String(intent.amountBaseUnits), 'amountBaseUnits');
    const remaining = parseAmount(String(listing.amountRemaining), 'amountRemaining');

    if (SELLER_ACCEPTANCE_STATUSES.has(dto.status)) {
      if (!OPEN_LISTING_STATUSES.includes(String(listing.status))) {
        throw new ConflictException('Seller cannot accept because listing is not open.');
      }
      if (requested > remaining) {
        throw new ConflictException('Seller cannot accept because requested amount exceeds listing remaining amount.');
      }
    }

    const updates: Prisma.Sql[] = [
      Prisma.sql`status = ${dto.status}`,
      Prisma.sql`"updatedAt" = NOW()`,
    ];
    if (dto.preflightFailure !== undefined) updates.push(Prisma.sql`"preflightFailure" = ${dto.preflightFailure}`);
    if (dto.simulationError !== undefined) updates.push(Prisma.sql`"simulationError" = ${dto.simulationError}`);
    if (dto.claimTxHash && intent.status === 'PENDING_KYC') {
      updates.push(Prisma.sql`"kycClaimTxHash" = ${dto.claimTxHash}`);
      updates.push(Prisma.sql`"kycClaimedAt" = NOW()`);
    }
    if (dto.claimTxHash && intent.status === 'PENDING_AML') {
      updates.push(Prisma.sql`"amlClaimTxHash" = ${dto.claimTxHash}`);
      updates.push(Prisma.sql`"amlClaimedAt" = NOW()`);
    }
    if (dto.whitelistTxHash) {
      updates.push(Prisma.sql`"whitelistTxHash" = ${dto.whitelistTxHash}`);
      updates.push(Prisma.sql`"whitelistedAt" = NOW()`);
    }
    if (dto.activationTxHash) {
      updates.push(Prisma.sql`"activationTxHash" = ${dto.activationTxHash}`);
      updates.push(Prisma.sql`"activatedAt" = NOW()`);
    }
    if (dto.status === 'REJECTED') {
      updates.push(Prisma.sql`"rejectionReason" = ${dto.rejectionReason || 'Rejected'}`);
      updates.push(Prisma.sql`"rejectedAt" = NOW()`);
      updates.push(Prisma.sql`"rejectedBy" = ${dto.reviewerWallet || null}`);
    }
    if (dto.status === 'TRANSFERRED') {
      if (!dto.transferTxHash) throw new ConflictException('transferTxHash is required when marking transferred.');
      if (requested > remaining) {
        throw new ConflictException('Transfer amount exceeds listing remaining amount.');
      }
      const newRemaining = remaining - requested;
      updates.push(Prisma.sql`"transferTxHash" = ${dto.transferTxHash}`);
      updates.push(Prisma.sql`"transferredAt" = NOW()`);

      const historyId = randomUUID();
      const rows = await this.prisma.$transaction(async (tx) => {
        const updatedIntent = await tx.$queryRaw<Array<Record<string, unknown>>>`
          UPDATE "TokenBuyIntent"
          SET ${Prisma.join(updates)}
          WHERE id = ${id}
          RETURNING ${this.buyIntentSelect()}
        `;
        await tx.$queryRaw`
          UPDATE "TokenSellListing"
          SET "amountRemaining" = ${newRemaining.toString()},
              status = ${newRemaining === 0n ? 'FILLED' : 'PARTIALLY_FILLED'},
              "updatedAt" = NOW()
          WHERE id = ${String(intent.listingId)}
        `;
        await tx.$queryRaw`
          INSERT INTO "TokenTransferHistory" (
            id,
            "listingId",
            "buyIntentId",
            "tokenContract",
            "fromWallet",
            "toWallet",
            "amountBaseUnits",
            "txHash"
          )
          VALUES (
            ${historyId},
            ${String(intent.listingId)},
            ${id},
            ${String(intent.tokenContract)},
            ${String(intent.sellerWallet)},
            ${String(intent.buyerWallet)},
            ${String(intent.amountBaseUnits)},
            ${dto.transferTxHash}
          )
        `;
        return updatedIntent;
      });
      await this.recordBuyIntentLedgerEntries(id, dto, intent);
      return rows[0];
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenBuyIntent"
      SET ${Prisma.join(updates)}
      WHERE id = ${id}
      RETURNING ${this.buyIntentSelect()}
    `;
    await this.recordBuyIntentLedgerEntries(id, dto, intent);
    return rows[0];
  }

  private async recordBuyIntentLedgerEntries(
    id: string,
    dto: UpdateTokenBuyIntentDto,
    intent: Record<string, unknown>,
  ) {
    const ledgerBase = {
      actorWallet: dto.reviewerWallet || null,
      entityType: 'token_buy_intent',
      entityId: id,
      assetId: String(intent.assetId || '') || undefined,
      tokenContract: String(intent.tokenContract),
    };
    const status = String(intent.status);
    const entries = [
      dto.claimTxHash && status === 'PENDING_KYC'
        ? { ...ledgerBase, txHash: dto.claimTxHash, actionType: 'TRANSFER_ELIGIBILITY_KYC_CLAIM' }
        : null,
      dto.claimTxHash && status === 'PENDING_AML'
        ? { ...ledgerBase, txHash: dto.claimTxHash, actionType: 'TRANSFER_ELIGIBILITY_AML_CLAIM' }
        : null,
      dto.whitelistTxHash
        ? { ...ledgerBase, txHash: dto.whitelistTxHash, actionType: 'INVESTOR_WHITELISTED' }
        : null,
      dto.activationTxHash
        ? { ...ledgerBase, txHash: dto.activationTxHash, actionType: 'IDENTITY_ACTIVATED' }
        : null,
      dto.transferTxHash
        ? { ...ledgerBase, txHash: dto.transferTxHash, actionType: 'MARKETPLACE_TRANSFER' }
        : null,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    await Promise.all(entries.map((entry) => this.blockchainTransactions.record(entry)));
  }

  async resumeBuyIntentAfterIdentity(id: string) {
    const intent = await this.findBuyIntent(id);
    if (intent.status !== 'ACTION_REQUIRED_BUYER_FID') {
      return intent;
    }

    const topics = Array.isArray(intent.requiredClaimTopics)
      ? (intent.requiredClaimTopics as string[])
      : [];
    const nextStatus = topics.includes('1')
      ? 'PENDING_KYC'
      : topics.includes('2')
        ? 'PENDING_AML'
        : 'PENDING_ISSUER_WHITELIST';

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      UPDATE "TokenBuyIntent"
      SET status = ${nextStatus},
          "preflightFailure" = NULL,
          "updatedAt" = NOW()
      WHERE id = ${id}
      RETURNING ${this.buyIntentSelect()}
    `;
    return rows[0];
  }
}
