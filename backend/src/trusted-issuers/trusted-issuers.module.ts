import { Module } from '@nestjs/common';
import { PlatformWalletSignatureGuard } from '../common/guards/platform-wallet-signature.guard';
import { TrustedIssuersController } from './trusted-issuers.controller';
import { TrustedIssuersService } from './trusted-issuers.service';

@Module({
  controllers: [TrustedIssuersController],
  providers: [TrustedIssuersService, PlatformWalletSignatureGuard],
})
export class TrustedIssuersModule {}
