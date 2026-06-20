import { Module } from "@nestjs/common";
import { AssetDocumentsModule } from "../asset-documents/asset-documents.module";
import { AssetRequestsController } from "./asset-requests.controller";
import { AssetRequestsService } from "./asset-requests.service";

@Module({
  imports: [AssetDocumentsModule],
  controllers: [AssetRequestsController],
  providers: [AssetRequestsService],
})
export class AssetRequestsModule {}
