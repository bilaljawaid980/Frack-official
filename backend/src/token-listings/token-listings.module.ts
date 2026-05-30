import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TokenListingsController } from './token-listings.controller';
import { TokenListingsService } from './token-listings.service';

@Module({
  imports: [PrismaModule],
  controllers: [TokenListingsController],
  providers: [TokenListingsService],
})
export class TokenListingsModule {}
