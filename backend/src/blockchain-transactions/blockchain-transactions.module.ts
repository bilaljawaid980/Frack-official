import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockchainTransactionsController } from './blockchain-transactions.controller';
import { BlockchainTransactionsService } from './blockchain-transactions.service';

@Module({
  imports: [PrismaModule],
  controllers: [BlockchainTransactionsController],
  providers: [BlockchainTransactionsService],
  exports: [BlockchainTransactionsService],
})
export class BlockchainTransactionsModule {}
