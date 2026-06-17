import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class StartupValidationService {
  private readonly logger = new Logger(StartupValidationService.name);

  validate() {
    const sandboxMode = process.env.SANDBOX_MODE === 'true';
    const databaseUrl = process.env.DATABASE_URL || '';
    const cluster = process.env.SOLANA_CLUSTER || 'devnet';
    const bucket = process.env.SUPABASE_BUCKET || process.env.SUPABASE_STORAGE_BUCKET || '';

    if (sandboxMode && /prod|production/i.test(databaseUrl)) {
      throw new Error('Refusing to start sandbox mode with a production-looking DATABASE_URL.');
    }

    if (sandboxMode && cluster === 'mainnet-beta') {
      throw new Error('Refusing to start sandbox mode on mainnet-beta.');
    }

    if (sandboxMode && bucket && !bucket.endsWith('-sandbox')) {
      this.logger.warn('SANDBOX_MODE=true but Supabase bucket name does not end with -sandbox.');
    }

    if (!sandboxMode && cluster === 'devnet') {
      this.logger.warn('SANDBOX_MODE is not true but SOLANA_CLUSTER is devnet.');
    }

    const origins = (process.env.CORS_ALLOWED_ORIGINS || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      this.logger.warn('CORS_ALLOWED_ORIGINS is not set; CORS will allow localhost development origins only.');
    }
  }
}
