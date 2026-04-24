import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration.js';
import { validateEnv } from './config/env.validation.js';
import { PipelinesModule } from './pipelines/pipelines.module.js';
import { BrokerModule } from './broker/broker.module.js';
import { IngestModule } from './ingest/ingest.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    PipelinesModule,
    BrokerModule,
    IngestModule,
  ],
})
export class AppModule {}
