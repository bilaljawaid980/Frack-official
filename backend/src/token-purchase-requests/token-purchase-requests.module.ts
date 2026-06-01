import { Module } from '@nestjs/common';
import { TokenPurchaseRequestsService } from './token-purchase-requests.service';
import { TokenPurchaseRequestsController } from './token-purchase-requests.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockchainTransactionsModule } from '../blockchain-transactions/blockchain-transactions.module';

@Module({
  imports: [PrismaModule, BlockchainTransactionsModule],
  controllers: [TokenPurchaseRequestsController],
  providers: [TokenPurchaseRequestsService],
})
export class TokenPurchaseRequestsModule {}
