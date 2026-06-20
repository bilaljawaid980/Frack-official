import { IsArray, IsIn, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export const DOCUMENT_TYPES = [
  'FARD',
  'SALE_DEED',
  'MUTATION_RECORD',
  'SPV_REGISTRATION',
  'LEGAL_OPINION',
  'WHITEPAPER',
  'INSURANCE_POLICY',
  'VALUATION_REPORT',
  'OTHER',
] as const;

export const DOCUMENT_VISIBILITIES = ['PUBLIC', 'PRIVATE'] as const;

export class CreateAssetDocumentDto {
  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  documentType?: string;

  @IsOptional()
  @IsIn(DOCUMENT_VISIBILITIES)
  visibility?: 'PUBLIC' | 'PRIVATE';

  @IsOptional()
  @IsString()
  bucket?: string;

  @IsOptional()
  @IsString()
  path?: string;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  fileHash?: string;

  @IsOptional()
  @IsString()
  hash?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsString()
  publicUrl?: string;

  @IsOptional()
  @IsString()
  uploadedById?: string;

  @IsOptional()
  @IsString()
  uploadedByWallet?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  size?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  sizeBytes?: number;
}

export class RegisterAssetDocumentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAssetDocumentDto)
  documents!: CreateAssetDocumentDto[];

  @IsOptional()
  @IsString()
  uploadedByWallet?: string;
}
