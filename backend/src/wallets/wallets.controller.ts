import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/types/role.enum';
import { RegisterWalletDto } from './dto/register-wallet.dto';
import { WalletsService } from './wallets.service';

@Controller('wallets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get(':publicKey')
  @Roles(Role.ADMIN, Role.PLATFORM_OWNER)
  resolve(@Param('publicKey') publicKey: string, @Query('network') network?: string) {
    return this.wallets.resolveWallet(publicKey, network);
  }

  @Post()
  @Roles(Role.ADMIN, Role.PLATFORM_OWNER)
  register(@Body() dto: RegisterWalletDto) {
    return this.wallets.register(dto);
  }
}
