import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { BlockchainTransactionsModule } from '../blockchain-transactions/blockchain-transactions.module';
import { AssetDocumentsModule } from '../asset-documents/asset-documents.module';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';

@Module({
  imports: [PrismaModule, WorkflowsModule, BlockchainTransactionsModule, AssetDocumentsModule],
  controllers: [CustodyController],
  providers: [CustodyService],
  exports: [CustodyService],
})
export class CustodyModule {}
