import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreateTokenBuyIntentDto {
  @IsString()
  buyerWallet!: string;

  @IsString()
  amountBaseUnits!: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsArray()
  requiredClaimTopics?: string[];

  @IsOptional()
  @IsString()
  kycProvider?: string;

  @IsOptional()
  @IsString()
  amlProvider?: string;

  @IsOptional()
  @IsString()
  issuerWallet?: string;

  @IsOptional()
  @IsString()
  preflightFailure?: string;

  @IsOptional()
  @IsString()
  simulationError?: string;
}
