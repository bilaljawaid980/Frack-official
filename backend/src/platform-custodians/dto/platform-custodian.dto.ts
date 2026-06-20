import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreatePlatformCustodianDto {
  @IsString()
  organizationName!: string;

  @IsString()
  walletAddress!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordCustodianFidDto {
  @IsString()
  fidAddress!: string;

  @IsOptional()
  @IsString()
  txHash?: string;
}

export class RecordCustodianApprovalDto {
  @IsString()
  platformAuthorityAddress!: string;

  @IsOptional()
  @IsString()
  txHash?: string;
}

