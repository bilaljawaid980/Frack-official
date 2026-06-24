import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { BlockchainTransactionsService } from '../blockchain-transactions/blockchain-transactions.service';
import { AssetDocumentsService } from '../asset-documents/asset-documents.service';
import { getIndexerConfig } from '../indexer/indexer.config';
import {
  CreateCustodyMandateDto,
  RecordCustodyAttestationDto,
  RecordCustodyMandateAcceptanceDto,
  RecordCustodyMandateCreationDto,
} from './dto/custody.dto';

const TOPIC_CUSTODIAN_AUTHORITY = 4n;
const MANDATE_SEED = Buffer.from('custody_mandate');
const ATTESTATION_SEED = Buffer.from('custody_attestation');
const PLATFORM_AUTHORITY_SEED = Buffer.from('platform_authority');

type CustodyMandateRow = {
  id: string;
  assetRequestId: string;
  factoryAssetId: number;
  issuerWallet: string;
  issuerFid: string;
  custodianWallet: string;
  custodianFid: string;
  mandateAddress: string | null;
  status: string;
  createTxHash: string | null;
  acceptTxHash: string | null;
  releaseTxHash: string | null;
  acceptedAt: Date | null;
  releasedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type CustodyAttestationRow = {
  id: string;
  mandateId: string;
  factoryAssetId: number;
  attestationAddress: string;
  documentHash: string;
  attestationHash: string;
  reserveRatioBps: number | null;
  status: string;
  txHash: string;
  attestedAt: Date | null;
  expiresAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type DecodedCustodyMandate = {
  assetId: bigint;
  issuer: string;
  issuerFid: string;
  custodian: string;
  custodianFid: string;
  active: boolean;
  accepted: boolean;
  createdAt: bigint;
  acceptedAt: bigint;
  releasedAt: bigint;
  releaseNoticeAt: bigint;
  bump: number;
};


type DecodedPlatformAuthority = {
  authorityFid: string;
  topic: bigint;
  active: boolean;
  createdAt: bigint;
  bump: number;
};
type DecodedCustodyAttestation = {
  assetId: bigint;
  custodyMandate: string;
  custodian: string;
  custodianFid: string;
  documentHash: string;
  attestationHash: string;
  reserveRatioBps: number;
  attestedAt: bigint;
  expiresAt: bigint;
  active: boolean;
  bump: number;
};

function getPublicKeyEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return new PublicKey(value);
  }
  throw new Error(`Missing required program id env: ${names.join(' or ')}`);
}

function u64Le(value: number | bigint) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function i64ToDate(value: bigint) {
  if (value <= 0n) return null;
  return new Date(Number(value) * 1000);
}

function hex(bytes: Buffer) {
  return bytes.toString('hex');
}

export function computeFactoryAssetId(seed: string) {
  const source = seed && seed.trim().length > 0 ? seed : `${Date.now()}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const positive = hash >>> 0;
  return (positive % 2147483646) + 1;
}

function assertHex32(value: string, label: string) {
  const clean = value.trim().toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{64}$/.test(clean)) {
    throw new BadRequestException(`${label} must be a 32-byte hex string.`);
  }
  return clean;
}

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function decodeMandate(data: Buffer): DecodedCustodyMandate {
  let offset = 8;
  const assetId = data.readBigUInt64LE(offset); offset += 8;
  const issuer = readPubkey(data, offset); offset += 32;
  const issuerFid = readPubkey(data, offset); offset += 32;
  const custodian = readPubkey(data, offset); offset += 32;
  const custodianFid = readPubkey(data, offset); offset += 32;
  const active = data[offset] === 1; offset += 1;
  const accepted = data[offset] === 1; offset += 1;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const acceptedAt = data.readBigInt64LE(offset); offset += 8;
  const releasedAt = data.readBigInt64LE(offset); offset += 8;
  const releaseNoticeAt = data.readBigInt64LE(offset); offset += 8;
  const bump = data[offset];
  return { assetId, issuer, issuerFid, custodian, custodianFid, active, accepted, createdAt, acceptedAt, releasedAt, releaseNoticeAt, bump };
}


function decodePlatformAuthority(data: Buffer): DecodedPlatformAuthority {
  let offset = 8;
  const authorityFid = readPubkey(data, offset); offset += 32;
  const topic = data.readBigUInt64LE(offset); offset += 8;
  const active = data[offset] === 1; offset += 1;
  const createdAt = data.readBigInt64LE(offset); offset += 8;
  const bump = data[offset];
  return { authorityFid, topic, active, createdAt, bump };
}
function decodeAttestation(data: Buffer): DecodedCustodyAttestation {
  let offset = 8;
  const assetId = data.readBigUInt64LE(offset); offset += 8;
  const custodyMandate = readPubkey(data, offset); offset += 32;
  const custodian = readPubkey(data, offset); offset += 32;
  const custodianFid = readPubkey(data, offset); offset += 32;
  const documentHash = hex(data.subarray(offset, offset + 32)); offset += 32;
  const attestationHash = hex(data.subarray(offset, offset + 32)); offset += 32;
  const reserveRatioBps = data.readUInt16LE(offset); offset += 2;
  const attestedAt = data.readBigInt64LE(offset); offset += 8;
  const expiresAt = data.readBigInt64LE(offset); offset += 8;
  const active = data[offset] === 1; offset += 1;
  const bump = data[offset];
  return { assetId, custodyMandate, custodian, custodianFid, documentHash, attestationHash, reserveRatioBps, attestedAt, expiresAt, active, bump };
}

@Injectable()
export class CustodyService {
  private readonly connection = new Connection(getIndexerConfig().rpcEndpoint, 'confirmed');
  private readonly factoryProgramId = getPublicKeyEnv('FRACKS_FACTORY', 'FACTORY_PROGRAM_ID', 'NEXT_PUBLIC_FACTORY_PROGRAM_ID', 'NEXT_PUBLIC_FRACKS_FACTORY');

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflows: WorkflowsService,
    private readonly blockchainTransactions: BlockchainTransactionsService,
    private readonly assetDocuments: AssetDocumentsService,
  ) {}

  deriveCustodyMandate(factoryAssetId: number) {
    const [address] = PublicKey.findProgramAddressSync(
      [MANDATE_SEED, u64Le(factoryAssetId)],
      this.factoryProgramId,
    );
    return address;
  }

  deriveCustodyAttestation(mandateAddress: string) {
    const [address] = PublicKey.findProgramAddressSync(
      [ATTESTATION_SEED, new PublicKey(mandateAddress).toBuffer()],
      this.factoryProgramId,
    );
    return address;
  }

  derivePlatformAuthority(custodianFid: string) {
    const [address] = PublicKey.findProgramAddressSync(
      [PLATFORM_AUTHORITY_SEED, new PublicKey(custodianFid).toBuffer(), u64Le(TOPIC_CUSTODIAN_AUTHORITY)],
      this.factoryProgramId,
    );
    return address;
  }

  async createForAssetRequest(assetRequestId: string, dto: CreateCustodyMandateDto) {
    const request = await this.prisma.assetRequest.findUnique({ where: { id: assetRequestId } });
    if (!request) throw new NotFoundException('Asset request not found');

    const factoryAssetId = request.factoryAssetId ?? computeFactoryAssetId(request.id);
    if (!request.factoryAssetId) {
      await this.prisma.assetRequest.update({ where: { id: request.id }, data: { factoryAssetId } });
    }

    if (dto.issuerFid === dto.custodianFid) {
      throw new BadRequestException('Custodian FID must be different from issuer FID.');
    }

    const approvedCustodians = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "platform_custodians"
      WHERE "wallet_address" = ${dto.custodianWallet}
        AND "fid_address" = ${dto.custodianFid}
        AND "status" = 'APPROVED'
        AND "authority_topic" = 4
      LIMIT 1
    `;
    if (approvedCustodians.length === 0) {
      throw new BadRequestException('Custodian must be registered as an APPROVED platform custodian with PlatformAuthority topic 4.');
    }

    const mandateAddress = this.deriveCustodyMandate(factoryAssetId).toBase58();
    const metadata = JSON.stringify({ ...(dto.metadata || {}), expectedMandateAddress: mandateAddress });
    const now = new Date();
    const rows = await this.prisma.$queryRaw<CustodyMandateRow[]>`
      INSERT INTO "custody_mandates" (
        "id", "asset_request_id", "factory_asset_id", "issuer_wallet", "issuer_fid",
        "custodian_wallet", "custodian_fid", "mandate_address", "status", "metadata",
        "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}, ${assetRequestId}, ${factoryAssetId}, ${request.issuerWallet}, ${dto.issuerFid},
        ${dto.custodianWallet}, ${dto.custodianFid}, ${mandateAddress}, 'ASSIGNED', ${metadata}::jsonb,
        ${now}, ${now}
      )
      ON CONFLICT ("asset_request_id", "custodian_wallet") DO UPDATE SET
        "issuer_fid" = EXCLUDED."issuer_fid",
        "custodian_fid" = EXCLUDED."custodian_fid",
        "mandate_address" = EXCLUDED."mandate_address",
        "metadata" = EXCLUDED."metadata",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;

    await this.workflows.record({
      entityType: 'CustodyMandate',
      entityId: rows[0].id,
      toStatus: rows[0].status,
      actorWallet: request.issuerWallet,
      metadata: { assetRequestId, factoryAssetId, mandateAddress },
    });

    return { ...rows[0], expectedMandateAddress: mandateAddress, platformAuthorityAddress: this.derivePlatformAuthority(dto.custodianFid).toBase58() };
  }

  async list(query: { custodianWallet?: string; assetRequestId?: string; factoryAssetId?: number; status?: string }) {
    return this.prisma.$queryRaw<CustodyMandateRow[]>`
      SELECT
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "custody_mandates"
      WHERE (${query.custodianWallet || null}::text IS NULL OR lower("custodian_wallet") = lower(${query.custodianWallet || null}))
        AND (${query.assetRequestId || null}::text IS NULL OR "asset_request_id" = ${query.assetRequestId || null})
        AND (${query.factoryAssetId || null}::int IS NULL OR "factory_asset_id" = ${query.factoryAssetId || null})
        AND (${query.status || null}::text IS NULL OR "status" = ${query.status || null})
      ORDER BY "created_at" DESC
    `;
  }

  async findOne(id: string) {
    const mandate = await this.findMandate(id);
    const attestations = await this.prisma.$queryRaw<CustodyAttestationRow[]>`
      SELECT
        "id", "mandate_id" AS "mandateId", "factory_asset_id" AS "factoryAssetId",
        "attestation_address" AS "attestationAddress", "document_hash" AS "documentHash",
        "attestation_hash" AS "attestationHash", "reserve_ratio_bps" AS "reserveRatioBps",
        "status", "tx_hash" AS "txHash", "attested_at" AS "attestedAt", "expires_at" AS "expiresAt",
        "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "custody_attestations"
      WHERE "mandate_id" = ${id}
      ORDER BY "created_at" DESC
    `;
    return { ...mandate, attestations };
  }

  async recordCreation(id: string, dto: RecordCustodyMandateCreationDto) {
    const mandate = await this.findMandate(id);
    await this.assertConfirmedSignature(dto.txHash);
    const expected = this.deriveCustodyMandate(mandate.factoryAssetId).toBase58();
    if (dto.mandateAddress !== expected) throw new BadRequestException('Mandate PDA does not match the asset id.');
    const decoded = await this.fetchMandate(dto.mandateAddress);
    this.assertMandateMatches(mandate, decoded);

    const rows = await this.prisma.$queryRaw<CustodyMandateRow[]>`
      UPDATE "custody_mandates"
      SET "status" = ${decoded.active && decoded.accepted ? 'ACCEPTED' : 'ONCHAIN_CREATED'},
          "create_tx_hash" = ${dto.txHash},
          "mandate_address" = ${dto.mandateAddress},
          "accepted_at" = ${i64ToDate(decoded.acceptedAt)},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
      RETURNING
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;
    await this.recordTransitionAndTx(mandate, rows[0], dto.txHash, dto.actorWallet, 'CUSTODY_MANDATE_CREATED');
    return rows[0];
  }

  async recordAcceptance(id: string, dto: RecordCustodyMandateAcceptanceDto) {
    const mandate = await this.findMandate(id);
    if (!mandate.mandateAddress) throw new BadRequestException('Mandate PDA has not been recorded.');
    await this.assertConfirmedSignature(dto.txHash);
    const decoded = await this.fetchMandate(mandate.mandateAddress);
    this.assertMandateMatches(mandate, decoded);
    if (!decoded.active || !decoded.accepted) throw new BadRequestException('Mandate is not accepted on-chain.');

    const rows = await this.prisma.$queryRaw<CustodyMandateRow[]>`
      UPDATE "custody_mandates"
      SET "status" = 'ATTESTATION_PENDING',
          "accept_tx_hash" = ${dto.txHash},
          "accepted_at" = ${i64ToDate(decoded.acceptedAt)},
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
      RETURNING
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;
    await this.recordTransitionAndTx(mandate, rows[0], dto.txHash, dto.actorWallet || mandate.custodianWallet, 'CUSTODY_MANDATE_ACCEPTED');
    return rows[0];
  }

  async recordAttestation(id: string, dto: RecordCustodyAttestationDto) {
    const mandate = await this.findMandate(id);
    if (!mandate.mandateAddress) throw new BadRequestException('Mandate PDA has not been recorded.');
    const documentHash = assertHex32(dto.documentHash, 'documentHash');
    const attestationHash = assertHex32(dto.attestationHash, 'attestationHash');
    const expected = this.deriveCustodyAttestation(mandate.mandateAddress).toBase58();
    if (dto.attestationAddress !== expected) throw new BadRequestException('Attestation PDA does not match the mandate.');
    await this.assertConfirmedSignature(dto.txHash);
    const decoded = await this.fetchAttestation(dto.attestationAddress);
    this.assertAttestationMatches(mandate, decoded, documentHash, attestationHash);

    const status = decoded.active && decoded.expiresAt > BigInt(Math.floor(Date.now() / 1000)) ? 'READY' : 'ATTESTATION_EXPIRED';
    const metadata = JSON.stringify(dto.metadata || {});
    const attestNow = new Date();
    const attestationRows = await this.prisma.$queryRaw<CustodyAttestationRow[]>`
      INSERT INTO "custody_attestations" (
        "id", "mandate_id", "factory_asset_id", "attestation_address", "document_hash",
        "attestation_hash", "reserve_ratio_bps", "status", "tx_hash", "attested_at", "expires_at", "metadata",
        "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}, ${id}, ${mandate.factoryAssetId}, ${dto.attestationAddress}, ${documentHash},
        ${attestationHash}, ${decoded.reserveRatioBps}, ${status === 'READY' ? 'ACTIVE' : 'EXPIRED'}, ${dto.txHash},
        ${i64ToDate(decoded.attestedAt)}, ${i64ToDate(decoded.expiresAt)}, ${metadata}::jsonb,
        ${attestNow}, ${attestNow}
      )
      ON CONFLICT ("attestation_address", "tx_hash") DO UPDATE SET
        "document_hash" = EXCLUDED."document_hash",
        "attestation_hash" = EXCLUDED."attestation_hash",
        "reserve_ratio_bps" = EXCLUDED."reserve_ratio_bps",
        "status" = EXCLUDED."status",
        "attested_at" = EXCLUDED."attested_at",
        "expires_at" = EXCLUDED."expires_at",
        "metadata" = EXCLUDED."metadata",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING
        "id", "mandate_id" AS "mandateId", "factory_asset_id" AS "factoryAssetId",
        "attestation_address" AS "attestationAddress", "document_hash" AS "documentHash",
        "attestation_hash" AS "attestationHash", "reserve_ratio_bps" AS "reserveRatioBps",
        "status", "tx_hash" AS "txHash", "attested_at" AS "attestedAt", "expires_at" AS "expiresAt",
        "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;

    const updatedMandates = await this.prisma.$queryRaw<CustodyMandateRow[]>`
      UPDATE "custody_mandates"
      SET "status" = ${status}, "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${id}
      RETURNING
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;
    await this.recordTransitionAndTx(mandate, updatedMandates[0], dto.txHash, dto.actorWallet || mandate.custodianWallet, 'CUSTODY_ATTESTED');
    return { mandate: updatedMandates[0], attestation: attestationRows[0] };
  }

  async getDeploymentReadiness(assetRequestId: string) {
    const request = await this.prisma.assetRequest.findUnique({ where: { id: assetRequestId } });
    if (!request) throw new NotFoundException('Asset request not found');
    const factoryAssetId = request.factoryAssetId ?? computeFactoryAssetId(request.id);
    const mandates = await this.list({ assetRequestId });
    const mandate = mandates[0] || null;
    const expectedMandate = this.deriveCustodyMandate(factoryAssetId).toBase58();
    const expectedAttestation = this.deriveCustodyAttestation(expectedMandate).toBase58();

    const blockchainChecks = {
      mandateExists: false,
      mandateAccepted: false,
      custodyAttestationExists: false,
      custodyAttestationMatchesMandate: false,
      custodyAttestationValid: false,
      custodyAttestationExpired: false,
      platformAuthorityExists: false,
    };
    const reasons: Array<{ code: string; message: string }> = [];
    const documentChecks = await this.assetDocuments.getDeploymentDocumentReadiness(assetRequestId, request.documents);
    if (!documentChecks.requiredDocumentsPresent) {
      reasons.push({
        code: 'REQUIRED_DOCUMENTS_MISSING',
        message: `Required deployment documents are missing: ${documentChecks.missingTypes.join(', ')}.`,
      });
    }

    if (!mandate) {
      reasons.push({ code: 'CUSTODY_MANDATE_NOT_ASSIGNED', message: 'Assign a custodian before deployment.' });
      return { ready: false, factoryAssetId, expectedMandate, expectedAttestation, backendChecks: { mandateAssigned: false, documentChecks }, blockchainChecks, documentChecks, reasons };
    }

    const platformAuthority = this.derivePlatformAuthority(mandate.custodianFid).toBase58();
    const [mandateInfo, attestationInfo, platformAuthorityInfo] = await this.connection.getMultipleAccountsInfo([
      new PublicKey(expectedMandate),
      new PublicKey(expectedAttestation),
      new PublicKey(platformAuthority),
    ]);
    if (platformAuthorityInfo) {
      const decodedAuthority = decodePlatformAuthority(Buffer.from(platformAuthorityInfo.data));
      blockchainChecks.platformAuthorityExists =
        decodedAuthority.active &&
        decodedAuthority.topic === TOPIC_CUSTODIAN_AUTHORITY &&
        decodedAuthority.authorityFid === mandate.custodianFid;
    }

    let decodedMandate: DecodedCustodyMandate | null = null;
    if (mandateInfo) {
      decodedMandate = decodeMandate(Buffer.from(mandateInfo.data));
      blockchainChecks.mandateExists = true;
      blockchainChecks.mandateAccepted = decodedMandate.active && decodedMandate.accepted;
    }

    if (attestationInfo && decodedMandate) {
      const decoded = decodeAttestation(Buffer.from(attestationInfo.data));
      blockchainChecks.custodyAttestationExists = true;
      blockchainChecks.custodyAttestationMatchesMandate = decoded.custodyMandate === expectedMandate;
      blockchainChecks.custodyAttestationExpired = decoded.expiresAt <= BigInt(Math.floor(Date.now() / 1000));
      blockchainChecks.custodyAttestationValid = decoded.active && !blockchainChecks.custodyAttestationExpired && decoded.assetId === BigInt(factoryAssetId);
    }

    if (!blockchainChecks.platformAuthorityExists) reasons.push({ code: 'CUSTODIAN_AUTHORITY_MISSING', message: 'The custodian is not approved as platform custodian authority.' });
    if (!blockchainChecks.mandateExists) reasons.push({ code: 'CUSTODY_MANDATE_MISSING', message: 'Create the custody mandate on-chain.' });
    if (blockchainChecks.mandateExists && !blockchainChecks.mandateAccepted) reasons.push({ code: 'CUSTODY_MANDATE_NOT_ACCEPTED', message: 'The custodian must accept the custody mandate.' });
    if (!blockchainChecks.custodyAttestationExists) reasons.push({ code: 'CUSTODY_ATTESTATION_MISSING', message: 'The custodian must submit a custody attestation.' });
    if (blockchainChecks.custodyAttestationExpired) reasons.push({ code: 'CUSTODY_ATTESTATION_EXPIRED', message: 'The custody attestation has expired.' });

    const latestAttestations = await this.prisma.$queryRaw<CustodyAttestationRow[]>`
      SELECT
        "id", "mandate_id" AS "mandateId", "factory_asset_id" AS "factoryAssetId",
        "attestation_address" AS "attestationAddress", "document_hash" AS "documentHash",
        "attestation_hash" AS "attestationHash", "reserve_ratio_bps" AS "reserveRatioBps",
        "status", "tx_hash" AS "txHash", "attested_at" AS "attestedAt", "expires_at" AS "expiresAt",
        "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "custody_attestations"
      WHERE "mandate_id" = ${mandate.id}
      ORDER BY "created_at" DESC
      LIMIT 1
    `;

    const ready =
      blockchainChecks.platformAuthorityExists &&
      blockchainChecks.mandateExists &&
      blockchainChecks.mandateAccepted &&
      blockchainChecks.custodyAttestationExists &&
      blockchainChecks.custodyAttestationMatchesMandate &&
      blockchainChecks.custodyAttestationValid &&
      !blockchainChecks.custodyAttestationExpired &&
      documentChecks.requiredDocumentsPresent &&
      reasons.length === 0;
    return {
      ready,
      factoryAssetId,
      expectedMandate,
      expectedAttestation,
      platformAuthority,
      mandate,
      attestation: latestAttestations[0] || null,
      backendChecks: {
        mandateAssigned: true,
        backendStatus: mandate.status,
        mandateAddressRecorded: mandate.mandateAddress === expectedMandate,
        documentChecks,
      },
      blockchainChecks,
      documentChecks,
      reasons,
    };
  }

  private async findMandate(id: string) {
    const rows = await this.prisma.$queryRaw<CustodyMandateRow[]>`
      SELECT
        "id", "asset_request_id" AS "assetRequestId", "factory_asset_id" AS "factoryAssetId",
        "issuer_wallet" AS "issuerWallet", "issuer_fid" AS "issuerFid",
        "custodian_wallet" AS "custodianWallet", "custodian_fid" AS "custodianFid",
        "mandate_address" AS "mandateAddress", "status", "create_tx_hash" AS "createTxHash",
        "accept_tx_hash" AS "acceptTxHash", "release_tx_hash" AS "releaseTxHash",
        "accepted_at" AS "acceptedAt", "released_at" AS "releasedAt", "metadata",
        "created_at" AS "createdAt", "updated_at" AS "updatedAt"
      FROM "custody_mandates"
      WHERE "id" = ${id}
      LIMIT 1
    `;
    if (!rows[0]) throw new NotFoundException('Custody mandate not found');
    return rows[0];
  }

  private async assertConfirmedSignature(txHash: string) {
    const status = await this.connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
    if (!status.value) throw new BadRequestException('Transaction was not found on the configured Solana network.');
    if (status.value.err) throw new BadRequestException('Transaction failed on-chain.');
  }

  private async fetchMandate(address: string) {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'confirmed');
    if (!info) throw new BadRequestException('Custody mandate account does not exist on-chain.');
    return decodeMandate(Buffer.from(info.data));
  }

  private async fetchAttestation(address: string) {
    const info = await this.connection.getAccountInfo(new PublicKey(address), 'confirmed');
    if (!info) throw new BadRequestException('Custody attestation account does not exist on-chain.');
    return decodeAttestation(Buffer.from(info.data));
  }

  private assertMandateMatches(mandate: CustodyMandateRow, decoded: DecodedCustodyMandate) {
    if (decoded.assetId !== BigInt(mandate.factoryAssetId)) throw new BadRequestException('On-chain mandate asset id does not match.');
    if (decoded.issuer !== mandate.issuerWallet) throw new BadRequestException('On-chain mandate issuer does not match.');
    if (decoded.issuerFid !== mandate.issuerFid) throw new BadRequestException('On-chain issuer FID does not match.');
    if (decoded.custodian !== mandate.custodianWallet) throw new BadRequestException('On-chain custodian wallet does not match.');
    if (decoded.custodianFid !== mandate.custodianFid) throw new BadRequestException('On-chain custodian FID does not match.');
  }

  private assertAttestationMatches(mandate: CustodyMandateRow, decoded: DecodedCustodyAttestation, documentHash: string, attestationHash: string) {
    if (decoded.assetId !== BigInt(mandate.factoryAssetId)) throw new BadRequestException('On-chain attestation asset id does not match.');
    if (decoded.custodyMandate !== mandate.mandateAddress) throw new BadRequestException('On-chain attestation mandate does not match.');
    if (decoded.custodian !== mandate.custodianWallet) throw new BadRequestException('On-chain attestation custodian does not match.');
    if (decoded.custodianFid !== mandate.custodianFid) throw new BadRequestException('On-chain attestation custodian FID does not match.');
    if (decoded.documentHash !== documentHash) throw new BadRequestException('On-chain document hash does not match.');
    if (decoded.attestationHash !== attestationHash) throw new BadRequestException('On-chain attestation hash does not match.');
  }

  private async recordTransitionAndTx(previous: CustodyMandateRow, current: CustodyMandateRow, txHash: string, actorWallet: string | null | undefined, actionType: string) {
    await this.workflows.record({
      entityType: 'CustodyMandate',
      entityId: current.id,
      fromStatus: previous.status,
      toStatus: current.status,
      actorWallet: actorWallet || null,
      txHash,
      metadata: { assetRequestId: current.assetRequestId, factoryAssetId: current.factoryAssetId },
    });
    await this.blockchainTransactions.record({
      txHash,
      actionType,
      actorWallet: actorWallet || null,
      entityType: 'CustodyMandate',
      entityId: current.id,
      assetId: String(current.factoryAssetId),
      metadata: {
        assetRequestId: current.assetRequestId,
        mandateAddress: current.mandateAddress,
        custodianWallet: current.custodianWallet,
        custodianFid: current.custodianFid,
      },
    });
  }
}









