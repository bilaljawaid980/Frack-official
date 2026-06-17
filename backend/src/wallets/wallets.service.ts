import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterWalletDto } from './dto/register-wallet.dto';

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveWallet(publicKey: string, network = process.env.SOLANA_CLUSTER || 'devnet') {
    const wallet = await this.prisma.walletAccount.findUnique({
      where: { publicKey_network: { publicKey, network } },
      include: { user: true, orgWallets: { include: { organization: true } } },
    });
    if (wallet) return wallet;

    const legacyUser = await this.prisma.user.findUnique({ where: { walletAddress: publicKey } });
    if (!legacyUser) return null;

    return {
      id: null,
      userId: legacyUser.id,
      publicKey,
      network,
      isPrimary: true,
      status: 'ACTIVE',
      label: 'Legacy wallet',
      verifiedAt: legacyUser.updatedAt,
      lastChallengeAt: null,
      createdAt: legacyUser.createdAt,
      updatedAt: legacyUser.updatedAt,
      user: legacyUser,
      orgWallets: [],
      legacy: true,
    };
  }

  async register(dto: RegisterWalletDto) {
    const network = dto.network || process.env.SOLANA_CLUSTER || 'devnet';
    const user = await this.prisma.user.findUnique({ where: { id: dto.userId } });
    if (!user) throw new NotFoundException('User not found');

    try {
      return await this.prisma.$transaction(async (tx) => {
        if (dto.isPrimary) {
          await tx.walletAccount.updateMany({
            where: { userId: dto.userId, network },
            data: { isPrimary: false },
          });
        }

        return tx.walletAccount.create({
          data: {
            userId: dto.userId,
            publicKey: dto.publicKey,
            network,
            isPrimary: dto.isPrimary ?? false,
            label: dto.label,
            verifiedAt: new Date(),
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Wallet is already registered on this network');
      }
      throw error;
    }
  }
}
