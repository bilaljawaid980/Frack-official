import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from "class-validator";

export class CreateTokenPurchaseRequestDto {
  @IsOptional()
  @IsString()
  assetId?: string;

  @IsString()
  tokenContract!: string;

  @IsString()
  investorWallet!: string;

  @IsString()
  issuerWallet!: string;

  @IsOptional()
  @IsString()
  kycProvider?: string;

  @IsOptional()
  @IsString()
  amlProvider?: string;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  idDocumentUrl?: string;

  @IsOptional()
  @IsString()
  proofOfAddressUrl?: string;

  @IsArray()
  requiredClaimTopics!: string[];

  @IsOptional()
  @IsBoolean()
  investorFidRegistered?: boolean;

  @IsOptional()
  documents?: unknown;
}
