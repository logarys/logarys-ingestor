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
      case "loki":
        return new LokiParser(pipeline);
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

class LokiParser implements LogParser {
  public constructor(private readonly pipeline: PipelineConfig) {}

  public canParse(input: RawLogInput): boolean {
    return typeof input.raw === "string" && input.raw.length > 0;
  }

  public parse(input: RawLogInput): ParsedLog {
    const fields = this.parseKeyValueLine(input.raw);
    const metadata = input.metadata ?? {};

    const lokiTimestamp =
      this.asString(metadata.lokiTimestampNs) ?? this.asString(metadata.lokiTimestamp);

    const timestamp =
      fields.timestamp ?? fields.time ?? fields.ts ?? this.timestampFromLokiNs(lokiTimestamp);

    const level = fields.level ?? fields.severity ?? fields.m_level ?? "info";
    const message =
      fields.message ?? fields.msg ?? fields.m_msg ?? fields.log ?? input.raw;

    const extra = { ...metadata } as Record<string, unknown>;

    for (const [key, value] of Object.entries(fields)) {
      if (
        ![
          "timestamp",
          "time",
          "ts",
          "level",
          "severity",
          "m_level",
          "message",
          "msg",
          "m_msg",
          "source",
          "host",
          "service",
          "env",
          "environment",
        ].includes(key)
      ) {
        extra[key] = value;
      }
    }

    return {
      timestamp,
      level,
      message,
      source: fields.source ?? input.source,
      host: fields.host ?? input.host,
      service: fields.service ?? input.service,
      env: fields.env ?? fields.environment ?? input.env,
      extra,
    };
  }

  private parseKeyValueLine(raw: string): Record<string, string> {
    const fields: Record<string, string> = {};
    const matcher = /([A-Za-z_][A-Za-z0-9_.-]*)=("(?:\\.|[^"])*"|\S*)/gu;

    for (const match of raw.matchAll(matcher)) {
      fields[match[1]] = this.decodeValue(match[2]);
    }

    if (Object.keys(fields).length === 0) {
      fields.message = raw;
    }

    return fields;
  }

  private decodeValue(value: string): string {
    if (value.startsWith('"') && value.endsWith('"')) {
      try {
        return JSON.parse(value) as string;
      } catch {
        return value.slice(1, -1);
      }
    }

    return value;
  }

  private timestampFromLokiNs(value: string | undefined): string | undefined {
    if (!value || !/^\d+$/.test(value)) {
      return undefined;
    }

    const millis = Number(BigInt(value) / 1_000_000n);
    return new Date(millis).toISOString();
  }

  private asString(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
  }
}

