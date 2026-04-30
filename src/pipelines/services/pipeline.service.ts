import { Injectable, OnModuleInit } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import process from "node:process";
import { PipelineConfig } from "../domain/pipeline-config.type.js";
import { PipelineConfigService } from "./pipeline-config.service.js";

@Injectable()
export class PipelineService implements OnModuleInit {
  private pipelines: Map<string, PipelineConfig> = new Map();

  constructor(
    private readonly pipelineConfigService: PipelineConfigService,
    private readonly http: HttpService,
  ) {}

  async onModuleInit() {
    await this.initFromFileOrRemote();
  }

  async initFromFileOrRemote() {
    const remote = await this.fetchRemote();

    if (!remote || remote.length === 0) {
      const localPipelines = this.pipelineConfigService.getAll();

      await this.importToConsole(localPipelines);
      this.setPipelines(localPipelines);

      return;
    }

    this.setPipelines(remote);
  }

  private setPipelines(pipelines: PipelineConfig[]) {
    this.pipelines.clear();

    for (const p of pipelines) {
      if (p.enabled) {
        this.pipelines.set(p.source, p);
      }
    }
  }

  getPipeline(source: string): PipelineConfig | undefined {
    return this.pipelines.get(source);
  }

  async refresh() {
    const remote = await this.fetchRemote();

    if (remote) {
      this.setPipelines(remote);
    }
  }

  private async fetchRemote(): Promise<PipelineConfig[]> {
    if (!process.env.CONSOLE_URL) {
      return [];
    }

    try {
      const res = await this.http.axiosRef.get(
        `${process.env.CONSOLE_URL}/pipelines`,
      );

      return Array.isArray(res.data) ? res.data : [];
    } catch {
      return [];
    }
  }

  private async importToConsole(pipelines: PipelineConfig[]) {
    if (!process.env.CONSOLE_URL) {
      return;
    }

    await this.http.axiosRef.post(
      `${process.env.CONSOLE_URL}/pipelines/import`,
      pipelines,
    );
  }
}