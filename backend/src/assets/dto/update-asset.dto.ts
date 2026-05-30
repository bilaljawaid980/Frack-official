import { Type } from "class-transformer";
import type { Prisma } from "@prisma/client";
import { IsDateString, IsInt, IsOptional, IsString } from "class-validator";

export class UpdateAssetDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  factoryAssetId?: number;

  @IsOptional()
  @IsString()
  tokenContract?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  issuerWallet?: string;

  @IsOptional()
  @IsString()
  legalOwner?: string;

  @IsOptional()
  @IsDateString()
  deployedAt?: string;

  @IsOptional()
  @IsString()
  lifecycleState?: string;

  @IsOptional()
  metadata?: Prisma.InputJsonValue;
}
