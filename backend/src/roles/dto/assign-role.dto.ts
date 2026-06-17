import { IsOptional, IsString } from 'class-validator';

export class AssignRoleDto {
  @IsString()
  walletAddress!: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  grantedBy?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  environment?: string;

  @IsOptional()
  @IsString()
  network?: string;
}
