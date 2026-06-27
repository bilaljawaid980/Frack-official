import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlatformValuerDto {
  @IsString()
  organizationName!: string;

  @IsString()
  walletAddress!: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordValuerFidDto {
  @IsString()
  fidAddress!: string;

  @IsOptional()
  @IsString()
  txHash?: string;
}

export class AssignValuerDto {
  @IsString()
  valuerProfileId!: string;

  @IsOptional()
  @IsString()
  assignedBy?: string;

  @IsOptional()
  @IsString()
  tokenContract?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordValuerTirTrustDto {
  @IsString()
  txHash!: string;

  @IsString()
  issuerEntryAddress!: string;

  @IsOptional()
  @IsString()
  actorWallet?: string;
}

export class AcceptValuerAssignmentDto {
  @IsOptional()
  @IsString()
  actorWallet?: string;
}

export class RecordAssetValuationDto {
  @IsOptional()
  @IsString()
  txHash?: string;

  @IsString()
  navRaw!: string;

  @IsInt()
  @Min(1)
  navValidityDays!: number;

  @IsString()
  methodologyHash!: string;

  @IsOptional()
  @IsString()
  reportDocumentId?: string;

  @IsOptional()
  @IsString()
  actorWallet?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}