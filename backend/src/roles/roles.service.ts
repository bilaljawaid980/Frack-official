import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignRoleDto } from './dto/assign-role.dto';

@Injectable()
export class RolesService {
  constructor(private readonly prisma: PrismaService) {}

  listActive(walletAddress?: string) {
    return this.prisma.platformRoleAssignment.findMany({
      where: {
        revokedAt: null,
        ...(walletAddress ? { walletAddress } : {}),
      },
      orderBy: { grantedAt: 'desc' },
    });
  }

  assign(dto: AssignRoleDto) {
    return this.prisma.platformRoleAssignment.create({
      data: {
        walletAddress: dto.walletAddress,
        role: dto.role,
        grantedBy: dto.grantedBy,
        reason: dto.reason,
        environment: dto.environment || process.env.APP_ENVIRONMENT || 'sandbox',
        network: dto.network || process.env.SOLANA_CLUSTER || 'devnet',
      },
    });
  }

  async revoke(id: string, revokedBy?: string, reason?: string) {
    const existing = await this.prisma.platformRoleAssignment.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Role assignment not found');
    return this.prisma.platformRoleAssignment.update({
      where: { id },
      data: { revokedAt: new Date(), revokedBy, reason: reason || existing.reason },
    });
  }
}
