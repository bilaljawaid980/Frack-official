import { Module } from '@nestjs/common';
import { TokenPurchaseRequestsService } from './token-purchase-requests.service';
import { TokenPurchaseRequestsController } from './token-purchase-requests.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TokenPurchaseRequestsController],
  providers: [TokenPurchaseRequestsService],
})
export class TokenPurchaseRequestsModule {}
