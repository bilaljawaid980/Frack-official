import { IsDateString, IsObject, IsOptional, IsString } from 'class-validator';

export class RecordBlockchainTransactionDto {
  @IsString()
  txHash!: string;

  @IsString()
  actionType!: string;

  @IsOptional()
  @IsString()
  actorWallet?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  tokenContract?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
