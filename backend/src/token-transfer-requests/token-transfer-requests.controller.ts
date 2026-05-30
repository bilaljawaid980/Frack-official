import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { CreateTokenTransferRequestDto } from './dto/create-token-transfer-request.dto';
import { UpdateTokenTransferRequestDto } from './dto/update-token-transfer-request.dto';
import { TokenTransferRequestsService } from './token-transfer-requests.service';

@Controller('token-transfer-requests')
export class TokenTransferRequestsController {
  constructor(private readonly service: TokenTransferRequestsService) {}

  @Post()
  create(@Body() dto: CreateTokenTransferRequestDto) {
    return this.service.create(dto);
  }

  @Get()
  findAll(@Query() query: Record<string, string>) {
    return this.service.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateTokenTransferRequestDto) {
    return this.service.updateStatus(id, dto);
  }
}
