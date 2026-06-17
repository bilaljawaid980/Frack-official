import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { StartupValidationService } from "./common/services/startup-validation.service";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger("HTTP");
  app.get(StartupValidationService).validate();

  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowedOrigins = configuredOrigins.length > 0
    ? configuredOrigins
    : ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001", "http://localhost:5173", "http://127.0.0.1:5173"];

  app.enableCors({
    credentials: true,
    origin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin is not allowed by CORS"));
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  app.use(
    (
      req: { method: string; originalUrl: string },
      res: { statusCode: number; on: (event: "finish", cb: () => void) => void },
      next: () => void
    ) => {
      const start = Date.now();
      res.on("finish", () => {
        const durationMs = Date.now() - start;
        const status = res.statusCode;
        const level = status >= 500 ? "error" : status >= 400 ? "warn" : "log";
        const message = `${req.method} ${req.originalUrl} ${status} ${durationMs}ms`;
        if (level === "error") {
          logger.error(message);
        } else if (level === "warn") {
          logger.warn(message);
        } else {
          logger.log(message);
        }
      });
      next();
    }
  );

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`API listening on http://localhost:${port}`);
}

bootstrap();


