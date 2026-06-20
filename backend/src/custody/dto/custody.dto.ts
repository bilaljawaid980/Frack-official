import { IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CreateCustodyMandateDto {
  @IsString()
  issuerFid!: string;

  @IsString()
  custodianWallet!: string;

  @IsString()
  custodianFid!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class RecordCustodyMandateCreationDto {
  @IsString()
  txHash!: string;

  @IsString()
  mandateAddress!: string;

  @IsOptional()
  @IsString()
  actorWallet?: string;
}

export class RecordCustodyMandateAcceptanceDto {
  @IsString()
  txHash!: string;

  @IsOptional()
  @IsString()
  actorWallet?: string;
}

export class RecordCustodyAttestationDto {
  @IsString()
  txHash!: string;

  @IsString()
  attestationAddress!: string;

  @IsString()
  documentHash!: string;

  @IsString()
  attestationHash!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  reserveRatioBps?: number;

  @IsOptional()
  @IsString()
  actorWallet?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
