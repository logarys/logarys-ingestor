import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  connect,
  headers,
  JSONCodec,
  JetStreamClient,
  JetStreamManager,
  NatsConnection,
} from "nats";

@Injectable()
export class NatsJetstreamService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(NatsJetstreamService.name);
  private readonly codec = JSONCodec();
  private connection?: NatsConnection;
  private jetstream?: JetStreamClient;
  private jetstreamManager?: JetStreamManager;

  public constructor(private readonly configService: ConfigService) {}

  public async onModuleInit(): Promise<void> {
    const servers = this.configService.get<string>("natsUrl", { infer: true })!;
    const name = this.configService.get<string>("natsClientName", {
      infer: true,
    })!;
    const timeout = this.configService.get<number>("natsTimeoutMs", {
      infer: true,
    })!;

    this.connection = await connect({
      servers,
      name,
      timeout,
    });

    this.jetstream = this.connection.jetstream();
    this.jetstreamManager = await this.connection.jetstreamManager();

    await this.ensureStream();

    this.logger.log(`Connected to NATS at ${servers}`);
  }

  public async publish(
    subject: string,
    payload: unknown,
    messageHeaders?: Record<string, string>,
  ): Promise<void> {
    if (!this.jetstream) {
      throw new Error("JetStream client is not initialized");
    }

    const publishHeaders = headers();

    for (const [key, value] of Object.entries(messageHeaders ?? {})) {
      publishHeaders.set(key, value);
    }

    await this.jetstream.publish(subject, this.codec.encode(payload), {
      headers: publishHeaders,
      timeout: this.configService.get<number>("jetstreamPublishTimeoutMs", {
        infer: true,
      })!,
    });
  }

  public async onApplicationShutdown(): Promise<void> {
    await this.connection?.drain();
    await this.connection?.close();
  }

  private async ensureStream(): Promise<void> {
    if (!this.jetstreamManager) {
      throw new Error("JetStream manager is not initialized");
    }

    const streamName = this.configService.get<string>("natsStream", {
      infer: true,
    })!;
    const subjects = this.configService
      .get<string>("natsSubjects", { infer: true })!
      .split(",")
      .map((subject) => subject.trim())
      .filter(Boolean);

    try {
      const info = await this.jetstreamManager.streams.info(streamName);
      const existingSubjects = info.config.subjects ?? [];
      const mergedSubjects = [...new Set([...existingSubjects, ...subjects])];

      if (mergedSubjects.length !== existingSubjects.length) {
        await this.jetstreamManager.streams.update(streamName, {
          ...info.config,
          subjects: mergedSubjects,
        });

        this.logger.log(
          `Updated JetStream stream ${streamName} subjects to ${mergedSubjects.join(", ")}`,
        );
      }

      return;
    } catch (error: unknown) {
      if (!this.isStreamNotFound(error)) {
        throw error;
      }
    }

    await this.jetstreamManager.streams.add({
      name: streamName,
      subjects,
    });

    this.logger.log(
      `Created JetStream stream ${streamName} for subjects ${subjects.join(", ")}`,
    );
  }

  private isStreamNotFound(error: unknown): boolean {
    const candidate = error as {
      code?: string | number;
      api_error?: { err_code?: number; code?: number };
      message?: string;
    };

    return (
      candidate.code === "404" ||
      candidate.code === 404 ||
      candidate.api_error?.code === 404 ||
      candidate.api_error?.err_code === 10059 ||
      /stream.*not found/i.test(candidate.message ?? "")
    );
  }
}
