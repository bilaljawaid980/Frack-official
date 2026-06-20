import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BlockchainTransactionsModule } from '../blockchain-transactions/blockchain-transactions.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ValuationsController } from './valuations.controller';
import { WalletSignatureGuard } from '../common/guards/wallet-signature.guard';
import { ValuationsService } from './valuations.service';

@Module({
  imports: [PrismaModule, BlockchainTransactionsModule, WorkflowsModule],
  controllers: [ValuationsController],
  providers: [ValuationsService, WalletSignatureGuard],
  exports: [ValuationsService],
})
export class ValuationsModule {}
