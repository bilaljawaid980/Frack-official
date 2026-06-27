import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { createHash, randomUUID } from 'crypto';
import { DocumentType, DocumentVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BlockchainTransactionsService } from '../blockchain-transactions/blockchain-transactions.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { AuditLogService } from '../audit/audit.service';
import { getIndexerConfig } from '../indexer/indexer.config';
import {
  AcceptValuerAssignmentDto,
  AssignValuerDto,
  CreatePlatformValuerDto,
  RecordAssetValuationDto,
  RecordValuerFidDto,
  RecordValuerTirTrustDto,
} from './dto/valuations.dto';

const TOPIC_VALUATION = 5n;
const SEED_FID = Buffer.from('fid');
const SEED_ASSET_REGISTRY = Buffer.from('asset_registry');
const SEED_TIR_STATE = Buffer.from('tir_state');
const SEED_ISSUER_ENTRY = Buffer.from('issuer_entry');
const ACTIVE_ASSIGNMENT_STATUSES = ['ASSIGNED', 'ACCEPTED', 'ATTESTATION_PENDING', 'CONFIRMED'];
const VALUATION_REPORT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_DOCUMENT_BUCKET = 'legal-docs';

type ValuerRow = {
  id: string;
  organizationName: string;
  walletAddress: string;
  fidAddress: string | null;
  status: string;
  fidTxHash: string | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  credentials: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type AssignmentRow = {
  id: string;
  assetRequestId: string;
  deployedAssetId: string | null;
  factoryAssetId: number;
  tokenContract: string | null;
  assetRegistryAddress: string | null;
  tirStateAddress: string | null;
  valuerProfileId: string;
  valuerWallet: string;
  valuerFid: string;
  status: string;
  assignedBy: string | null;
  acceptedAt: Date | null;
  tirTrustTxHash: string | null;
  tirTrustedAt: Date | null;
  cancelledAt: Date | null;
  replacedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ValuationRow = Record<string, unknown>;
type ValuationReportDocumentRow = {
  id: string;
  assetRequestId: string;
  bucket: string;
  storageKey: string;
  fileHash: string;
  fileName: string;
  attestationTxHash: string | null;
  attestedAt: Date | null;
  uploadedAt: Date;
};
type UploadedValuationReportFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type IssuerEntry = { issuerFid: string; tir: string; topics: bigint[]; active: boolean };
type AssetRegistry = {
  assetId: bigint;
  tokenMint: string;
  valuerFid: string;
  currentNav: bigint;
  navDate: bigint;
  navValidityDays: number;
  methodologyHash: string;
};

function envPubkey(names: string[], fallback?: string) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return new PublicKey(value);
  }
  if (fallback) return new PublicKey(fallback);
  throw new Error(`Missing required program id env: ${names.join(' or ')}`);
}

function normalizePubkey(value: string, label: string) {
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    throw new BadRequestException(`${label} must be a valid Solana address.`);
  }
}

function u64Le(value: number | bigint) {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(BigInt(value));
  return out;
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function readString(data: Buffer, offset: number) {
  const size = data.readUInt32LE(offset);
  return { next: offset + 4 + size };
}

function hex32(value: string, label: string) {
  const clean = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) throw new BadRequestException(`${label} must be a 32-byte hex string.`);
  return clean;
}

function unixDate(seconds: bigint) {
  return new Date(Number(seconds) * 1000);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function decodeFid(data: Buffer) {
  return { owner: readPubkey(data, 8), isIssuer: data[108] === 1 };
}

function decodeIssuerEntry(data: Buffer): IssuerEntry {
  let offset = 8;
  const issuerFid = readPubkey(data, offset); offset += 32;
  const tir = readPubkey(data, offset); offset += 32;
  const length = data.readUInt32LE(offset); offset += 4;
  const topics: bigint[] = [];
  for (let i = 0; i < length; i += 1) {
    topics.push(data.readBigUInt64LE(offset));
    offset += 8;
  }
  return { issuerFid, tir, topics, active: data[offset] === 1 };
}

function decodeAssetRegistry(data: Buffer): AssetRegistry {
  let offset = 8;
  const assetId = data.readBigUInt64LE(offset); offset += 8;
  const tokenMint = readPubkey(data, offset); offset += 32;
  offset += 64;
  offset = readString(data, offset).next;
  offset = readString(data, offset).next;
  offset += 2 + 32 + 32 + 32 + 32 + 32 + 8 + 8;
  const valuerFid = readPubkey(data, offset); offset += 32;
  const currentNav = data.readBigUInt64LE(offset); offset += 8;
  const navDate = data.readBigInt64LE(offset); offset += 8;
  const navValidityDays = data.readUInt16LE(offset); offset += 2;
  offset += 1 + 1 + 1 + 32 + 32;
  const methodologyHash = data.subarray(offset, offset + 32).toString('hex');
  return { assetId, tokenMint, valuerFid, currentNav, navDate, navValidityDays, methodologyHash };
}

@Injectable()
export class ValuationsService {
  private readonly connection = new Connection(getIndexerConfig().rpcEndpoint, 'confirmed');
  private readonly fidProgramId = envPubkey(['FRACKS_FID', 'FID_PROGRAM_ID', 'NEXT_PUBLIC_FID_PROGRAM_ID', 'NEXT_PUBLIC_FRACKS_FID']);
  private readonly tirProgramId = envPubkey(['FRACKS_TIR', 'TIR_PROGRAM_ID', 'NEXT_PUBLIC_TIR_PROGRAM_ID', 'NEXT_PUBLIC_FRACKS_TIR']);
  private readonly assetRegistryProgramId = envPubkey(['ASSET_REGISTRY_PROGRAM_ID', 'FRACKS_ASSET_REGISTRY', 'NEXT_PUBLIC_ASSET_REGISTRY_PROGRAM_ID'], '3xoAnJ9DqMxj22XfeUYQdwAy6dbKXHHeXxcLBxAY2Pdx');

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainTransactions: BlockchainTransactionsService,
    private readonly workflows: WorkflowsService,
    private readonly audit: AuditLogService,
  ) {}


  private assertIssuerActor(actorWallet: string | null | undefined, issuerWallet: string, action: string) {
    if (!actorWallet) throw new BadRequestException(`A signed issuer wallet is required to ${action}.`);
    const actor = normalizePubkey(actorWallet, 'Actor wallet');
    const issuer = normalizePubkey(issuerWallet, 'Issuer wallet');
    if (actor !== issuer) {
      throw new BadRequestException(`Only the token issuer/TIR owner can ${action}. Switch to issuer wallet ${issuer}.`);
    }
    return actor;
  }

  deriveFid(walletAddress: string) {
    const wallet = new PublicKey(walletAddress);
    return PublicKey.findProgramAddressSync([SEED_FID, wallet.toBuffer()], this.fidProgramId)[0];
  }

  deriveAssetRegistry(factoryAssetId: number | bigint) {
    return PublicKey.findProgramAddressSync([SEED_ASSET_REGISTRY, u64Le(factoryAssetId)], this.assetRegistryProgramId)[0];
  }

  deriveTirState(tokenContract: string) {
    const mint = new PublicKey(tokenContract);
    return PublicKey.findProgramAddressSync([SEED_TIR_STATE, mint.toBuffer()], this.tirProgramId)[0];
  }

  deriveIssuerEntry(tirState: string, issuerFid: string) {
    return PublicKey.findProgramAddressSync(
      [SEED_ISSUER_ENTRY, new PublicKey(tirState).toBuffer(), new PublicKey(issuerFid).toBuffer()],
      this.tirProgramId,
    )[0];
  }

  private valuerSelect() {
    return '"id", "organization_name" AS "organizationName", "wallet_address" AS "walletAddress", "fid_address" AS "fidAddress", "status", "fid_tx_hash" AS "fidTxHash", "approved_at" AS "approvedAt", "suspended_at" AS "suspendedAt", "credentials", "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"';
  }

  private assignmentSelect() {
    return '"id", "asset_request_id" AS "assetRequestId", "deployed_asset_id" AS "deployedAssetId", "factory_asset_id" AS "factoryAssetId", "token_contract" AS "tokenContract", "asset_registry_address" AS "assetRegistryAddress", "tir_state_address" AS "tirStateAddress", "valuer_profile_id" AS "valuerProfileId", "valuer_wallet" AS "valuerWallet", "valuer_fid" AS "valuerFid", "status", "assigned_by" AS "assignedBy", "accepted_at" AS "acceptedAt", "tir_trust_tx_hash" AS "tirTrustTxHash", "tir_trusted_at" AS "tirTrustedAt", "cancelled_at" AS "cancelledAt", "replaced_at" AS "replacedAt", "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"';
  }

  private valuationSelect() {
    return '"id", "assignment_id" AS "assignmentId", "asset_request_id" AS "assetRequestId", "deployed_asset_id" AS "deployedAssetId", "factory_asset_id" AS "factoryAssetId", "token_contract" AS "tokenContract", "asset_registry_address" AS "assetRegistryAddress", "valuer_wallet" AS "valuerWallet", "valuer_fid" AS "valuerFid", "nav_raw" AS "navRaw", "nav_currency" AS "navCurrency", "nav_scale" AS "navScale", "nav_date" AS "navDate", "nav_validity_days" AS "navValidityDays", "valid_until" AS "validUntil", "methodology_hash" AS "methodologyHash", "report_document_id" AS "reportDocumentId", "tx_hash" AS "txHash", "confirmed_slot"::text AS "confirmedSlot", "status", "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"';
  }
  async listValuers(query: { walletAddress?: string; status?: string } = {}) {
    const wallet = query.walletAddress ? normalizePubkey(query.walletAddress, 'Valuer wallet address') : null;
    return this.prisma.$queryRawUnsafe<ValuerRow[]>(
      `SELECT ${this.valuerSelect()} FROM "platform_valuers"
       WHERE ($1::text IS NULL OR "wallet_address" = $1)
         AND ($2::text IS NULL OR "status" = $2)
       ORDER BY "organization_name" ASC, "created_at" DESC`,
      wallet,
      query.status || null,
    );
  }

  async createValuer(dto: CreatePlatformValuerDto) {
    const walletAddress = normalizePubkey(dto.walletAddress, 'Valuer wallet address');
    const organizationName = dto.organizationName.trim();
    if (!organizationName) throw new BadRequestException('Valuer organization name is required.');
    const expectedFid = this.deriveFid(walletAddress).toBase58();
    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(
      `INSERT INTO "platform_valuers" ("id", "organization_name", "wallet_address", "status", "credentials", "metadata", "created_at", "updated_at")
       VALUES ($1, $2, $3, 'REGISTERED', $4::jsonb, $5::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       RETURNING ${this.valuerSelect()}`,
      randomUUID(),
      organizationName,
      walletAddress,
      JSON.stringify(dto.credentials || {}),
      JSON.stringify({ ...(dto.metadata || {}), expectedFid }),
    ).catch((error) => {
      if (String(error?.message || '').includes('Unique constraint')) throw new ConflictException('A valuer with this wallet is already registered.');
      throw error;
    });
    return { ...rows[0], expectedFid };
  }

  async recordValuerFid(id: string, dto: RecordValuerFidDto) {
    const valuer = await this.findValuer(id);
    const fidAddress = normalizePubkey(dto.fidAddress, 'Valuer FID address');
    if (fidAddress !== this.deriveFid(valuer.walletAddress).toBase58()) throw new BadRequestException('FID address does not match the registered valuer wallet.');
    if (dto.txHash) await this.assertConfirmedSignature(dto.txHash);
    const info = await this.connection.getAccountInfo(new PublicKey(fidAddress), 'confirmed');
    if (!info) throw new BadRequestException('Valuer FID account does not exist on-chain.');
    const decoded = decodeFid(Buffer.from(info.data));
    if (decoded.owner !== valuer.walletAddress) throw new BadRequestException('Valuer FID owner does not match the registered wallet.');

    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(
      `UPDATE "platform_valuers"
       SET "fid_address" = $1, "fid_tx_hash" = $2,
           "status" = CASE WHEN "status" = 'REGISTERED' THEN 'FID_CREATED' ELSE "status" END,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $3
       RETURNING ${this.valuerSelect()}`,
      fidAddress,
      dto.txHash || null,
      id,
    );
    return rows[0];
  }

  async approveValuer(id: string) {
    const valuer = await this.findValuer(id);
    if (!valuer.fidAddress) throw new BadRequestException('Valuer must create and record its FID before approval.');
    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(
      `UPDATE "platform_valuers" SET "status" = 'APPROVED', "approved_at" = CURRENT_TIMESTAMP, "suspended_at" = NULL, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1 RETURNING ${this.valuerSelect()}`,
      id,
    );
    return rows[0];
  }

  async suspendValuer(id: string) {
    await this.findValuer(id);
    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(
      `UPDATE "platform_valuers" SET "status" = 'SUSPENDED', "suspended_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1 RETURNING ${this.valuerSelect()}`,
      id,
    );
    return rows[0];
  }

  async removeValuer(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(`DELETE FROM "platform_valuers" WHERE "id" = $1 RETURNING ${this.valuerSelect()}`, id);
    if (!rows[0]) throw new NotFoundException('Platform valuer not found.');
    return rows[0];
  }

  async assignValuer(assetRequestId: string, dto: AssignValuerDto) {
    const request = await this.prisma.assetRequest.findUnique({ where: { id: assetRequestId } });
    if (!request) throw new NotFoundException('Asset request not found.');
    const actorWallet = this.assertIssuerActor(dto.assignedBy, request.issuerWallet, 'assign a valuer');
    if (!request.factoryAssetId) throw new BadRequestException('Asset request is missing factory asset id.');
    const tokenContract = dto.tokenContract || request.deployedAssetId ? normalizePubkey(dto.tokenContract || request.deployedAssetId || '', 'Token contract') : null;
    const valuer = await this.findValuer(dto.valuerProfileId);
    if (valuer.status !== 'APPROVED' || !valuer.fidAddress) throw new BadRequestException('Select an approved valuer with a recorded FID.');

    const existing = await this.activeAssignment(request.factoryAssetId);
    if (existing) {
      if (existing.valuerProfileId === valuer.id) return existing;
      await this.prisma.$queryRawUnsafe(
        `UPDATE "asset_valuer_assignments" SET "status" = 'REPLACED', "replaced_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1`,
        existing.id,
      );
    }

    const assetRegistryAddress = tokenContract ? this.deriveAssetRegistry(request.factoryAssetId).toBase58() : null;
    const tirStateAddress = tokenContract ? this.deriveTirState(tokenContract).toBase58() : null;
    const rows = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(
      `INSERT INTO "asset_valuer_assignments" (
        "id", "asset_request_id", "deployed_asset_id", "factory_asset_id", "token_contract",
        "asset_registry_address", "tir_state_address", "valuer_profile_id", "valuer_wallet", "valuer_fid",
        "status", "assigned_by", "metadata", "created_at", "updated_at"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'ASSIGNED', $11, $12::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING ${this.assignmentSelect()}`,
      randomUUID(), request.id, request.deployedAssetId, request.factoryAssetId, tokenContract,
      assetRegistryAddress, tirStateAddress, valuer.id, valuer.walletAddress, valuer.fidAddress,
      actorWallet, JSON.stringify(dto.metadata || {}),
    );
    await this.workflows.record({ entityType: 'AssetValuerAssignment', entityId: rows[0].id, toStatus: rows[0].status, actorWallet, metadata: { assetRequestId, factoryAssetId: request.factoryAssetId, tokenContract, valuerFid: valuer.fidAddress } });
    return rows[0];
  }

  async listAssignments(query: { valuerWallet?: string; assetRequestId?: string; tokenContract?: string; status?: string } = {}) {
    const valuerWallet = query.valuerWallet ? normalizePubkey(query.valuerWallet, 'Valuer wallet address') : null;
    const tokenContract = query.tokenContract ? normalizePubkey(query.tokenContract, 'Token contract') : null;
    return this.prisma.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${this.assignmentSelect()} FROM "asset_valuer_assignments"
       WHERE ($1::text IS NULL OR "valuer_wallet" = $1)
         AND ($2::text IS NULL OR "asset_request_id" = $2)
         AND ($3::text IS NULL OR "token_contract" = $3)
         AND ($4::text IS NULL OR "status" = $4)
       ORDER BY "created_at" DESC`,
      valuerWallet, query.assetRequestId || null, tokenContract, query.status || null,
    );
  }

  async getAssignment(id: string) {
    const assignment = await this.findAssignment(id);
    const valuations = await this.listValuations({ assignmentId: id });
    return { ...assignment, valuations };
  }

  async acceptAssignment(id: string, dto: AcceptValuerAssignmentDto) {
    const assignment = await this.findAssignment(id);
    if (dto.actorWallet && normalizePubkey(dto.actorWallet, 'Actor wallet') !== assignment.valuerWallet) throw new BadRequestException('Only the assigned valuer wallet can accept this assignment.');
    const rows = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(`UPDATE "asset_valuer_assignments" SET "status" = 'ACCEPTED', "accepted_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1 RETURNING ${this.assignmentSelect()}`, id);
    await this.workflows.record({ entityType: 'AssetValuerAssignment', entityId: id, fromStatus: assignment.status, toStatus: rows[0].status, actorWallet: dto.actorWallet || assignment.valuerWallet });
    return rows[0];
  }

  async recordTirTrust(id: string, dto: RecordValuerTirTrustDto) {
    const assignment = await this.findAssignment(id);
    const request = await this.prisma.assetRequest.findUnique({ where: { id: assignment.assetRequestId } });
    if (!request) throw new NotFoundException('Asset request not found.');
    const actorWallet = this.assertIssuerActor(dto.actorWallet, request.issuerWallet, 'record valuer topic 5 trust');
    await this.assertConfirmedSignature(dto.txHash);
    const issuerEntryAddress = normalizePubkey(dto.issuerEntryAddress, 'IssuerEntry address');
    if (!assignment.tokenContract) throw new BadRequestException('Token TIR is not available before deployment. Topic 5 trust is a post-deployment housekeeping step.');
    const tirStateAddress = assignment.tirStateAddress || this.deriveTirState(assignment.tokenContract).toBase58();
    const expected = this.deriveIssuerEntry(tirStateAddress, assignment.valuerFid).toBase58();
    if (issuerEntryAddress !== expected) throw new BadRequestException('IssuerEntry PDA does not match assigned valuer and token TIR.');
    const entry = await this.fetchIssuerEntry(issuerEntryAddress);
    if (entry.issuerFid !== assignment.valuerFid || entry.tir !== tirStateAddress || !entry.active || !entry.topics.includes(TOPIC_VALUATION)) {
      throw new BadRequestException('Valuer FID is not active in this token TIR for topic 5.');
    }
    const nextStatus = assignment.status === 'ASSIGNED' ? 'ATTESTATION_PENDING' : assignment.status;
    const rows = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(
      `UPDATE "asset_valuer_assignments"
       SET "tir_trust_tx_hash" = $1, "tir_trusted_at" = CURRENT_TIMESTAMP, "tir_state_address" = $2, "status" = $3, "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $4 RETURNING ${this.assignmentSelect()}`,
      dto.txHash, tirStateAddress, nextStatus, id,
    );
    await this.recordTransitionAndTx(assignment, rows[0], dto.txHash, actorWallet, 'VALUER_TIR_TRUSTED');
    return rows[0];
  }

  async uploadValuationReport(id: string, actorWallet: string | null | undefined, file: UploadedValuationReportFile | undefined) {
    const assignment = await this.findAssignment(id);
    const actor = actorWallet ? normalizePubkey(actorWallet, 'Actor wallet') : null;
    if (!actor || actor !== assignment.valuerWallet) {
      throw new BadRequestException('Only the assigned valuer wallet can upload a valuation report for this assignment.');
    }

    const valuer = await this.findValuer(assignment.valuerProfileId);
    if (valuer.status !== 'APPROVED' || !valuer.fidAddress || valuer.fidAddress !== assignment.valuerFid) {
      throw new BadRequestException('Assigned valuer must be approved and have the expected FID recorded.');
    }
    if (!file) throw new BadRequestException('Valuation report PDF is required.');
    if (file.mimetype !== 'application/pdf') throw new BadRequestException('Valuation report must be a PDF.');
    if (file.size <= 0 || file.size > VALUATION_REPORT_MAX_BYTES) throw new BadRequestException('Valuation report must be 10MB or smaller.');

    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const bucket = this.documentBucket();
    const storageKey = [
      'valuations',
      String(assignment.factoryAssetId),
      `${Date.now()}-${randomUUID()}-${this.sanitizeStoragePart(file.originalname || 'valuation-report.pdf')}`,
    ].join('/');

    await this.uploadStorageObject(bucket, storageKey, file.buffer, file.mimetype);
    const signedUrl = await this.createSignedStorageUrl(bucket, storageKey);
    const metadata: Prisma.InputJsonObject = {
      source: 'VALUER_PORTAL',
      assignmentId: assignment.id,
      tokenContract: assignment.tokenContract || null,
      assetRegistryAddress: assignment.assetRegistryAddress || null,
      valuerWallet: assignment.valuerWallet,
      valuerFid: assignment.valuerFid,
    };

    const document = await this.prisma.assetDocument.create({
      data: {
        assetRequestId: assignment.assetRequestId,
        factoryAssetId: assignment.factoryAssetId,
        deployedAssetId: assignment.deployedAssetId,
        type: DocumentType.VALUATION_REPORT,
        visibility: DocumentVisibility.PUBLIC,
        bucket,
        storageKey,
        fileHash,
        fileName: file.originalname || 'valuation-report.pdf',
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByWallet: actor,
        metadata,
      },
    });

    await this.audit.record({
      actorWallet: actor,
      action: 'VALUATION_REPORT_UPLOADED',
      resourceType: 'AssetDocument',
      resourceId: document.id,
      requestId: assignment.assetRequestId,
      after: { source: 'VALUER_PORTAL', assignmentId: assignment.id, fileHash, storageKey },
      result: 'SUCCESS',
    });

    return {
      hash: document.fileHash,
      documentId: document.id,
      storageKey: document.storageKey,
      fileName: document.fileName,
      sizeBytes: document.sizeBytes,
      mimeType: document.mimeType,
      downloadUrl: signedUrl,
    };
  }

  async getLatestValuationReport(assetId: string) {
    const request = await this.resolveAssetRequestForValuationReport(assetId);
    const documents = await this.prisma.$queryRawUnsafe<ValuationReportDocumentRow[]>(
      `SELECT "id", "asset_request_id" AS "assetRequestId", "bucket", "storage_key" AS "storageKey",
              "file_hash" AS "fileHash", "file_name" AS "fileName",
              "attestation_tx_hash" AS "attestationTxHash", "attested_at" AS "attestedAt", "uploaded_at" AS "uploadedAt"
       FROM "asset_documents"
       WHERE "asset_request_id" = $1
         AND "type" = 'VALUATION_REPORT'
         AND "visibility" = 'PUBLIC'
         AND "deleted_at" IS NULL
       ORDER BY "attested_at" DESC NULLS LAST, "uploaded_at" DESC
       LIMIT 1`,
      request.id,
    );
    const document = documents[0];
    if (!document) throw new NotFoundException('No valuation report is available for this asset.');

    const valuations = await this.listValuations({ assetRequestId: request.id });
    const valuation = valuations.find((row) => row.reportDocumentId === document.id) || valuations.find((row) => row.status === 'CONFIRMED') || null;

    return {
      documentId: document.id,
      hash: document.fileHash,
      fileName: document.fileName,
      downloadUrl: await this.createSignedStorageUrl(document.bucket, document.storageKey),
      attestedAt: document.attestedAt,
      attestationTxHash: document.attestationTxHash,
      navRaw: valuation?.navRaw ? String(valuation.navRaw) : null,
      navValidityDays: valuation?.navValidityDays ? Number(valuation.navValidityDays) : null,
      validUntil: valuation?.validUntil || null,
    };
  }
  async recordValuation(id: string, dto: RecordAssetValuationDto) {
    const assignment = await this.findAssignment(id);
    const actorWallet = dto.actorWallet ? normalizePubkey(dto.actorWallet, 'Actor wallet') : assignment.valuerWallet;
    if (actorWallet !== assignment.valuerWallet) throw new BadRequestException('Only the assigned valuer wallet can record this valuation.');

    const valuer = await this.findValuer(assignment.valuerProfileId);
    if (valuer.status !== 'APPROVED' || !valuer.fidAddress || valuer.fidAddress !== assignment.valuerFid) {
      throw new BadRequestException('Assigned valuer must be approved and have the expected FID recorded.');
    }

    const nav = BigInt(dto.navRaw);
    if (nav <= 0n) throw new BadRequestException('NAV must be greater than zero.');
    const methodologyHash = hex32(dto.methodologyHash, 'methodologyHash');
    let reportDocument: { id: string; fileHash: string; metadata: Prisma.JsonValue | null } | null = null;
    if (dto.reportDocumentId) {
      reportDocument = await this.prisma.assetDocument.findFirst({
        where: {
          id: dto.reportDocumentId,
          assetRequestId: assignment.assetRequestId,
          type: DocumentType.VALUATION_REPORT,
          deletedAt: null,
        },
        select: { id: true, fileHash: true, metadata: true },
      });
      if (!reportDocument) throw new BadRequestException('Valuation report document was not found for this assignment.');
      if (reportDocument.fileHash.toLowerCase() !== methodologyHash) throw new BadRequestException('Valuation report hash does not match the methodology hash.');
    }

    const submittedAt = new Date();
    const requestedValidUntil = addDays(submittedAt, dto.navValidityDays);
    const baseMetadata = { ...(dto.metadata || {}), navConvention: { currency: 'PKR', scale: 2, meaning: 'total_asset_nav_minor_units' } };

    if (!dto.txHash) {
      const metadata = JSON.stringify({ ...baseMetadata, phase: 'PRE_DEPLOYMENT_PENDING_ON_CHAIN' });
      await this.prisma.$queryRawUnsafe(
        `UPDATE "asset_valuations" SET "status" = 'SUPERSEDED', "updated_at" = CURRENT_TIMESTAMP WHERE "assignment_id" = $1 AND "status" = 'PENDING_ON_CHAIN'`,
        assignment.id,
      );
      const rows = await this.prisma.$queryRawUnsafe<ValuationRow[]>(
        `INSERT INTO "asset_valuations" (
          "id", "assignment_id", "asset_request_id", "deployed_asset_id", "factory_asset_id", "token_contract",
          "asset_registry_address", "valuer_wallet", "valuer_fid", "nav_raw", "nav_currency", "nav_scale",
          "nav_date", "nav_validity_days", "valid_until", "methodology_hash", "report_document_id",
          "tx_hash", "confirmed_slot", "status", "metadata", "created_at", "updated_at"
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PKR',2,$11,$12,$13,$14,$15,NULL,NULL,'PENDING_ON_CHAIN',$16::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        RETURNING ${this.valuationSelect()}`,
        randomUUID(), assignment.id, assignment.assetRequestId, assignment.deployedAssetId, assignment.factoryAssetId,
        assignment.tokenContract, assignment.assetRegistryAddress, assignment.valuerWallet, assignment.valuerFid,
        nav.toString(), submittedAt, dto.navValidityDays, requestedValidUntil, methodologyHash, dto.reportDocumentId || null,
        metadata,
      );
      const updatedAssignments = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(
        `UPDATE "asset_valuer_assignments" SET "status" = 'ATTESTATION_PENDING', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1 RETURNING ${this.assignmentSelect()}`,
        assignment.id,
      );
      await this.workflows.record({ entityType: 'AssetValuation', entityId: String(rows[0].id), toStatus: 'PENDING_ON_CHAIN', actorWallet, metadata: { assetRequestId: assignment.assetRequestId, factoryAssetId: assignment.factoryAssetId } });
      await this.workflows.record({ entityType: 'AssetValuerAssignment', entityId: assignment.id, fromStatus: assignment.status, toStatus: updatedAssignments[0].status, actorWallet });
      return rows[0];
    }

    if (!assignment.tokenContract) {
      throw new BadRequestException('Token must exist before finalizing valuation on-chain. Submit without txHash for the pre-deployment pending valuation.');
    }
    const assetRegistryAddress = assignment.assetRegistryAddress || this.deriveAssetRegistry(assignment.factoryAssetId).toBase58();
    await this.assertConfirmedSignature(dto.txHash);
    const registry = await this.fetchAssetRegistry(assetRegistryAddress);
    if (registry.assetId !== BigInt(assignment.factoryAssetId)) throw new BadRequestException('Asset registry asset id does not match assignment.');
    if (registry.tokenMint !== assignment.tokenContract) throw new BadRequestException('Asset registry token mint does not match assignment.');
    if (registry.valuerFid !== assignment.valuerFid) throw new BadRequestException('Asset registry valuer FID does not match assignment.');
    if (registry.currentNav !== nav) throw new BadRequestException('Asset registry NAV does not match submitted NAV.');
    if (registry.navValidityDays !== dto.navValidityDays) throw new BadRequestException('Asset registry validity days do not match submitted validity.');
    if (registry.methodologyHash !== methodologyHash) throw new BadRequestException('Asset registry methodology hash does not match submitted hash.');

    const navDate = unixDate(registry.navDate);
    const validUntil = addDays(navDate, registry.navValidityDays);
    const status = await this.connection.getSignatureStatus(dto.txHash, { searchTransactionHistory: true });
    const confirmedSlot = status.value?.slot ? String(status.value.slot) : null;
    const metadata = JSON.stringify({ ...baseMetadata, phase: 'POST_DEPLOYMENT_ON_CHAIN_CONFIRMED' });

    await this.prisma.$queryRawUnsafe(
      `UPDATE "asset_valuations" SET "status" = 'SUPERSEDED', "updated_at" = CURRENT_TIMESTAMP WHERE "factory_asset_id" = $1 AND "status" = 'CONFIRMED' AND ("tx_hash" IS NULL OR "tx_hash" <> $2)`,
      assignment.factoryAssetId, dto.txHash,
    );

    const rows = await this.prisma.$queryRawUnsafe<ValuationRow[]>(
      `INSERT INTO "asset_valuations" (
        "id", "assignment_id", "asset_request_id", "deployed_asset_id", "factory_asset_id", "token_contract",
        "asset_registry_address", "valuer_wallet", "valuer_fid", "nav_raw", "nav_currency", "nav_scale",
        "nav_date", "nav_validity_days", "valid_until", "methodology_hash", "report_document_id",
        "tx_hash", "confirmed_slot", "status", "metadata", "created_at", "updated_at"
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PKR',2,$11,$12,$13,$14,$15,$16,$17::bigint,'CONFIRMED',$18::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
      ON CONFLICT ("tx_hash") DO UPDATE SET
        "nav_raw" = EXCLUDED."nav_raw",
        "nav_date" = EXCLUDED."nav_date",
        "nav_validity_days" = EXCLUDED."nav_validity_days",
        "valid_until" = EXCLUDED."valid_until",
        "methodology_hash" = EXCLUDED."methodology_hash",
        "report_document_id" = EXCLUDED."report_document_id",
        "confirmed_slot" = EXCLUDED."confirmed_slot",
        "metadata" = EXCLUDED."metadata",
        "status" = 'CONFIRMED',
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING ${this.valuationSelect()}`,
      randomUUID(), assignment.id, assignment.assetRequestId, assignment.deployedAssetId, assignment.factoryAssetId,
      assignment.tokenContract, assetRegistryAddress, assignment.valuerWallet, assignment.valuerFid,
      nav.toString(), navDate, registry.navValidityDays, validUntil, methodologyHash, dto.reportDocumentId || null,
      dto.txHash, confirmedSlot, metadata,
    );

    await this.prisma.$queryRawUnsafe(
      `UPDATE "asset_valuations" SET "status" = 'CONFIRMED', "tx_hash" = $1, "confirmed_slot" = $2::bigint, "nav_date" = $3, "valid_until" = $4, "updated_at" = CURRENT_TIMESTAMP
       WHERE "assignment_id" = $5 AND "status" = 'PENDING_ON_CHAIN' AND "methodology_hash" = $6`,
      dto.txHash, confirmedSlot, navDate, validUntil, assignment.id, methodologyHash,
    );

    const updatedAssignments = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(`UPDATE "asset_valuer_assignments" SET "status" = 'CONFIRMED', "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1 RETURNING ${this.assignmentSelect()}`, assignment.id);
    if (reportDocument) {
      const previousMetadata = reportDocument.metadata && typeof reportDocument.metadata === 'object' && !Array.isArray(reportDocument.metadata)
        ? (reportDocument.metadata as Prisma.InputJsonObject)
        : {};
      const nextMetadata = {
        ...previousMetadata,
        valuationAttestation: {
          txHash: dto.txHash,
          navRaw: nav.toString(),
          navValidityDays: registry.navValidityDays,
          validUntil: validUntil.toISOString(),
        },
      };
      await this.prisma.$executeRawUnsafe(
        `UPDATE "asset_documents"
         SET "attestation_tx_hash" = $1, "attested_at" = $2, "verified_at" = $2, "metadata" = $3::jsonb, "updated_at" = CURRENT_TIMESTAMP
         WHERE "id" = $4`,
        dto.txHash,
        navDate,
        JSON.stringify(nextMetadata),
        reportDocument.id,
      );
    }
    await this.prisma.asset.updateMany({ where: { tokenContract: assignment.tokenContract }, data: { lifecycleState: 'INVESTMENT_READY' } });
    if (!assignment.assetRegistryAddress) {
      await this.prisma.$executeRawUnsafe(`UPDATE "asset_valuer_assignments" SET "asset_registry_address" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $2`, assetRegistryAddress, assignment.id);
      await this.prisma.$executeRawUnsafe(`UPDATE "asset_valuations" SET "asset_registry_address" = $1, "updated_at" = CURRENT_TIMESTAMP WHERE "assignment_id" = $2`, assetRegistryAddress, assignment.id);
    }
    await this.recordTransitionAndTx(assignment, updatedAssignments[0], dto.txHash, actorWallet, 'ASSET_VALUATION_ATTESTED');
    return rows[0];
  }

  async listValuations(query: { assignmentId?: string; tokenContract?: string; factoryAssetId?: number; assetRequestId?: string } = {}) {
    const tokenContract = query.tokenContract ? normalizePubkey(query.tokenContract, 'Token contract') : null;
    return this.prisma.$queryRawUnsafe<ValuationRow[]>(
      `SELECT ${this.valuationSelect()} FROM "asset_valuations"
       WHERE ($1::text IS NULL OR "assignment_id" = $1)
         AND ($2::text IS NULL OR "token_contract" = $2)
         AND ($3::int IS NULL OR "factory_asset_id" = $3)
         AND ($4::text IS NULL OR "asset_request_id" = $4)
       ORDER BY "nav_date" DESC, "created_at" DESC`,
      query.assignmentId || null, tokenContract, query.factoryAssetId || null, query.assetRequestId || null,
    );
  }

  async getReadiness(query: { assetRequestId?: string; tokenContract?: string }) {
    let assignment: AssignmentRow | null = null;
    const assignments = await this.listAssignments({ assetRequestId: query.assetRequestId, tokenContract: query.tokenContract });
    assignment = assignments.find((row) => ACTIVE_ASSIGNMENT_STATUSES.includes(row.status)) || assignments[0] || null;
    if (!assignment) {
      return { ready: false, assignment: null, valuation: null, tirTrusted: false, checks: { valuerAssigned: false, valuationExists: false, navPresent: false, valuationNotExpired: false }, reasons: [{ code: 'VALUER_NOT_ASSIGNED', message: 'Assign a platform-approved valuer before deployment.' }] };
    }

    const valuations = await this.listValuations({ assignmentId: assignment.id });
    const confirmed = valuations.find((row) => row.status === 'CONFIRMED') || null;
    const pending = valuations.find((row) => row.status === 'PENDING_ON_CHAIN') || null;
    const latest = confirmed || pending;
    const reasons: Array<{ code: string; message: string }> = [];
    const valuationExists = Boolean(latest);
    const navPresent = Boolean(latest?.navRaw && BigInt(String(latest.navRaw)) > 0n);
    const valuationNotExpired = Boolean(latest?.validUntil && new Date(String(latest.validUntil)).getTime() > Date.now());
    if (!valuationExists) reasons.push({ code: 'VALUATION_MISSING', message: 'The assigned valuer has not submitted NAV and a valuation report.' });
    if (valuationExists && !navPresent) reasons.push({ code: 'VALUATION_NAV_MISSING', message: 'The valuation NAV is missing.' });
    if (valuationExists && !valuationNotExpired) reasons.push({ code: 'VALUATION_EXPIRED', message: 'The latest valuation has expired.' });
    const tirTrusted = assignment.tokenContract && assignment.tirStateAddress ? await this.checkTirTrust(assignment).catch(() => false) : false;
    return {
      ready: reasons.length === 0,
      assignment,
      valuation: latest,
      confirmedValuation: confirmed,
      pendingValuation: pending,
      tirTrusted,
      checks: {
        valuerAssigned: true,
        valuationExists,
        navPresent,
        valuationNotExpired,
        onChainConfirmed: Boolean(confirmed),
      },
      reasons,
    };
  }

  async assertInvestmentReady(tokenContract: string) {
    const readiness = await this.getReadiness({ tokenContract });
    if (!readiness.confirmedValuation) {
      throw new BadRequestException('Asset valuation has not been confirmed on-chain yet.');
    }
    if (!readiness.ready) {
      throw new BadRequestException(readiness.reasons[0]?.message || 'Asset valuation is not investment-ready.');
    }
    return readiness;
  }

  private async findValuer(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<ValuerRow[]>(`SELECT ${this.valuerSelect()} FROM "platform_valuers" WHERE "id" = $1 LIMIT 1`, id);
    if (!rows[0]) throw new NotFoundException('Platform valuer not found.');
    return rows[0];
  }

  private async findAssignment(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(`SELECT ${this.assignmentSelect()} FROM "asset_valuer_assignments" WHERE "id" = $1 LIMIT 1`, id);
    if (!rows[0]) throw new NotFoundException('Valuer assignment not found.');
    return rows[0];
  }

  private async activeAssignment(factoryAssetId: number) {
    const rows = await this.prisma.$queryRawUnsafe<AssignmentRow[]>(
      `SELECT ${this.assignmentSelect()} FROM "asset_valuer_assignments" WHERE "factory_asset_id" = $1 AND "status" IN ('ASSIGNED','ACCEPTED','ATTESTATION_PENDING','CONFIRMED') LIMIT 1`,
      factoryAssetId,
    );
    return rows[0] || null;
  }

  private async assertConfirmedSignature(txHash: string) {
    const status = await this.connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
    if (!status.value) throw new BadRequestException('Transaction was not found on the configured Solana network.');
    if (status.value.err) throw new BadRequestException('Transaction failed on-chain.');
  }

  private async fetchIssuerEntry(address: string) {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'confirmed');
    if (!info) throw new BadRequestException('IssuerEntry account does not exist on-chain.');
    return decodeIssuerEntry(Buffer.from(info.data));
  }

  private async fetchAssetRegistry(address: string) {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'confirmed');
    if (!info) throw new BadRequestException('AssetRegistry account does not exist on-chain.');
    const decoded = decodeAssetRegistry(Buffer.from(info.data));
    if (decoded.navDate <= 0n) throw new BadRequestException('AssetRegistry has no valuation attestation yet.');
    return decoded;
  }

  private async checkTirTrust(assignment: AssignmentRow) {
    try {
      const tirStateAddress = assignment.tirStateAddress || (assignment.tokenContract ? this.deriveTirState(assignment.tokenContract).toBase58() : null);
      if (!tirStateAddress) return false;
      const entryAddress = this.deriveIssuerEntry(tirStateAddress, assignment.valuerFid).toBase58();
      const entry = await this.fetchIssuerEntry(entryAddress);
      return entry.active && entry.issuerFid === assignment.valuerFid && entry.tir === tirStateAddress && entry.topics.includes(TOPIC_VALUATION);
    } catch {
      return false;
    }
  }


  private async resolveAssetRequestForValuationReport(assetId: string) {
    const direct = await this.prisma.assetRequest.findUnique({ where: { id: assetId } });
    if (direct) return direct;

    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (asset?.factoryAssetId) {
      const request = await this.prisma.assetRequest.findFirst({ where: { factoryAssetId: asset.factoryAssetId } });
      if (request) return request;
    }

    const factoryAssetId = Number(assetId);
    if (Number.isInteger(factoryAssetId) && factoryAssetId > 0) {
      const request = await this.prisma.assetRequest.findFirst({ where: { factoryAssetId } });
      if (request) return request;
    }

    const byToken = normalizePubkey(assetId, 'Asset id or token contract');
    const request = await this.prisma.assetRequest.findFirst({ where: { deployedAssetId: byToken } });
    if (request) return request;

    throw new NotFoundException('Asset request not found for valuation report lookup.');
  }

  private documentBucket() {
    return process.env.SUPABASE_DOCUMENTS_BUCKET?.trim() || process.env.SUPABASE_LEGAL_DOCS_BUCKET?.trim() || DEFAULT_DOCUMENT_BUCKET;
  }

  private supabaseStorageConfig() {
    const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!url || !serviceKey) {
      throw new InternalServerErrorException('Supabase server storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }
    return { url, serviceKey };
  }

  private sanitizeStoragePart(value: string) {
    const clean = value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120);
    return clean || 'valuation-report.pdf';
  }

  private storageObjectUrl(baseUrl: string, bucket: string, storageKey: string) {
    const encodedKey = storageKey.split('/').map((part) => encodeURIComponent(part)).join('/');
    return `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedKey}`;
  }

  private async uploadStorageObject(bucket: string, storageKey: string, buffer: Buffer, mimeType: string) {
    const { url, serviceKey } = this.supabaseStorageConfig();
    const response = await fetch(this.storageObjectUrl(url, bucket, storageKey), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => 'Supabase upload failed.');
      throw new BadRequestException(message || 'Supabase upload failed.');
    }
  }

  private async createSignedStorageUrl(bucket: string, storageKey: string) {
    const { url, serviceKey } = this.supabaseStorageConfig();
    const response = await fetch(`${this.storageObjectUrl(url, bucket, storageKey).replace('/object/', '/object/sign/')}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    });
    if (!response.ok) {
      const message = await response.text().catch(() => 'Failed to create signed document URL.');
      throw new BadRequestException(message || 'Failed to create signed document URL.');
    }
    const payload = (await response.json()) as { signedURL?: string; signedUrl?: string };
    const signedPath = payload.signedURL || payload.signedUrl;
    if (!signedPath) throw new BadRequestException('Supabase did not return a signed URL.');
    return signedPath.startsWith('http') ? signedPath : `${url}/storage/v1${signedPath}`;
  }
  private async recordTransitionAndTx(previous: AssignmentRow, current: AssignmentRow, txHash: string, actorWallet: string | null, actionType: string) {
    await this.workflows.record({ entityType: 'AssetValuerAssignment', entityId: current.id, fromStatus: previous.status, toStatus: current.status, actorWallet, txHash, metadata: { assetRequestId: current.assetRequestId, factoryAssetId: current.factoryAssetId, tokenContract: current.tokenContract, valuerFid: current.valuerFid } });
    await this.blockchainTransactions.record({ txHash, actionType, actorWallet, entityType: 'AssetValuerAssignment', entityId: current.id, assetId: String(current.factoryAssetId), tokenContract: current.tokenContract, metadata: { assetRequestId: current.assetRequestId, assetRegistryAddress: current.assetRegistryAddress, valuerWallet: current.valuerWallet, valuerFid: current.valuerFid } });
  }
}





