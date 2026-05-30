import { IsOptional, IsString } from 'class-validator';

export class UpdateTokenSellListingDto {
  @IsString()
  status!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
