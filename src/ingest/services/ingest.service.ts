import { ConflictException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { NormalizedLog } from 'small-log-normalizer';
import { NatsJetstreamService } from '../../broker/services/nats-jetstream.service.js';
import type { PipelineConfig } from '../../pipelines/domain/pipeline-config.type.js';
import { PipelineConfigService } from '../../pipelines/services/pipeline-config.service.js';
import { IngestLogDto } from '../dto/ingest-log.dto.js';
import { EngineFactoryService } from './engine-factory.service.js';
import { PipelineTokenService } from './pipeline-token.service.js';

export interface IngestResult {
  accepted: true;
  pipelineId: string;
  subject: string;
  normalizedLog: NormalizedLog;
}

@Injectable()
export class IngestService {
  public constructor(
    private readonly pipelineConfigService: PipelineConfigService,
    private readonly pipelineTokenService: PipelineTokenService,
    private readonly engineFactoryService: EngineFactoryService,
    private readonly natsJetstreamService: NatsJetstreamService,
  ) {}

  public async ingest(source: string, dto: IngestLogDto, request: Request): Promise<IngestResult> {
    const pipeline = this.pipelineConfigService.getBySource(source);

    if (!pipeline.enabled) {
      throw new ConflictException(`Pipeline ${pipeline.id} is disabled`);
    }

    this.pipelineTokenService.validate(request, pipeline);

    const normalizedLog = this.normalizeLog(pipeline, dto);
    await this.natsJetstreamService.publish(
      pipeline.publish.subject,
      {
        pipelineId: pipeline.id,
        source: pipeline.source,
        receivedAt: new Date().toISOString(),
        normalizedLog,
      },
      {
        'x-pipeline-id': pipeline.id,
        'x-source': pipeline.source,
        'x-log-level': normalizedLog.level,
      },
    );

    return {
      accepted: true,
      pipelineId: pipeline.id,
      subject: pipeline.publish.subject,
      normalizedLog,
    };
  }

  private normalizeLog(pipeline: PipelineConfig, dto: IngestLogDto): NormalizedLog {
    const engine = this.engineFactoryService.create(pipeline);

    return engine.normalize({
      raw: dto.raw,
      source: dto.source ?? pipeline.defaults?.source ?? pipeline.source,
      host: dto.host ?? pipeline.defaults?.host,
      service: dto.service ?? pipeline.defaults?.service,
      env: dto.env ?? pipeline.defaults?.env,
      metadata: dto.metadata,
    });
  }
}
