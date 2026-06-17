import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxWorker.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly outbox: OutboxService) {}

  onModuleInit() {
    if (process.env.OUTBOX_WORKER_ENABLED !== 'true') return;
    const intervalMs = Number(process.env.OUTBOX_WORKER_INTERVAL_MS || 30000);
    this.timer = setInterval(() => void this.inspectPending(), intervalMs);
    this.logger.log(`Outbox worker enabled with ${intervalMs}ms interval`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async inspectPending() {
    const events = await this.outbox.nextPending(10);
    if (events.length > 0) {
      this.logger.warn(`Outbox has ${events.length} pending event(s); handlers are not enabled in Phase 1.`);
    }
  }
}
