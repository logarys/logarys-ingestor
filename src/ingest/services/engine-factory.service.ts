import { Injectable } from "@nestjs/common";
import {
  DefaultEnricher,
  DefaultNormalizer,
  DefaultValidator,
  JsonParser,
  LogNormalizationEngine,
  ParsingError,
  RawParser,
  type LogParser,
  type ParsedLog,
  type RawLogInput,
} from "small-log-normalizer";
import type { PipelineConfig } from "../../pipelines/domain/pipeline-config.type.js";

@Injectable()
export class EngineFactoryService {
  public create(pipeline: PipelineConfig): LogNormalizationEngine {
    const parser = this.createParser(pipeline);

    return new LogNormalizationEngine({
      parsers: [parser],
      normalizer: new DefaultNormalizer(),
      enricher: new DefaultEnricher({
        source: pipeline.defaults?.source ?? pipeline.source,
        host: pipeline.defaults?.host,
        service: pipeline.defaults?.service,
        env: pipeline.defaults?.env,
      }),
      validator: new DefaultValidator(),
    });
  }

  private createParser(pipeline: PipelineConfig): LogParser {
    switch (pipeline.parser.type) {
      case "json":
        return new JsonParser();
      case "regex":
        return new RegexMappedParser(pipeline);
      case "raw":
      default:
        return new RawParser();
    }
  }
}

class RegexMappedParser implements LogParser {
  private readonly regex: RegExp;

  public constructor(private readonly pipeline: PipelineConfig) {
    if (!pipeline.parser.pattern) {
      throw new ParsingError(
        `Pipeline ${pipeline.id} is missing parser.pattern`,
      );
    }
    this.regex = new RegExp(pipeline.parser.pattern, "u");
  }

  public canParse(input: RawLogInput): boolean {
    return this.regex.test(input.raw);
  }

  public parse(input: RawLogInput): ParsedLog {
    const match = this.regex.exec(input.raw);
    if (!match || !match.groups) {
      throw new ParsingError(
        `Pipeline ${this.pipeline.id} could not parse the raw log`,
      );
    }

    const groups = match.groups;
    const mapping = this.pipeline.mapping ?? {};

    const knownGroupNames = new Set<string>([
      mapping.timestamp ?? "timestamp",
      mapping.level ?? "level",
      mapping.message ?? "message",
      mapping.source ?? "source",
      mapping.host ?? "host",
      mapping.service ?? "service",
      mapping.env ?? "env",
    ]);

    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(groups)) {
      if (!knownGroupNames.has(key)) {
        extra[key] = value;
      }
    }

    return {
      timestamp: this.getMappedValue(groups, mapping.timestamp, "timestamp"),
      level: this.getMappedValue(groups, mapping.level, "level"),
      message: this.getMappedValue(groups, mapping.message, "message"),
      source:
        this.getMappedValue(groups, mapping.source, "source") ?? input.source,
      host: this.getMappedValue(groups, mapping.host, "host") ?? input.host,
      service:
        this.getMappedValue(groups, mapping.service, "service") ??
        input.service,
      env: this.getMappedValue(groups, mapping.env, "env") ?? input.env,
      extra: {
        ...(input.metadata ?? {}),
        ...extra,
      },
    };
  }

  private getMappedValue(
    groups: Record<string, string>,
    mappedName: string | undefined,
    fallbackName: string,
  ): string | undefined {
    const groupName = mappedName ?? fallbackName;
    return groups[groupName];
  }
}
