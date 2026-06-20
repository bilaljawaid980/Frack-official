import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { DocumentType, DocumentVisibility, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAssetDocumentDto } from './dto/create-asset-document.dto';

export const REQUIRED_DEPLOYMENT_DOCUMENT_TYPES: DocumentType[] = [
  DocumentType.FARD,
  DocumentType.LEGAL_OPINION,
  DocumentType.WHITEPAPER,
];

const TYPE_ALIASES: Record<string, DocumentType> = {
  FARD: DocumentType.FARD,
  fard: DocumentType.FARD,
  title_deed: DocumentType.FARD,
  title: DocumentType.FARD,
  ownership_proof: DocumentType.FARD,
  sale_deed: DocumentType.SALE_DEED,
  mutation_record: DocumentType.MUTATION_RECORD,
  spv_registration: DocumentType.SPV_REGISTRATION,
  legal_opinion: DocumentType.LEGAL_OPINION,
  LEGAL_OPINION: DocumentType.LEGAL_OPINION,
  whitepaper: DocumentType.WHITEPAPER,
  WHITEPAPER: DocumentType.WHITEPAPER,
  insurance_policy: DocumentType.INSURANCE_POLICY,
  valuation_report: DocumentType.VALUATION_REPORT,
  VALUATION_REPORT: DocumentType.VALUATION_REPORT,
  appraisal: DocumentType.VALUATION_REPORT,
  asset_document: DocumentType.OTHER,
  other: DocumentType.OTHER,
  id_card: DocumentType.OTHER,
  passport: DocumentType.OTHER,
  proof_of_address: DocumentType.OTHER,
};

const PUBLIC_TYPES = new Set<DocumentType>([
  DocumentType.FARD,
  DocumentType.SALE_DEED,
  DocumentType.MUTATION_RECORD,
  DocumentType.SPV_REGISTRATION,
  DocumentType.LEGAL_OPINION,
  DocumentType.WHITEPAPER,
  DocumentType.INSURANCE_POLICY,
  DocumentType.VALUATION_REPORT,
]);

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function normalizeDocumentType(value: unknown): DocumentType {
  const raw = stringValue(value) || 'OTHER';
  return TYPE_ALIASES[raw] || TYPE_ALIASES[raw.toLowerCase()] || DocumentType.OTHER;
}

function deriveFallbackHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function accessUrl(bucket: string, storageKey: string, publicUrl?: string | null) {
  if (publicUrl) return publicUrl;
  const params = new URLSearchParams({ bucket, path: storageKey });
  return `/api/legal-docs/file?${params.toString()}`;
}

@Injectable()
export class AssetDocumentsService {
  constructor(private readonly prisma: PrismaService) {}

  async createForAsset(assetId: string, dto: CreateAssetDocumentDto) {
    const request = await this.resolveAssetRequest(assetId);
    return this.upsertDocument(request, dto, dto.uploadedByWallet || request.issuerWallet);
  }

  async registerForAsset(assetId: string, documents: CreateAssetDocumentDto[], uploadedByWallet?: string) {
    const request = await this.resolveAssetRequest(assetId);
    return this.createManyForAssetRequest(request.id, documents, uploadedByWallet || request.issuerWallet);
  }

  async createManyForAssetRequest(assetRequestId: string, documents: unknown, uploadedByWallet?: string | null) {
    const request = await this.prisma.assetRequest.findUnique({ where: { id: assetRequestId } });
    if (!request) throw new NotFoundException('Asset request not found');

    const list = Array.isArray(documents) ? documents : [];
    if (list.length === 0) return [];

    const rows = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      rows.push(await this.upsertDocument(request, entry as CreateAssetDocumentDto, uploadedByWallet || request.issuerWallet));
    }
    return rows;
  }

  async listForAsset(assetId: string, options: { includePrivate?: boolean } = {}) {
    const request = await this.resolveAssetRequest(assetId);
    const rows = await this.prisma.assetDocument.findMany({
      where: {
        assetRequestId: request.id,
        deletedAt: null,
        ...(options.includePrivate ? {} : { visibility: DocumentVisibility.PUBLIC }),
      },
      orderBy: [{ type: 'asc' }, { uploadedAt: 'desc' }],
    });

    return rows.map((row) => ({
      id: row.id,
      assetRequestId: row.assetRequestId,
      factoryAssetId: row.factoryAssetId,
      deployedAssetId: row.deployedAssetId,
      type: row.type,
      visibility: row.visibility,
      bucket: options.includePrivate ? row.bucket : undefined,
      storageKey: options.includePrivate ? row.storageKey : undefined,
      accessUrl: accessUrl(row.bucket, row.storageKey, (row.metadata as Record<string, unknown> | null)?.publicUrl as string | undefined),
      fileHash: row.fileHash,
      fileName: row.fileName,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      uploadedAt: row.uploadedAt,
      uploadedByWallet: options.includePrivate ? row.uploadedByWallet : undefined,
      verifiedAt: row.verifiedAt,
    }));
  }

  async softDelete(assetId: string, documentId: string, actorWallet?: string | null) {
    const request = await this.resolveAssetRequest(assetId);
    if (request.status === 'DEPLOYED') {
      throw new ForbiddenException('Documents cannot be deleted after deployment.');
    }
    if (actorWallet && actorWallet !== request.issuerWallet) {
      throw new ForbiddenException('Only the issuer wallet or platform admin can delete asset documents.');
    }

    const existing = await this.prisma.assetDocument.findFirst({
      where: { id: documentId, assetRequestId: request.id, deletedAt: null },
    });
    if (!existing) throw new NotFoundException('Asset document not found');

    return this.prisma.assetDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
  }

  async getDeploymentDocumentReadiness(assetRequestId: string, legacyDocuments?: unknown) {
    const rows = await this.prisma.assetDocument.findMany({
      where: {
        assetRequestId,
        deletedAt: null,
        type: { in: REQUIRED_DEPLOYMENT_DOCUMENT_TYPES },
      },
      select: { type: true, fileHash: true },
    });

    const present = new Set(rows.filter((row) => row.fileHash).map((row) => row.type));
    for (const type of this.extractLegacyTypes(legacyDocuments)) {
      if (REQUIRED_DEPLOYMENT_DOCUMENT_TYPES.includes(type)) present.add(type);
    }

    const missing = REQUIRED_DEPLOYMENT_DOCUMENT_TYPES.filter((type) => !present.has(type));
    return {
      requiredTypes: REQUIRED_DEPLOYMENT_DOCUMENT_TYPES,
      presentTypes: REQUIRED_DEPLOYMENT_DOCUMENT_TYPES.filter((type) => present.has(type)),
      missingTypes: missing,
      requiredDocumentsPresent: missing.length === 0,
    };
  }

  private async resolveAssetRequest(assetId: string) {
    const direct = await this.prisma.assetRequest.findUnique({ where: { id: assetId } });
    if (direct) return direct;

    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (asset?.factoryAssetId) {
      const request = await this.prisma.assetRequest.findFirst({ where: { factoryAssetId: asset.factoryAssetId } });
      if (request) return request;
    }

    const byFactoryId = Number(assetId);
    if (Number.isInteger(byFactoryId) && byFactoryId > 0) {
      const request = await this.prisma.assetRequest.findFirst({ where: { factoryAssetId: byFactoryId } });
      if (request) return request;
    }

    throw new NotFoundException('Asset request not found for document lookup');
  }

  private async upsertDocument(request: { id: string; factoryAssetId: number | null; deployedAssetId: string | null; issuerWallet: string }, dto: CreateAssetDocumentDto, uploadedByWallet?: string | null) {
    const storageKey = stringValue(dto.storageKey) || stringValue(dto.path);
    if (!storageKey) throw new BadRequestException('Document storageKey/path is required.');

    const bucket = stringValue(dto.bucket) || process.env.SUPABASE_LEGAL_DOCS_BUCKET || 'legal-docs';
    const type = normalizeDocumentType(dto.documentType || dto.type);
    const visibility = dto.visibility || (PUBLIC_TYPES.has(type) ? DocumentVisibility.PUBLIC : DocumentVisibility.PRIVATE);
    const fileName = stringValue(dto.fileName) || stringValue(dto.name) || storageKey.split('/').pop() || 'document';
    const mimeType = stringValue(dto.mimeType) || stringValue(dto.type) || 'application/octet-stream';
    const sizeBytes = numberValue(dto.sizeBytes ?? dto.size);
    const fileHash = stringValue(dto.fileHash) || stringValue(dto.hash) || deriveFallbackHash(`${bucket}/${storageKey}/${sizeBytes}`);

    const metadata: Prisma.InputJsonObject = {
      source: 'LEGAL_DOC_UPLOAD',
      publicUrl: stringValue(dto.publicUrl),
      originalDocumentType: stringValue(dto.documentType || dto.type),
    };

    return this.prisma.assetDocument.upsert({
      where: {
        assetRequestId_storageKey: {
          assetRequestId: request.id,
          storageKey,
        },
      },
      update: {
        factoryAssetId: request.factoryAssetId,
        deployedAssetId: request.deployedAssetId,
        type,
        visibility,
        bucket,
        fileHash,
        fileName,
        mimeType,
        sizeBytes,
        uploadedByWallet: uploadedByWallet || null,
        metadata,
        deletedAt: null,
      },
      create: {
        assetRequestId: request.id,
        factoryAssetId: request.factoryAssetId,
        deployedAssetId: request.deployedAssetId,
        type,
        visibility,
        bucket,
        storageKey,
        fileHash,
        fileName,
        mimeType,
        sizeBytes,
        uploadedByWallet: uploadedByWallet || null,
        metadata,
      },
    });
  }

  private extractLegacyTypes(documents: unknown) {
    if (!Array.isArray(documents)) return [];
    return documents
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        return normalizeDocumentType(record.documentType || record.type);
      })
      .filter((type): type is DocumentType => Boolean(type));
  }
}
