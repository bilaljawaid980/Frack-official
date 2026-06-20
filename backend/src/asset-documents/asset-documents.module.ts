import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AssetDocumentsController } from './asset-documents.controller';
import { AssetDocumentsService } from './asset-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [AssetDocumentsController],
  providers: [AssetDocumentsService],
  exports: [AssetDocumentsService],
})
export class AssetDocumentsModule {}
