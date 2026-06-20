import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { AssetDocumentsService } from './asset-documents.service';
import { CreateAssetDocumentDto, RegisterAssetDocumentsDto } from './dto/create-asset-document.dto';

@Controller('assets/:assetId/documents')
export class AssetDocumentsController {
  constructor(private readonly documents: AssetDocumentsService) {}

  @Get()
  list(@Param('assetId') assetId: string, @Query('includePrivate') includePrivate?: string) {
    return this.documents.listForAsset(assetId, { includePrivate: includePrivate === 'true' });
  }

  @Post()
  create(@Param('assetId') assetId: string, @Body() dto: CreateAssetDocumentDto | RegisterAssetDocumentsDto) {
    if ('documents' in dto && Array.isArray(dto.documents)) {
      return this.documents.registerForAsset(assetId, dto.documents, dto.uploadedByWallet);
    }
    return this.documents.createForAsset(assetId, dto as CreateAssetDocumentDto);
  }

  @Delete(':documentId')
  remove(
    @Param('assetId') assetId: string,
    @Param('documentId') documentId: string,
    @Query('actorWallet') actorWallet?: string,
  ) {
    return this.documents.softDelete(assetId, documentId, actorWallet);
  }
}
