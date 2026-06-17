import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class RegisterWalletDto {
  @IsString()
  userId!: string;

  @IsString()
  publicKey!: string;

  @IsOptional()
  @IsString()
  network?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}
