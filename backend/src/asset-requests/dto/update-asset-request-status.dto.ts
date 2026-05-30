import { IsOptional, IsString } from "class-validator";

export class UpdateAssetRequestStatusDto {
  @IsString()
  status!: "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "DEPLOYED";

  @IsOptional()
  @IsString()
  reviewedBy?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;

  @IsOptional()
  @IsString()
  deployedAssetId?: string;

  @IsOptional()
  @IsString()
  txHash?: string;
}
