import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateTokenSellListingDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  tokenContract!: string;

  @IsString()
  sellerWallet!: string;

  @IsOptional()
  @IsString()
  targetBuyerWallet?: string;

  @IsString()
  amountBaseUnits!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  settlementTerms?: string;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}
