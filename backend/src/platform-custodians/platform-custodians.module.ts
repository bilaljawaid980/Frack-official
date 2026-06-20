import { Module } from '@nestjs/common';
import { PlatformWalletSignatureGuard } from '../common/guards/platform-wallet-signature.guard';
import { PlatformCustodiansController } from './platform-custodians.controller';
import { PlatformCustodiansService } from './platform-custodians.service';

@Module({
  controllers: [PlatformCustodiansController],
  providers: [PlatformCustodiansService, PlatformWalletSignatureGuard],
  exports: [PlatformCustodiansService],
})
export class PlatformCustodiansModule {}
