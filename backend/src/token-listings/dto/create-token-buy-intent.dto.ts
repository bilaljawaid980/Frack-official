import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator';

export class CreateTokenBuyIntentDto {
  @IsString()
  buyerWallet!: string;

  @IsString()
  amountBaseUnits!: string;

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
