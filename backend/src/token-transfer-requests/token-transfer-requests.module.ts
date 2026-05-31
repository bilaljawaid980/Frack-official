import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenTransferRequestsController } from './token-transfer-requests.controller';
import { TokenTransferRequestsService } from './token-transfer-requests.service';

@Module({
  imports: [PrismaModule],
  controllers: [TokenTransferRequestsController],
  providers: [TokenTransferRequestsService],
})
export class TokenTransferRequestsModule {}
