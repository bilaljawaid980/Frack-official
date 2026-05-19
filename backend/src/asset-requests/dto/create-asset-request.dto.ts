import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class CreateAssetRequestDto {
  @IsString()
  issuerWallet!: string;

  @IsOptional()
  @IsString()
  legalOwner?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsString()
  name!: string;

  @IsString()
  symbol!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  assetType!: string;

  @IsString()
  currency!: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsNumber()
  @Min(0)
  underlyingValue!: number;

  @IsNumber()
  @Min(1)
  totalSupply!: number;

  @IsNumber()
  @Min(0)
  decimals!: number;

  @IsNumber()
  @Min(0)
  initialPrice!: number;

  @IsArray()
  claimTopics!: string[];

  @IsArray()
  complianceModules!: string[];

  @IsOptional()
  trustedIssuers?: unknown;

  @IsOptional()
  documents?: unknown;

  @IsOptional()
  metadata?: unknown;
}
