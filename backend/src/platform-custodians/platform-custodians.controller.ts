import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { PlatformWalletSignatureGuard } from '../common/guards/platform-wallet-signature.guard';
import {
  CreatePlatformCustodianDto,
  RecordCustodianApprovalDto,
  RecordCustodianFidDto,
} from './dto/platform-custodian.dto';
import { PlatformCustodiansService } from './platform-custodians.service';

@Controller('platform-custodians')
export class PlatformCustodiansController {
  constructor(private readonly service: PlatformCustodiansService) {}

  @Get()
  findAll(@Query('walletAddress') walletAddress?: string, @Query('status') status?: string) {
    return this.service.findAll({ walletAddress, status });
  }

  @Post()
  @UseGuards(PlatformWalletSignatureGuard)
  create(@Body() dto: CreatePlatformCustodianDto) {
    return this.service.create(dto);
  }

  @Post(':id/fid')
  recordFid(@Param('id') id: string, @Body() dto: RecordCustodianFidDto) {
    return this.service.recordFid(id, dto);
  }

  @Post(':id/approval')
  @UseGuards(PlatformWalletSignatureGuard)
  recordApproval(@Param('id') id: string, @Body() dto: RecordCustodianApprovalDto) {
    return this.service.recordApproval(id, dto);
  }

  @Patch(':id/suspend')
  @UseGuards(PlatformWalletSignatureGuard)
  suspend(@Param('id') id: string) {
    return this.service.suspend(id);
  }

  @Delete(':id')
  @UseGuards(PlatformWalletSignatureGuard)
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
