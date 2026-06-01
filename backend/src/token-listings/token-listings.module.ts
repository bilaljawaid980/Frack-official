import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenListingsController } from './token-listings.controller';
import { TokenListingsService } from './token-listings.service';
import { BlockchainTransactionsModule } from '../blockchain-transactions/blockchain-transactions.module';

@Module({
  imports: [PrismaModule, BlockchainTransactionsModule],
  controllers: [TokenListingsController],
  providers: [TokenListingsService],
})
export class TokenListingsModule {}
