import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthorityBindingsService } from './authority-bindings.service';

@Module({
  imports: [PrismaModule],
  providers: [AuthorityBindingsService],
  exports: [AuthorityBindingsService],
})
export class AuthorityBindingsModule {}
