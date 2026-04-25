import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { ConfigService } from "@nestjs/config";

type EnvConfig = {
  appHost: string;
  appPort: number;
  logLevels: Array<"log" | "error" | "warn" | "debug" | "verbose" | "fatal">;
};

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const config = app.get(ConfigService<EnvConfig, true>);
  const host = config.get("appHost", { infer: true });
  const port = config.get("appPort", { infer: true });

  await app.listen(port, host);

  Logger.log(`Log ingestor listening on http://${host}:${port}`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  const logger = new Logger("Bootstrap");
  logger.error(
    error instanceof Error ? error.message : "Unknown bootstrap error",
  );
  process.exit(1);
});
