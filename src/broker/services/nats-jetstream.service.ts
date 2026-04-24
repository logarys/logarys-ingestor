import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { connect, JSONCodec, JetStreamClient, NatsConnection, headers } from 'nats';
@Injectable()
export class NatsJetstreamService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(NatsJetstreamService.name);
  private readonly codec = JSONCodec();
  private connection?: NatsConnection;
  private jetstream?: JetStreamClient;

  public constructor(private readonly configService: ConfigService) {}

  public async onModuleInit(): Promise<void> {
    const servers = this.configService.get<string>('natsUrl', { infer: true })!;
    const name = this.configService.get<string>('natsClientName', { infer: true })!;
    const timeout = this.configService.get<number>('natsTimeoutMs', { infer: true })!;

    this.connection = await connect({
      servers,
      name,
      timeout,
    });
    this.jetstream = this.connection.jetstream();
    this.logger.log(`Connected to NATS at ${servers}`);
  }

  public async publish(
    subject: string,
    payload: unknown,
    messageHeaders?: Record<string, string>,
  ): Promise<void> {
    if (!this.jetstream) {
      throw new Error('JetStream client is not initialized');
    }
  
    const publishHeaders = headers();
  
    for (const [key, value] of Object.entries(messageHeaders ?? {})) {
      publishHeaders.set(key, value);
    }
  
    await this.jetstream.publish(subject, this.codec.encode(payload), {
      headers: publishHeaders,
      timeout: this.configService.get<number>('jetstreamPublishTimeoutMs', { infer: true })!,
    });
  }
  
  public async onApplicationShutdown(): Promise<void> {
    await this.connection?.drain();
    await this.connection?.close();
  }
}
