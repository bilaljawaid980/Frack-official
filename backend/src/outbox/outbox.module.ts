import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OutboxService } from './outbox.service';
import { OutboxWorker } from './outbox.worker';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [OutboxService, OutboxWorker],
  exports: [OutboxService],
})
export class OutboxModule {}
