import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { NormalizedLog } from "small-log-normalizer";
import { NatsJetstreamService } from "../../broker/services/nats-jetstream.service.js";
import type { PipelineConfig } from "../../pipelines/domain/pipeline-config.type.js";
import { IngestLogDto, LokiPushStream } from "../dto/ingest-log.dto.js";
import { EngineFactoryService } from "./engine-factory.service.js";
import { PipelineTokenService } from "./pipeline-token.service.js";
import { PipelineService } from "../../pipelines/services/pipeline.service.js";

export interface IngestResult {
  accepted: true;
  pipelineId: string;
  subject: string;
  normalizedLog: NormalizedLog;
}

export interface IngestBatchResult {
  accepted: true;
  pipelineId: string;
  subject: string;
  count: number;
  normalizedLogs: NormalizedLog[];
}

@Injectable()
export class IngestService {
  public constructor(
    private readonly pipelineService: PipelineService,
    private readonly pipelineTokenService: PipelineTokenService,
    private readonly engineFactoryService: EngineFactoryService,
    private readonly natsJetstreamService: NatsJetstreamService,
  ) {}

  public async ingest(
    source: string,
    dto: IngestLogDto,
    request: Request,
  ): Promise<IngestResult | IngestBatchResult> {
    const pipeline = this.pipelineService.getPipeline(source);

    if (!pipeline) {
      throw new ConflictException(`Pipeline not found for source ${source}`);
    }
    if (!pipeline.enabled) {
      throw new ConflictException(`Pipeline ${pipeline.id} is disabled`);
    }

    this.pipelineTokenService.validate(request, pipeline);

    if (this.isLokiPush(dto)) {
      return this.ingestLokiPush(pipeline, dto);
    }

    if (typeof dto.raw !== "string") {
      throw new BadRequestException(["raw must be a string"]);
    }

    return this.ingestOne(pipeline, dto);
  }

  private async ingestLokiPush(
    pipeline: PipelineConfig,
    dto: IngestLogDto,
  ): Promise<IngestBatchResult> {
    const normalizedLogs: NormalizedLog[] = [];

    for (const stream of dto.streams ?? []) {
      const labels = this.normalizeLokiLabels(stream.stream);

      for (const value of stream.values ?? []) {
        const [lokiTimestampNs, raw] = value;

        if (typeof raw !== "string") {
          continue;
        }

        const normalizedLog = await this.ingestOne(pipeline, {
          raw,
          source: labels.source ?? pipeline.defaults?.source ?? pipeline.source,
          host: labels.host ?? pipeline.defaults?.host,
          service: labels.service ?? pipeline.defaults?.service,
          env: labels.env ?? labels.environment ?? pipeline.defaults?.env,
          metadata: {
            ...labels,
            lokiTimestampNs,
          },
        });

        normalizedLogs.push(normalizedLog.normalizedLog);
      }
    }

    if (normalizedLogs.length === 0) {
      throw new BadRequestException("Loki push payload does not contain log values");
    }

    return {
      accepted: true,
      pipelineId: pipeline.id,
      subject: pipeline.publish.subject,
      count: normalizedLogs.length,
      normalizedLogs,
    };
  }

  private async ingestOne(
    pipeline: PipelineConfig,
    dto: IngestLogDto,
  ): Promise<IngestResult> {
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
        "x-pipeline-id": pipeline.id,
        "x-source": pipeline.source,
        "x-log-level": normalizedLog.level,
      },
    );

    return {
      accepted: true,
      pipelineId: pipeline.id,
      subject: pipeline.publish.subject,
      normalizedLog,
    };
  }

  private normalizeLog(
    pipeline: PipelineConfig,
    dto: IngestLogDto,
  ): NormalizedLog {
    const engine = this.engineFactoryService.create(pipeline);

    return engine.normalize({
      raw: dto.raw ?? "",
      source: dto.source ?? pipeline.defaults?.source ?? pipeline.source,
      host: dto.host ?? pipeline.defaults?.host,
      service: dto.service ?? pipeline.defaults?.service,
      env: dto.env ?? pipeline.defaults?.env,
      metadata: dto.metadata,
    });
  }

  private isLokiPush(dto: IngestLogDto): boolean {
    return Array.isArray(dto.streams);
  }

  private normalizeLokiLabels(
    labels: Record<string, string> | undefined,
  ): Record<string, string> {
    if (!labels) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(labels).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  }
}
