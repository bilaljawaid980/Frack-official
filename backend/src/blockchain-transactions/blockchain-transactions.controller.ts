import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { BlockchainTransactionsService } from './blockchain-transactions.service';
import { RecordBlockchainTransactionDto } from './dto/record-blockchain-transaction.dto';

@Controller('blockchain-transactions')
export class BlockchainTransactionsController {
  constructor(private readonly service: BlockchainTransactionsService) {}

  @Get()
  list(@Query('limit') limit?: string) {
    return this.service.list(Number(limit));
  }

  @Get('count')
  count() {
    return this.service.count();
  }

  @Post()
  record(@Body() dto: RecordBlockchainTransactionDto) {
    return this.service.record(dto);
  }
}
