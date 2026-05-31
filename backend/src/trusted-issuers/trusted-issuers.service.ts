import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTrustedIssuerDto } from './dto/create-trusted-issuer.dto';

function normalizeWallet(value: string): string {
  try {
    return new PublicKey(value.trim()).toBase58();
  } catch {
    throw new ConflictException('Issuer wallet address must be a valid Solana wallet address.');
  }
}

@Injectable()
export class TrustedIssuersService {
  constructor(private readonly prisma: PrismaService) {}

  private rowSelect() {
    return Prisma.sql`
      id,
      "walletAddress",
      "authorityName",
      "kycAuthorized",
      "amlAuthorized",
      "createdAt",
      "updatedAt"
    `;
  }

  async findAll() {
    return this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT ${this.rowSelect()}
      FROM "TrustedIssuer"
      ORDER BY "authorityName" ASC, "createdAt" ASC
    `;
  }

  async create(dto: CreateTrustedIssuerDto) {
    if (!dto.kycAuthorized && !dto.amlAuthorized) {
      throw new ConflictException('Authorize the trusted issuer for KYC, AML, or both.');
    }

    const walletAddress = normalizeWallet(dto.walletAddress);
    const authorityName = dto.authorityName.trim();
    if (!authorityName) {
      throw new ConflictException('Issuer authority name is required.');
    }

    const duplicate = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "TrustedIssuer"
      WHERE "walletAddress" = ${walletAddress}
      LIMIT 1
    `;
    if (duplicate.length > 0) {
      throw new ConflictException('A trusted issuer with this wallet address already exists.');
    }

    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      INSERT INTO "TrustedIssuer" (
        id,
        "walletAddress",
        "authorityName",
        "kycAuthorized",
        "amlAuthorized",
        "updatedAt"
      )
      VALUES (
        ${randomUUID()},
        ${walletAddress},
        ${authorityName},
        ${dto.kycAuthorized},
        ${dto.amlAuthorized},
        NOW()
      )
      RETURNING ${this.rowSelect()}
    `;
    return rows[0];
  }

  async remove(id: string) {
    const rows = await this.prisma.$queryRaw<Array<Record<string, unknown>>>`
      DELETE FROM "TrustedIssuer"
      WHERE id = ${id}
      RETURNING ${this.rowSelect()}
    `;
    if (!rows[0]) throw new NotFoundException('Trusted issuer not found.');
    return rows[0];
  }
}
