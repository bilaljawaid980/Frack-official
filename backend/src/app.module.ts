import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import configuration from "./config/configuration";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { AssetsModule } from "./assets/assets.module";
import { IssuanceModule } from "./issuance/issuance.module";
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
import { OrganizationsModule } from './organizations/organizations.module';
import { WalletsModule } from './wallets/wallets.module';
import { PlatformRolesModule } from './roles/roles.module';
import { AuthorityBindingsModule } from './authority-bindings/authority-bindings.module';
import { WorkflowsModule } from './workflows/workflows.module';
import { AuditModule } from './audit/audit.module';
import { OutboxModule } from './outbox/outbox.module';
import { CustodyModule } from './custody/custody.module';
import { PlatformCustodiansModule } from './platform-custodians/platform-custodians.module';
import { AssetDocumentsModule } from './asset-documents/asset-documents.module';
import { ValuationsModule } from './valuations/valuations.module';
import { StartupValidationService } from './common/services/startup-validation.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    PrismaModule,
    AuthModule,
    UsersModule,
    AssetsModule,
    IssuanceModule,
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
    OrganizationsModule,
    WalletsModule,
    PlatformRolesModule,
    AuthorityBindingsModule,
    WorkflowsModule,
    AuditModule,
    OutboxModule,
    CustodyModule,
    PlatformCustodiansModule,
    AssetDocumentsModule,
    ValuationsModule,
  ],
  providers: [StartupValidationService],
})
export class AppModule {}
