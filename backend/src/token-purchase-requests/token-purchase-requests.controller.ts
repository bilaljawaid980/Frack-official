import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { TokenPurchaseRequestsService } from './token-purchase-requests.service';
import { CreateTokenPurchaseRequestDto } from './dto/create-token-purchase-request.dto';
import { UpdateTokenPurchaseRequestDto } from './dto/update-token-purchase-request.dto';

@Controller('token-purchase-requests')
export class TokenPurchaseRequestsController {
  constructor(private readonly tokenPurchaseRequestsService: TokenPurchaseRequestsService) {}

  @Post()
  create(@Body() createDto: CreateTokenPurchaseRequestDto) {
    return this.tokenPurchaseRequestsService.create(createDto);
  }

  @Post('preflight')
  preflight(@Body() body: {
    tokenContract: string;
    investorWallet: string;
    country?: string | number | null;
    amount?: string | number | null;
  }) {
    return this.tokenPurchaseRequestsService.preflight(body);
  }

  @Get()
  findAll(@Query() query: any) {
    return this.tokenPurchaseRequestsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tokenPurchaseRequestsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateTokenPurchaseRequestDto) {
    return this.tokenPurchaseRequestsService.update(id, updateDto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() updateDto: UpdateTokenPurchaseRequestDto) {
    return this.tokenPurchaseRequestsService.updateStatus(id, updateDto);
  }

  @Patch(':id/resume-after-identity')
  resumeAfterIdentity(@Param('id') id: string) {
    return this.tokenPurchaseRequestsService.resumeAfterIdentity(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.tokenPurchaseRequestsService.remove(id);
  }
}
