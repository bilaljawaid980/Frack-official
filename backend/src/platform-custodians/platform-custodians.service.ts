import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Connection, PublicKey } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { getIndexerConfig } from '../indexer/indexer.config';
import {
  CreatePlatformCustodianDto,
  RecordCustodianApprovalDto,
  RecordCustodianFidDto,
} from './dto/platform-custodian.dto';

const TOPIC_CUSTODIAN_AUTHORITY = 4;
const TOPIC_CUSTODIAN_AUTHORITY_BIGINT = 4n;
const SEED_FID = Buffer.from('fid');
const SEED_PLATFORM_AUTHORITY = Buffer.from('platform_authority');

type PlatformCustodianRow = {
  id: string;
  organizationName: string;
  walletAddress: string;
  fidAddress: string | null;
  platformAuthorityAddress: string | null;
  authorityTopic: number;
  status: string;
  fidTxHash: string | null;
  approvalTxHash: string | null;
  approvedAt: Date | null;
  suspendedAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type DecodedPlatformAuthority = {
  authorityFid: string;
  topic: bigint;
  active: boolean;
};

function normalizePubkey(value: string, label: string) {
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    throw new ConflictException(`${label} must be a valid Solana address.`);
  }
}

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

function readPubkey(data: Buffer, offset: number) {
  return new PublicKey(data.subarray(offset, offset + 32)).toBase58();
}

function decodeFid(data: Buffer) {
  const owner = readPubkey(data, 8);
  const isIssuer = data[108] === 1;
  const country = data.readUInt16LE(109);
  return { owner, isIssuer, country };
}

function decodePlatformAuthority(data: Buffer): DecodedPlatformAuthority {
  let offset = 8;
  const authorityFid = readPubkey(data, offset); offset += 32;
  const topic = data.readBigUInt64LE(offset); offset += 8;
  const active = data[offset] === 1;
  return { authorityFid, topic, active };
}

@Injectable()
export class PlatformCustodiansService {
  private readonly connection = new Connection(getIndexerConfig().rpcEndpoint, 'confirmed');
  private readonly factoryProgramId = getPublicKeyEnv('FRACKS_FACTORY', 'FACTORY_PROGRAM_ID', 'NEXT_PUBLIC_FACTORY_PROGRAM_ID', 'NEXT_PUBLIC_FRACKS_FACTORY');
  private readonly fidProgramId = getPublicKeyEnv('FRACKS_FID', 'FID_PROGRAM_ID', 'NEXT_PUBLIC_FID_PROGRAM_ID', 'NEXT_PUBLIC_FRACKS_FID');

  constructor(private readonly prisma: PrismaService) {}

  deriveFid(walletAddress: string) {
    const wallet = new PublicKey(walletAddress);
    const [fid] = PublicKey.findProgramAddressSync([SEED_FID, wallet.toBuffer()], this.fidProgramId);
    return fid;
  }

  derivePlatformAuthority(fidAddress: string) {
    const fid = new PublicKey(fidAddress);
    const [authority] = PublicKey.findProgramAddressSync(
      [SEED_PLATFORM_AUTHORITY, fid.toBuffer(), u64Le(TOPIC_CUSTODIAN_AUTHORITY)],
      this.factoryProgramId,
    );
    return authority;
  }

  private selectSql() {
    return `
      "id", "organization_name" AS "organizationName", "wallet_address" AS "walletAddress",
      "fid_address" AS "fidAddress", "platform_authority_address" AS "platformAuthorityAddress",
      "authority_topic" AS "authorityTopic", "status", "fid_tx_hash" AS "fidTxHash",
      "approval_tx_hash" AS "approvalTxHash", "approved_at" AS "approvedAt",
      "suspended_at" AS "suspendedAt", "metadata", "created_at" AS "createdAt", "updated_at" AS "updatedAt"
    `;
  }

  async findAll(query: { walletAddress?: string; status?: string } = {}) {
    const wallet = query.walletAddress ? normalizePubkey(query.walletAddress, 'Custodian wallet address') : null;
    return this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `SELECT ${this.selectSql()}
       FROM "platform_custodians"
       WHERE ($1::text IS NULL OR "wallet_address" = $1)
         AND ($2::text IS NULL OR "status" = $2)
       ORDER BY "organization_name" ASC, "created_at" DESC`,
      wallet,
      query.status || null,
    );
  }

  async findApprovedByWallet(walletAddress: string) {
    const wallet = normalizePubkey(walletAddress, 'Custodian wallet address');
    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `SELECT ${this.selectSql()}
       FROM "platform_custodians"
       WHERE "wallet_address" = $1 AND "status" = 'APPROVED'
       LIMIT 1`,
      wallet,
    );
    return rows[0] || null;
  }

  async create(dto: CreatePlatformCustodianDto) {
    const walletAddress = normalizePubkey(dto.walletAddress, 'Custodian wallet address');
    const organizationName = dto.organizationName.trim();
    if (!organizationName) throw new ConflictException('Custodian organization name is required.');
    const expectedFid = this.deriveFid(walletAddress).toBase58();
    const metadata = JSON.stringify({ ...(dto.metadata || {}), expectedFid });

    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `INSERT INTO "platform_custodians" (
        "id", "organization_name", "wallet_address", "authority_topic", "status", "metadata"
      ) VALUES ($1, $2, $3, $4, 'REGISTERED', $5::jsonb)
      RETURNING ${this.selectSql()}`,
      randomUUID(),
      organizationName,
      walletAddress,
      TOPIC_CUSTODIAN_AUTHORITY,
      metadata,
    ).catch((error) => {
      if (String(error?.message || '').includes('Unique constraint')) {
        throw new ConflictException('A custodian with this wallet is already registered.');
      }
      throw error;
    });
    return { ...rows[0], expectedFid };
  }

  async recordFid(id: string, dto: RecordCustodianFidDto) {
    const custodian = await this.findOne(id);
    const fidAddress = normalizePubkey(dto.fidAddress, 'Custodian FID address');
    const expectedFid = this.deriveFid(custodian.walletAddress).toBase58();
    if (fidAddress !== expectedFid) throw new ConflictException('FID address does not match the registered custodian wallet.');
    if (dto.txHash) await this.assertConfirmedSignature(dto.txHash);
    const info = await this.connection.getAccountInfo(new PublicKey(fidAddress), 'confirmed');
    if (!info) throw new ConflictException('Custodian FID account does not exist on-chain.');
    const decoded = decodeFid(Buffer.from(info.data));
    if (decoded.owner !== custodian.walletAddress) throw new ConflictException('Custodian FID owner does not match the registered wallet.');

    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `UPDATE "platform_custodians"
       SET "fid_address" = $1,
           "fid_tx_hash" = $2,
           "status" = CASE WHEN "status" = 'REGISTERED' THEN 'FID_CREATED' ELSE "status" END,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $3
       RETURNING ${this.selectSql()}`,
      fidAddress,
      dto.txHash || null,
      id,
    );
    return rows[0];
  }

  async recordApproval(id: string, dto: RecordCustodianApprovalDto) {
    const custodian = await this.findOne(id);
    if (!custodian.fidAddress) throw new ConflictException('Custodian must create and record its FID before approval.');
    const platformAuthorityAddress = normalizePubkey(dto.platformAuthorityAddress, 'Platform authority address');
    const expectedAuthority = this.derivePlatformAuthority(custodian.fidAddress).toBase58();
    if (platformAuthorityAddress !== expectedAuthority) throw new ConflictException('PlatformAuthority PDA does not match custodian FID topic 4.');
    if (dto.txHash) await this.assertConfirmedSignature(dto.txHash);
    const info = await this.connection.getAccountInfo(new PublicKey(platformAuthorityAddress), 'confirmed');
    if (!info) throw new ConflictException('PlatformAuthority account does not exist on-chain.');
    const decoded = decodePlatformAuthority(Buffer.from(info.data));
    if (decoded.authorityFid !== custodian.fidAddress || decoded.topic !== TOPIC_CUSTODIAN_AUTHORITY_BIGINT || !decoded.active) {
      throw new ConflictException('PlatformAuthority account is not active for custodian topic 4.');
    }

    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `UPDATE "platform_custodians"
       SET "platform_authority_address" = $1,
           "approval_tx_hash" = $2,
           "status" = 'APPROVED',
           "approved_at" = CURRENT_TIMESTAMP,
           "suspended_at" = NULL,
           "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $3
       RETURNING ${this.selectSql()}`,
      platformAuthorityAddress,
      dto.txHash || null,
      id,
    );
    return rows[0];
  }

  async suspend(id: string) {
    await this.findOne(id);
    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `UPDATE "platform_custodians"
       SET "status" = 'SUSPENDED', "suspended_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP
       WHERE "id" = $1
       RETURNING ${this.selectSql()}`,
      id,
    );
    return rows[0];
  }

  async remove(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `DELETE FROM "platform_custodians" WHERE "id" = $1 RETURNING ${this.selectSql()}`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Platform custodian not found.');
    return rows[0];
  }

  private async findOne(id: string) {
    const rows = await this.prisma.$queryRawUnsafe<PlatformCustodianRow[]>(
      `SELECT ${this.selectSql()} FROM "platform_custodians" WHERE "id" = $1 LIMIT 1`,
      id,
    );
    if (!rows[0]) throw new NotFoundException('Platform custodian not found.');
    return rows[0];
  }

  private async assertConfirmedSignature(txHash: string) {
    const status = await this.connection.getSignatureStatus(txHash, { searchTransactionHistory: true });
    if (!status.value) throw new ConflictException('Transaction was not found on the configured Solana network.');
    if (status.value.err) throw new ConflictException('Transaction failed on-chain.');
  }
}


