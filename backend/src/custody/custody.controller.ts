import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CustodyService } from './custody.service';
import {
  CreateCustodyMandateDto,
  RecordCustodyAttestationDto,
  RecordCustodyMandateAcceptanceDto,
  RecordCustodyMandateCreationDto,
} from './dto/custody.dto';

@Controller()
export class CustodyController {
  constructor(private readonly custody: CustodyService) {}

  @Post('asset-requests/:assetRequestId/custody-mandates')
  createForAssetRequest(
    @Param('assetRequestId') assetRequestId: string,
    @Body() dto: CreateCustodyMandateDto,
  ) {
    return this.custody.createForAssetRequest(assetRequestId, dto);
  }

  @Get('asset-requests/:assetRequestId/custody-mandates')
  listForAssetRequest(@Param('assetRequestId') assetRequestId: string) {
    return this.custody.list({ assetRequestId });
  }

  @Get('asset-requests/:assetRequestId/deployment-readiness')
  deploymentReadiness(@Param('assetRequestId') assetRequestId: string) {
    return this.custody.getDeploymentReadiness(assetRequestId);
  }

  @Get('custody-mandates')
  list(
    @Query('custodianWallet') custodianWallet?: string,
    @Query('assetRequestId') assetRequestId?: string,
    @Query('factoryAssetId') factoryAssetId?: string,
    @Query('status') status?: string,
  ) {
    return this.custody.list({ custodianWallet, assetRequestId, factoryAssetId: factoryAssetId ? Number(factoryAssetId) : undefined, status });
  }

  @Get('custody-mandates/:mandateId')
  findOne(@Param('mandateId') mandateId: string) {
    return this.custody.findOne(mandateId);
  }

  @Post('custody-mandates/:mandateId/record-creation')
  recordCreation(
    @Param('mandateId') mandateId: string,
    @Body() dto: RecordCustodyMandateCreationDto,
  ) {
    return this.custody.recordCreation(mandateId, dto);
  }

  @Post('custody-mandates/:mandateId/accept')
  recordAcceptance(
    @Param('mandateId') mandateId: string,
    @Body() dto: RecordCustodyMandateAcceptanceDto,
  ) {
    return this.custody.recordAcceptance(mandateId, dto);
  }

  @Post('custody-mandates/:mandateId/attestations')
  recordAttestation(
    @Param('mandateId') mandateId: string,
    @Body() dto: RecordCustodyAttestationDto,
  ) {
    return this.custody.recordAttestation(mandateId, dto);
  }
}


