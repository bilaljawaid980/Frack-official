import { Body, Controller, Get, Post, Delete, Param, Put, UseGuards } from "@nestjs/common";
import { AssetsService } from "./assets.service";
import { CreateAssetDto } from "./dto/create-asset.dto";
import { UpdateAssetDto } from "./dto/update-asset.dto";
import { JwtAuthGuard } from "../common/guards/jwt-auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { Role } from "../common/types/role.enum";

@Controller("assets")
export class AssetsController {
  constructor(private assetsService: AssetsService) {}

  @Get()
  findAll() {
    return this.assetsService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PLATFORM_OWNER, Role.ADMIN)
  create(@Body() dto: CreateAssetDto) {
    return this.assetsService.create(dto);
  }

  @Post("deployed")
  createDeployed(@Body() dto: CreateAssetDto) {
    return this.assetsService.createDeployed(dto);
  }

  @Post("apply")
  apply(@Body() dto: any) {
    const issuerWallet = dto.issuerWallet || "";
    return this.assetsService.apply(dto, issuerWallet);
  }

  @Put(":id")
  update(@Param("id") id: string, @Body() dto: UpdateAssetDto) {
    return this.assetsService.update(id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.assetsService.remove(id);
  }
}
