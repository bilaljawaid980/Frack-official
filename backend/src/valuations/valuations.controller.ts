import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PlatformWalletSignatureGuard } from '../common/guards/platform-wallet-signature.guard';
import { WalletSignatureGuard } from '../common/guards/wallet-signature.guard';
import {
  AcceptValuerAssignmentDto,
  AssignValuerDto,
  CreatePlatformValuerDto,
  RecordAssetValuationDto,
  RecordValuerFidDto,
  RecordValuerTirTrustDto,
} from './dto/valuations.dto';
import { ValuationsService } from './valuations.service';
type UploadedValuationReportFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

const VALUATION_REPORT_UPLOAD_LIMIT = 10 * 1024 * 1024;

@Controller()
export class ValuationsController {
  constructor(private readonly valuations: ValuationsService) {}

  @Get('platform-valuers')
  listValuers(@Query('walletAddress') walletAddress?: string, @Query('status') status?: string) {
    return this.valuations.listValuers({ walletAddress, status });
  }

  @Post('platform-valuers')
  @UseGuards(PlatformWalletSignatureGuard)
  createValuer(@Body() dto: CreatePlatformValuerDto) {
    return this.valuations.createValuer(dto);
  }

  @Post('platform-valuers/:id/fid')
  recordValuerFid(@Param('id') id: string, @Body() dto: RecordValuerFidDto) {
    return this.valuations.recordValuerFid(id, dto);
  }

  @Post('platform-valuers/:id/approval')
  @UseGuards(PlatformWalletSignatureGuard)
  approveValuer(@Param('id') id: string) {
    return this.valuations.approveValuer(id);
  }

  @Patch('platform-valuers/:id/suspend')
  @UseGuards(PlatformWalletSignatureGuard)
  suspendValuer(@Param('id') id: string) {
    return this.valuations.suspendValuer(id);
  }

  @Delete('platform-valuers/:id')
  @UseGuards(PlatformWalletSignatureGuard)
  removeValuer(@Param('id') id: string) {
    return this.valuations.removeValuer(id);
  }

  @Post('asset-requests/:assetRequestId/valuer-assignments')
  @UseGuards(WalletSignatureGuard)
  assignValuer(@Param('assetRequestId') assetRequestId: string, @Body() dto: AssignValuerDto, @Req() request: { verifiedWalletAddress?: string }) {
    return this.valuations.assignValuer(assetRequestId, { ...dto, assignedBy: request.verifiedWalletAddress || dto.assignedBy });
  }

  @Get('asset-valuer-assignments')
  listAssignments(
    @Query('valuerWallet') valuerWallet?: string,
    @Query('assetRequestId') assetRequestId?: string,
    @Query('tokenContract') tokenContract?: string,
    @Query('status') status?: string,
  ) {
    return this.valuations.listAssignments({ valuerWallet, assetRequestId, tokenContract, status });
  }

  @Get('asset-valuer-assignments/:id')
  getAssignment(@Param('id') id: string) {
    return this.valuations.getAssignment(id);
  }

  @Post('asset-valuer-assignments/:id/accept')
  acceptAssignment(@Param('id') id: string, @Body() dto: AcceptValuerAssignmentDto) {
    return this.valuations.acceptAssignment(id, dto);
  }

  @Post('asset-valuer-assignments/:id/tir-trust')
  @UseGuards(WalletSignatureGuard)
  recordTirTrust(@Param('id') id: string, @Body() dto: RecordValuerTirTrustDto, @Req() request: { verifiedWalletAddress?: string }) {
    return this.valuations.recordTirTrust(id, { ...dto, actorWallet: request.verifiedWalletAddress || dto.actorWallet });
  }


  @Post('asset-valuer-assignments/:id/valuation-report')
  @UseGuards(WalletSignatureGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: VALUATION_REPORT_UPLOAD_LIMIT } }))
  uploadValuationReport(
    @Param('id') id: string,
    @UploadedFile() file: UploadedValuationReportFile | undefined,
    @Req() request: { verifiedWalletAddress?: string },
  ) {
    return this.valuations.uploadValuationReport(id, request.verifiedWalletAddress, file);
  }

  @Get('assets/:assetId/valuation-report')
  latestValuationReport(@Param('assetId') assetId: string) {
    return this.valuations.getLatestValuationReport(assetId);
  }
  @Post('asset-valuer-assignments/:id/valuations')
  recordValuation(@Param('id') id: string, @Body() dto: RecordAssetValuationDto) {
    return this.valuations.recordValuation(id, dto);
  }

  @Get('asset-valuations')
  listValuations(
    @Query('assignmentId') assignmentId?: string,
    @Query('tokenContract') tokenContract?: string,
    @Query('factoryAssetId') factoryAssetId?: string,
    @Query('assetRequestId') assetRequestId?: string,
  ) {
    return this.valuations.listValuations({
      assignmentId,
      tokenContract,
      factoryAssetId: factoryAssetId ? Number(factoryAssetId) : undefined,
      assetRequestId,
    });
  }

  @Get('valuation-readiness')
  readiness(@Query('assetRequestId') assetRequestId?: string, @Query('tokenContract') tokenContract?: string) {
    return this.valuations.getReadiness({ assetRequestId, tokenContract });
  }
}
