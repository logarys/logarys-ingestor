import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import process from "node:process";
import { PipelineConfig } from "../domain/pipeline-config.type.js";
import { PipelineConfigService } from "./pipeline-config.service.js";

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
    await this.initFromFileOrRemote();
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

    if (remotePipelines !== null && remotePipelines.length > 0) {
      this.setPipelines(remotePipelines);
      await this.rewriteLocalFilesFromRemote(remotePipelines);
      return;
    }

    const localPipelines = this.pipelineConfigService.getAll();

    if (remotePipelines !== null && localPipelines.length > 0) {
      await this.importToStorageManager(localPipelines);
      const reloadedRemotePipelines = await this.fetchRemote();
      const effectivePipelines =
        reloadedRemotePipelines !== null && reloadedRemotePipelines.length > 0
          ? reloadedRemotePipelines
          : localPipelines;

      this.setPipelines(effectivePipelines);

      if (reloadedRemotePipelines !== null && reloadedRemotePipelines.length > 0) {
        await this.rewriteLocalFilesFromRemote(reloadedRemotePipelines);
      }

      return;
    }

    this.setPipelines(localPipelines);
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

    const res = await this.http.axiosRef.post(
      `${url}/pipelines`,
      this.toStorageManagerPipeline(pipeline),
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

    const res = await this.http.axiosRef.put(
      `${url}/pipelines/${encodeURIComponent(id)}`,
      this.toStorageManagerPipeline(pipeline),
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
      source: pipeline.defaults?.source,
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

    const publish = {
      subject:
        pipeline.publish?.subject ?? `logs.${pipeline.source}.normalized`,
    };

    return this.compactObject({
      id: pipeline.id,
      source: pipeline.source,
      enabled: pipeline.enabled,
      parser: nextParser,
      defaults: Object.keys(defaults).length > 0 ? defaults : undefined,
      publish,
      security: pipeline.security ?? { mode: "none" },
    }) as PipelineConfig;
  }

  private compactObject<T extends Record<string, unknown>>(
    payload: T,
  ): Partial<T> {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined),
    ) as Partial<T>;
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
