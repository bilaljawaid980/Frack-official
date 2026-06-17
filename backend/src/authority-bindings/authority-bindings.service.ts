import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CreateAuthorityBindingInput = {
  walletAddress: string;
  authorityType: string;
  fidAddress?: string | null;
  tokenContract?: string | null;
  txHash?: string | null;
  network?: string;
  environment?: string;
  confirmedAt?: Date | string | null;
};

@Injectable()
export class AuthorityBindingsService {
  constructor(private readonly prisma: PrismaService) {}

  list(query: { walletAddress?: string; tokenContract?: string; authorityType?: string } = {}) {
    return this.prisma.onChainAuthorityBinding.findMany({
      where: {
        revokedAt: null,
        ...(query.walletAddress ? { walletAddress: query.walletAddress } : {}),
        ...(query.tokenContract ? { tokenContract: query.tokenContract } : {}),
        ...(query.authorityType ? { authorityType: query.authorityType } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: CreateAuthorityBindingInput) {
    return this.prisma.onChainAuthorityBinding.create({
      data: {
        walletAddress: input.walletAddress,
        fidAddress: input.fidAddress || null,
        authorityType: input.authorityType,
        tokenContract: input.tokenContract || null,
        txHash: input.txHash || null,
        network: input.network || process.env.SOLANA_CLUSTER || 'devnet',
        environment: input.environment || process.env.APP_ENVIRONMENT || 'sandbox',
        confirmedAt: input.confirmedAt ? new Date(input.confirmedAt) : null,
      },
    });
  }

  async revoke(id: string) {
    const existing = await this.prisma.onChainAuthorityBinding.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Authority binding not found');
    return this.prisma.onChainAuthorityBinding.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }
}
