import { IsOptional, IsString } from 'class-validator';

export class UpdateTokenBuyIntentDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  reviewerWallet?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  preflightFailure?: string;

  @IsOptional()
  @IsString()
  simulationError?: string;

  @IsOptional()
  @IsString()
  transferTxHash?: string;

  @IsOptional()
  @IsString()
  claimTxHash?: string;

  @IsOptional()
  @IsString()
  whitelistTxHash?: string;

  @IsOptional()
  @IsString()
  activationTxHash?: string;
}
