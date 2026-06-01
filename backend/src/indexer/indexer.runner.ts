import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { IndexerModule } from "./indexer.module";
import { IndexerService } from "./indexer.service";

async function run() {
  const app = await NestFactory.createApplicationContext(IndexerModule, {
    logger: ["error", "warn", "log"],
  });
  const indexer = app.get(IndexerService);

  try {
    const runOnce = process.argv.includes("--once");
    await indexer.syncOnce();

    if (runOnce) {
      return;
    }

    const intervalMs = parseInt(process.env.INDEXER_INTERVAL_MS || "30000", 10);
    setInterval(async () => {
      try {
        await indexer.syncOnce();
      } catch (error) {
        console.error("Indexer sync failed:", error);
      }
    }, intervalMs);
  } finally {
    if (process.argv.includes("--once")) {
      await app.close();
    }
  }
}

run();
