import { Module } from "@nestjs/common";
import { AssetRequestsController } from "./asset-requests.controller";
import { AssetRequestsService } from "./asset-requests.service";

@Module({
  controllers: [AssetRequestsController],
  providers: [AssetRequestsService],
})
export class AssetRequestsModule {}
