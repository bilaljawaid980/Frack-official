import { Body, Controller, Get, Param, Patch, Post, Query } from "@nestjs/common";
import { AssetRequestsService } from "./asset-requests.service";
import { CreateAssetRequestDto } from "./dto/create-asset-request.dto";
import { UpdateAssetRequestStatusDto } from "./dto/update-asset-request-status.dto";

@Controller("asset-requests")
export class AssetRequestsController {
  constructor(private readonly assetRequestsService: AssetRequestsService) {}

  @Get()
  findAll(@Query("status") status?: string) {
    return this.assetRequestsService.findAll(status);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.assetRequestsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateAssetRequestDto) {
    return this.assetRequestsService.create(dto);
  }

  @Patch(":id/status")
  updateStatus(
    @Param("id") id: string,
    @Body() dto: UpdateAssetRequestStatusDto,
  ) {
    return this.assetRequestsService.updateStatus(id, dto);
  }
}
