import { Logger, ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

const bootstrapLogger = new Logger("Bootstrap");

process.on("uncaughtException", (error) => {
  console.error("[Bootstrap] Uncaught exception");
  console.error(error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Bootstrap] Unhandled rejection");
  console.error(reason);
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  try {
    bootstrapLogger.log("Starting Logarys ingestor...");

    const app = await NestFactory.create(AppModule, {
      bufferLogs: false,
    });

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidUnknownValues: false,
      }),
    );

    app.enableShutdownHooks();

    const configService = app.get(ConfigService);

    const host =
      configService.get<string>("appHost", { infer: true }) ??
      process.env.APP_HOST ??
      "0.0.0.0";

    const port =
      configService.get<number>("appPort", { infer: true }) ??
      Number.parseInt(process.env.APP_PORT ?? "3000", 10);

    await app.listen(port, host);

    bootstrapLogger.log(
      `Logarys ingestor started successfully on http://${host}:${port}`,
    );
  } catch (error) {
    console.error("[Bootstrap] Logarys ingestor failed to start");

    if (error instanceof Error) {
      console.error(error.message);
      console.error(error.stack);
    } else {
      console.error(error);
    }

    process.exit(1);
  }
}

void bootstrap();