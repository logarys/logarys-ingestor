import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  GlobalPipelinesConfig,
  PipelineConfig,
} from "../domain/pipeline-config.type.js";

@Injectable()
export class PipelineConfigService implements OnModuleInit {
  private readonly logger = new Logger(PipelineConfigService.name);
  private globalConfig: GlobalPipelinesConfig = { defaults: {} };
  private pipelines = new Map<string, PipelineConfig>();

  public constructor(private readonly configService: ConfigService) {}

  public async onModuleInit(): Promise<void> {
    await this.reload();
  }

  public async reload(): Promise<void> {
    const globalFile = this.configService.get<string>("confFile", {
      infer: true,
    })!;
    const pipelinesDir = this.configService.get<string>("confPipelinesDir", {
      infer: true,
    })!;

    await fs.mkdir(path.dirname(globalFile), { recursive: true });
    await fs.mkdir(pipelinesDir, { recursive: true });

    this.globalConfig = await this.readJsonFile<GlobalPipelinesConfig>(
      globalFile,
      { defaults: {} },
    );

    const entries = await fs.readdir(pipelinesDir, { withFileTypes: true });
    const next = new Map<string, PipelineConfig>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) {
        continue;
      }

      const filename = path.join(pipelinesDir, entry.name);
      const pipeline = await this.readJsonFile<PipelineConfig | null>(
        filename,
        null,
      );
      if (!pipeline) {
        continue;
      }

      next.set(pipeline.id, this.mergeWithGlobalDefaults(pipeline));
    }

    this.pipelines = next;
    this.logger.log(`Loaded ${this.pipelines.size} pipeline(s)`);
  }

  public getGlobalConfig(): GlobalPipelinesConfig {
    return this.globalConfig;
  }

  public getAll(): PipelineConfig[] {
    return [...this.pipelines.values()].sort((a, b) =>
      a.id.localeCompare(b.id),
    );
  }

  public getById(id: string): PipelineConfig {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) {
      throw new NotFoundException(`Pipeline ${id} not found`);
    }
    return pipeline;
  }

  public getBySource(source: string): PipelineConfig {
    const pipeline = this.getAll().find((item) => item.source === source);
    if (!pipeline) {
      throw new NotFoundException(`Pipeline for source ${source} not found`);
    }
    return pipeline;
  }

  public async saveGlobalConfig(
    config: GlobalPipelinesConfig,
  ): Promise<GlobalPipelinesConfig> {
    const globalFile = this.configService.get<string>("confFile", {
      infer: true,
    })!;
    await this.writeJsonFile(globalFile, config);
    await this.reload();
    return this.globalConfig;
  }

  public async savePipeline(pipeline: PipelineConfig): Promise<PipelineConfig> {
    const pipelinesDir = this.configService.get<string>("confPipelinesDir", {
      infer: true,
    })!;
    const filepath = path.join(pipelinesDir, `${pipeline.id}.json`);
    await this.writeJsonFile(filepath, pipeline);
    await this.reload();
    return this.getById(pipeline.id);
  }

  public async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PipelineConfig> {
    const current = this.getById(id);
    return this.savePipeline({ ...current, enabled });
  }

  public async deletePipeline(id: string): Promise<void> {
    const pipelinesDir = this.configService.get<string>("confPipelinesDir", {
      infer: true,
    })!;
    const filepath = path.join(pipelinesDir, `${id}.json`);
    await fs.rm(filepath, { force: true });
    await this.reload();
  }

  private mergeWithGlobalDefaults(pipeline: PipelineConfig): PipelineConfig {
    const defaults = this.globalConfig.defaults;

    return {
      ...defaults,
      ...pipeline,
      parser: {
        ...(defaults.parser ?? {}),
        ...(pipeline.parser ?? {}),
      },
      defaults: {
        ...(defaults.defaults ?? {}),
        ...(pipeline.defaults ?? {}),
      },
      publish: {
        ...(defaults.publish ?? {}),
        ...(pipeline.publish ?? {}),
      },
      security: {
        mode: "none",
        ...(defaults.security ?? {}),
        ...(pipeline.security ?? {}),
      },
    } as PipelineConfig;
  }

  private async readJsonFile<T>(filepath: string, fallback: T): Promise<T> {
    try {
      const content = await fs.readFile(filepath, "utf8");
      return JSON.parse(content) as T;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
        return fallback;
      }
      throw error;
    }
  }

  private async writeJsonFile(
    filepath: string,
    payload: unknown,
  ): Promise<void> {
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(
      filepath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8",
    );
  }
}
