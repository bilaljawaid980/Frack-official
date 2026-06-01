import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateTokenTransferRequestDto } from './create-token-transfer-request.dto';

export class UpdateTokenTransferRequestDto extends PartialType(CreateTokenTransferRequestDto) {
  @IsOptional()
  @IsString()
  reviewerWallet?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  transferTxHash?: string;

  @IsOptional()
  @IsString()
  claimTxHash?: string;

  @IsOptional()
  @IsString()
  whitelistTxHash?: string;

  @IsOptional()
  @IsString()
  activationTxHash?: string;
}
