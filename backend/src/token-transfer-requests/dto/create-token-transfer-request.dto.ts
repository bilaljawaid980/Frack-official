import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateTokenTransferRequestDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  tokenContract!: string;

  @IsString()
  fromWallet!: string;

  @IsString()
  toWallet!: string;

  @IsNumber()
  @Min(0)
  amount!: number;

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

  @IsOptional()
  @IsString()
  transferTxHash?: string;

  @IsOptional()
  @IsString()
  whitelistTxHash?: string;

  @IsOptional()
  @IsString()
  activationTxHash?: string;
}
