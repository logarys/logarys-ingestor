import { Module } from '@nestjs/common';
import { BrokerModule } from '../broker/broker.module.js';
import { PipelinesModule } from '../pipelines/pipelines.module.js';
import { IngestController } from './controllers/ingest.controller.js';
import { EngineFactoryService } from './services/engine-factory.service.js';
import { IngestService } from './services/ingest.service.js';
import { PipelineTokenService } from './services/pipeline-token.service.js';

@Module({
  imports: [PipelinesModule, BrokerModule],
  controllers: [IngestController],
  providers: [IngestService, PipelineTokenService, EngineFactoryService],
})
export class IngestModule {}
