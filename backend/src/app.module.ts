import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AssetsModule } from "./assets/assets.module";
import { IssuanceModule } from "./issuance/issuance.module";
import { RedemptionModule } from "./redemption/redemption.module";
import { ComplianceModule } from "./compliance/compliance.module";
import { IndexedModule } from "./indexed/indexed.module";
import { ActivityModule } from "./activity/activity.module";
import { IdentitySnapshotsModule } from "./identity-snapshots/identity-snapshots.module";
import { KycModule } from "./modules/kyc/kyc.module";
import { AssetRequestsModule } from "./asset-requests/asset-requests.module";
import { TokenPurchaseRequestsModule } from './token-purchase-requests/token-purchase-requests.module';
import { TokenTransferRequestsModule } from './token-transfer-requests/token-transfer-requests.module';
import { TokenListingsModule } from './token-listings/token-listings.module';
import { TrustedIssuersModule } from './trusted-issuers/trusted-issuers.module';
import { BlockchainTransactionsModule } from './blockchain-transactions/blockchain-transactions.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AssetsModule,
    IssuanceModule,
    RedemptionModule,
    ComplianceModule,
    IndexedModule,
    ActivityModule,
    IdentitySnapshotsModule,
    KycModule,
    AssetRequestsModule,
    TokenPurchaseRequestsModule,
    TokenTransferRequestsModule,
    TokenListingsModule,
    TrustedIssuersModule,
    BlockchainTransactionsModule,
  ],
})
export class AppModule {}
