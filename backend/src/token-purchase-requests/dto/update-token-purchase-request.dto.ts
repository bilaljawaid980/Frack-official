import { PartialType } from '@nestjs/mapped-types';
import { CreateTokenPurchaseRequestDto } from './create-token-purchase-request.dto';
import { IsOptional, IsString } from 'class-validator';

export class UpdateTokenPurchaseRequestDto extends PartialType(CreateTokenPurchaseRequestDto) {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  reviewerWallet?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  claimTxHash?: string;

  @IsOptional()
  @IsString()
  mintTxHash?: string;

  @IsOptional()
  @IsString()
  whitelistTxHash?: string;

  @IsOptional()
  @IsString()
  activationTxHash?: string;
}
