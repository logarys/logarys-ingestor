import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { normalizePipelineConfig, validatePipelineConfig } from "@logarys/pipeline-validator";
import process from "node:process";
import { PipelineConfig } from "../domain/pipeline-config.type.js";
import { PipelineConfigService } from "./pipeline-config.service.js";
import { BadRequestException } from "@nestjs/common";

@Injectable()
export class PipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PipelineService.name);
  private pipelines: Map<string, PipelineConfig> = new Map();
  private refreshTimer?: NodeJS.Timeout;

  public constructor(
    private readonly pipelineConfigService: PipelineConfigService,
    private readonly http: HttpService,
  ) {}

  public async onModuleInit(): Promise<void> {
    this.logger.log("Loading pipeline configuration...");
  
    await this.initFromFileOrRemote();
  
    this.logger.log(
      `Pipeline configuration loaded successfully: ${this.pipelines.size} pipeline(s) in cache`,
    );
  
    this.startRefreshTimer();
  }
  public onModuleDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }

  /**
   * Bootstrap rules:
   * - storage-manager/MongoDB is the source of truth when it already has pipelines.
   * - local files are imported only when the remote pipeline collection is empty.
   * - when remote pipelines exist, local files are rewritten from remote config.
   */
  public async initFromFileOrRemote(): Promise<void> {
    await this.pipelineConfigService.reload();
  
    const remotePipelines = await this.fetchRemote();
  
    this.logger.log(
      `Storage-manager returned ${remotePipelines?.length ?? "no"} pipeline(s)`,
    );
  
    if (remotePipelines && remotePipelines.length > 0) {
      this.setPipelines(remotePipelines);
      await this.rewriteLocalFilesFromRemote(remotePipelines);
  
      this.logger.log(
        "Using storage-manager pipeline configuration as source of truth",
      );
  
      return;
    }
  
    const localPipelines = this.pipelineConfigService.getAll();
  
    this.logger.log(`Local files contain ${localPipelines.length} pipeline(s)`);
  
    if (localPipelines.length > 0) {
      await this.importToStorageManager(localPipelines);
  
      const reloadedRemotePipelines = await this.fetchRemote();
      const effectivePipelines: PipelineConfig[] =
        reloadedRemotePipelines !== null && reloadedRemotePipelines.length > 0
          ? reloadedRemotePipelines
          : localPipelines;

      this.setPipelines(effectivePipelines);

      if (reloadedRemotePipelines !== null && reloadedRemotePipelines.length > 0) {
        await this.rewriteLocalFilesFromRemote(reloadedRemotePipelines);
      }

      this.logger.log(
        `Imported local pipeline configuration into storage-manager: ${effectivePipelines.length} pipeline(s)`,
      );
  
      return;
    }
  
    this.setPipelines([]);
  
    this.logger.warn(
      "No pipeline configuration found in storage-manager or local files",
    );
  }

  public getPipeline(source: string): PipelineConfig | undefined {
    return this.pipelines.get(source);
  }

  public getAllCached(): PipelineConfig[] {
    return [...this.pipelines.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  public async refresh(): Promise<void> {
    const remote = await this.fetchRemote();

    if (remote === null) {
      return;
    }

    this.setPipelines(remote);
    await this.rewriteLocalFilesFromRemote(remote);
  }

  public async createPipeline(
    pipeline: PipelineConfig,
  ): Promise<PipelineConfig> {
    const created = await this.postPipeline(pipeline);
    await this.refreshAfterMutation();
    return created;
  }

  public async updatePipeline(
    id: string,
    pipeline: PipelineConfig,
  ): Promise<PipelineConfig> {
    const updated = await this.putPipeline(id, { ...pipeline, id });
    await this.refreshAfterMutation();
    return updated;
  }

  public async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PipelineConfig> {
    const updated = await this.postPipelineAction(
      id,
      enabled ? "enable" : "disable",
    );
    await this.refreshAfterMutation();
    return updated;
  }

  public async deletePipeline(id: string): Promise<void> {
    const url = this.getStorageManagerUrl();

    if (!url) {
      await this.pipelineConfigService.deletePipeline(id);
      await this.initFromFileOrRemote();
      return;
    }

    await this.http.axiosRef.delete(
      `${url}/pipelines/${encodeURIComponent(id)}`,
      {
        headers: this.authHeaders(),
      },
    );

    this.pipelines.delete(id);
    await this.refreshAfterMutation();
  }

  public async getGlobalConfig() {
    return this.pipelineConfigService.getGlobalConfig();
  }

  public async saveGlobalConfig(
    config: Parameters<PipelineConfigService["saveGlobalConfig"]>[0],
  ) {
    return this.pipelineConfigService.saveGlobalConfig(config);
  }

  private startRefreshTimer(): void {
    const refreshMs = Number.parseInt(
      process.env.PIPELINE_CONFIG_REFRESH_MS ?? "30000",
      10,
    );

    if (!Number.isFinite(refreshMs) || refreshMs <= 0) {
      return;
    }

    this.refreshTimer = setInterval(() => {
      this.refresh().catch((error: unknown) => {
        this.logger.error(
          `Unable to refresh pipeline configuration from storage-manager: ${this.formatError(error)}`,
        );
      });
    }, refreshMs);

    this.refreshTimer.unref?.();
  }

  private setPipelines(pipelines: PipelineConfig[]): void {
    this.pipelines.clear();

    for (const pipeline of pipelines) {
      if (pipeline.source) {
        this.pipelines.set(pipeline.source, pipeline);
      }
    }
  }

  private async fetchRemote(): Promise<PipelineConfig[] | null> {
    const storageManagerUrl = this.getStorageManagerUrl();

    if (!storageManagerUrl) {
      return null;
    }

    try {
      const res = await this.http.axiosRef.get(
        `${storageManagerUrl}/pipelines`,
        {
          headers: this.authHeaders(),
        },
      );
      return this.extractPipelines(res.data);
    } catch (error) {
      this.logger.error(
        `Unable to fetch pipeline configuration from storage-manager: ${this.formatError(error)}`,
      );
      return null;
    }
  }

  private async importToStorageManager(
    pipelines: PipelineConfig[],
  ): Promise<void> {
    if (pipelines.length === 0) {
      return;
    }

    const storageManagerUrl = this.getStorageManagerUrl();

    if (!storageManagerUrl) {
      return;
    }

    const errors: string[] = [];

    for (const pipeline of pipelines) {
      const payload = this.toStorageManagerPipeline(pipeline);

      try {
        this.assertValidStorageManagerPipeline(
          payload,
          `local file import for pipeline ${pipeline.id}`,
        );

        await this.http.axiosRef.post(
          `${storageManagerUrl}/pipelines`,
          payload,
          {
            headers: this.authHeaders(),
          },
        );
      } catch (error) {
        errors.push(`${pipeline.id}: ${this.formatError(error)}`);
      }
    }

    if (errors.length > 0) {
      const message = `Unable to import local pipeline configuration to storage-manager. Attempts failed: ${errors.join(" | ")}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  private async postPipeline(
    pipeline: PipelineConfig,
  ): Promise<PipelineConfig> {
    const url = this.getStorageManagerUrl();

    if (!url) {
      const saved = await this.pipelineConfigService.savePipeline(pipeline);
      this.setPipelines(this.pipelineConfigService.getAll());
      return saved;
    }

    const payload = this.toStorageManagerPipeline(pipeline);
    this.assertValidStorageManagerPipeline(
      payload,
      `create pipeline ${pipeline.id}`,
    );

    const res = await this.http.axiosRef.post(
      `${url}/pipelines`,
      payload,
      {
        headers: this.authHeaders(),
      },
    );

    return res.data as PipelineConfig;
  }

  private async putPipeline(
    id: string,
    pipeline: PipelineConfig,
  ): Promise<PipelineConfig> {
    const url = this.getStorageManagerUrl();

    if (!url) {
      const saved = await this.pipelineConfigService.savePipeline(pipeline);
      this.setPipelines(this.pipelineConfigService.getAll());
      return saved;
    }

    const payload = this.toStorageManagerPipeline(pipeline);
    this.assertValidStorageManagerPipeline(
      payload,
      `update pipeline ${id}`,
    );

    const res = await this.http.axiosRef.put(
      `${url}/pipelines/${encodeURIComponent(id)}`,
      payload,
      {
        headers: this.authHeaders(),
      },
    );

    return res.data as PipelineConfig;
  }

  private async postPipelineAction(
    id: string,
    action: "enable" | "disable",
  ): Promise<PipelineConfig> {
    const url = this.getStorageManagerUrl();

    if (!url) {
      const saved = await this.pipelineConfigService.setEnabled(
        id,
        action === "enable",
      );
      this.setPipelines(this.pipelineConfigService.getAll());
      return saved;
    }

    const res = await this.http.axiosRef.post(
      `${url}/pipelines/${encodeURIComponent(id)}/${action}`,
      {},
      { headers: this.authHeaders() },
    );

    return res.data as PipelineConfig;
  }

  private async refreshAfterMutation(): Promise<void> {
    const remote = await this.fetchRemote();

    if (remote !== null) {
      this.setPipelines(remote);
      await this.rewriteLocalFilesFromRemote(remote);
      return;
    }

    await this.pipelineConfigService.reload();
    this.setPipelines(this.pipelineConfigService.getAll());
  }

  private async rewriteLocalFilesFromRemote(
    pipelines: PipelineConfig[],
  ): Promise<void> {
    try {
      await this.pipelineConfigService.replacePipelines(pipelines);
    } catch (error) {
      this.logger.error(
        `Unable to rewrite local pipeline files from storage-manager configuration: ${this.formatError(error)}`,
      );
      throw error;
    }
  }

  private validatePipelineDocumentForStorage(
    pipeline: PipelineConfig,
    context: string,
  ): PipelineConfig {
    const documentErrors: string[] = [];
  
    if (!pipeline.id || typeof pipeline.id !== "string") {
      documentErrors.push("$.id: id is required and must be a string");
    }
  
    if (!pipeline.source || typeof pipeline.source !== "string") {
      documentErrors.push("$.source: source is required and must be a string");
    }
  
    if (typeof pipeline.enabled !== "boolean") {
      documentErrors.push("$.enabled: enabled is required and must be a boolean");
    }
  
    const runtimeConfig = {
      parser: pipeline.parser,
      defaults: {
        ...(pipeline.defaults ?? {}),
        source: pipeline.defaults?.source ?? pipeline.source,
      },
      publish: pipeline.publish ?? {
        subject: `logs.${pipeline.source}.normalized`,
      },
      security: pipeline.security ?? {
        mode: "none",
      },
    };
  
    const validation = validatePipelineConfig(this.compactDeep(runtimeConfig));
      
    const validationErrors = validation.valid
      ? []
      : validation.errors.map((error) => `${error.path}: ${error.message}`);
  
    const errors = [...documentErrors, ...validationErrors];
  
    if (errors.length > 0) {
      const message = `Invalid pipeline configuration before storage-manager import (${context}). errors: ${errors.join(
        " | ",
      )}`;
  
      this.logger.error(message);
  
      throw new BadRequestException(message);
    }
  
    return pipeline;
  }

  private assertValidStorageManagerPipeline(
    pipeline: PipelineConfig,
    context: string,
  ): void {
    const result = validatePipelineConfig(pipeline, {
      document: true,
      requireDocumentFields: true,
    });

    if (result.valid) {
      return;
    }

    const errors = result.errors
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(" | ");

    const warnings = result.warnings
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join(" | ");

    const message = [
      `Invalid pipeline configuration before storage-manager import (${context})`,
      errors ? `errors: ${errors}` : null,
      warnings ? `warnings: ${warnings}` : null,
    ]
      .filter(Boolean)
      .join(". ");

    this.logger.error(message);
    throw new Error(message);
  }

  private toStorageManagerPipeline(pipeline: PipelineConfig): PipelineConfig {
    const parser = pipeline.parser as PipelineConfig["parser"] & {
      regex?: string;
    };

    const parserPattern = parser.pattern ?? parser.regex;

    const nextParser: PipelineConfig["parser"] = {
      type: parser.type,
    };

    if (parserPattern) {
      nextParser.pattern = parserPattern;
    }

    const defaults = this.compactObject({
      source: pipeline.defaults?.source ?? pipeline.source,
      host: pipeline.defaults?.host,
      service: pipeline.defaults?.service,
      env:
        pipeline.defaults?.env ??
        (
          pipeline.defaults as
            | (PipelineConfig["defaults"] & { environment?: string })
            | undefined
        )?.environment,
    });

    const payload = this.compactObject({
      id: pipeline.id,
      source: pipeline.source,
      enabled: pipeline.enabled,
      parser: nextParser,
      defaults,
      publish: {
        subject:
          pipeline.publish?.subject ?? `logs.${pipeline.source}.normalized`,
      },
      security: this.compactDeep({
        mode: pipeline.security?.mode ?? "none",
        token: pipeline.security?.token,
      }),
    }) as PipelineConfig;

    return this.validatePipelineDocumentForStorage(
      payload,
      `pipeline ${pipeline.id ?? pipeline.source}`,
    );
  }
  private compactObject<T extends Record<string, unknown>>(
    payload: T,
  ): Partial<T> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ) as Partial<T>;
  }

  private compactDeep<T>(value: T): T {
    if (Array.isArray(value)) {
      return value.map((item) => this.compactDeep(item)) as T;
    }
  
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, item]) => item !== undefined)
          .map(([key, item]) => [key, this.compactDeep(item)]),
      ) as T;
    }
  
    return value;
  }

  private getStorageManagerUrl(): string | null {
    const url =
      process.env.STORAGE_MANAGER_URL ?? process.env.PIPELINE_CONFIG_URL;

    if (!url) {
      return null;
    }

    return url.replace(/\/+$/, "");
  }

  private authHeaders(): Record<string, string> {
    const token =
      process.env.STORAGE_MANAGER_API_TOKEN ??
      process.env.INGESTOR_API_TOKEN ??
      process.env.API_TOKEN;

    if (!token) {
      return {};
    }

    return {
      Authorization: `Bearer ${token}`,
    };
  }

  private extractPipelines(payload: unknown): PipelineConfig[] {
    if (Array.isArray(payload)) {
      return payload as PipelineConfig[];
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    const candidate = payload as {
      pipelines?: unknown;
      items?: unknown;
      data?: unknown;
    };

    if (Array.isArray(candidate.pipelines)) {
      return candidate.pipelines as PipelineConfig[];
    }

    if (Array.isArray(candidate.items)) {
      return candidate.items as PipelineConfig[];
    }

    if (Array.isArray(candidate.data)) {
      return candidate.data as PipelineConfig[];
    }

    return [];
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}
