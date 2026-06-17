import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/types/role.enum';
import { AssignRoleDto } from './dto/assign-role.dto';
import { RolesService } from './roles.service';

@Controller('platform-roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.PLATFORM_OWNER)
export class PlatformRolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Query('walletAddress') walletAddress?: string) {
    return this.roles.listActive(walletAddress);
  }

  @Post()
  assign(@Body() dto: AssignRoleDto) {
    return this.roles.assign(dto);
  }

  @Patch(':id/revoke')
  revoke(@Param('id') id: string, @Body() body: { revokedBy?: string; reason?: string }) {
    return this.roles.revoke(id, body.revokedBy, body.reason);
  }
}
