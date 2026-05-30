import { IsBoolean, IsString, MinLength } from 'class-validator';

export class CreateTrustedIssuerDto {
  @IsString()
  @MinLength(1)
  walletAddress!: string;

  @IsString()
  @MinLength(2)
  authorityName!: string;

  @IsBoolean()
  kycAuthorized!: boolean;

  @IsBoolean()
  amlAuthorized!: boolean;
}
