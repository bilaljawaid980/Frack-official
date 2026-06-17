import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PlatformRolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformRolesController],
  providers: [RolesService],
  exports: [RolesService],
})
export class PlatformRolesModule {}
