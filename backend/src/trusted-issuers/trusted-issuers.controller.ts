import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformWalletSignatureGuard } from '../common/guards/platform-wallet-signature.guard';
import { CreateTrustedIssuerDto } from './dto/create-trusted-issuer.dto';
import { TrustedIssuersService } from './trusted-issuers.service';

@Controller('trusted-issuers')
export class TrustedIssuersController {
  constructor(private readonly service: TrustedIssuersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseGuards(PlatformWalletSignatureGuard)
  create(@Body() dto: CreateTrustedIssuerDto) {
    return this.service.create(dto);
  }

  @Delete(':id')
  @UseGuards(PlatformWalletSignatureGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
