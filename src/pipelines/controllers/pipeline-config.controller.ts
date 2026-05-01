import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import type {
  GlobalPipelinesConfig,
  PipelineConfig,
} from "../domain/pipeline-config.type.js";
import {
  UpsertPipelineDto,
  UpdateGlobalConfigDto,
} from "../dto/pipeline.dto.js";
import { PipelineService } from "../services/pipeline.service.js";
import { IngestorApiTokenGuard } from "../../security/ingestor-api-token.guard.js";

@Controller("pipelines")
@UseGuards(IngestorApiTokenGuard)
export class PipelineConfigController {
  public constructor(private readonly pipelineService: PipelineService) {}

  @Get()
  public getAll(): PipelineConfig[] {
    return this.pipelineService.getAllCached();
  }

  @Get("config")
  public async getGlobalConfig(): Promise<GlobalPipelinesConfig> {
    return this.pipelineService.getGlobalConfig();
  }

  @Put("config")
  public async updateGlobalConfig(
    @Body() dto: UpdateGlobalConfigDto,
  ): Promise<GlobalPipelinesConfig> {
    return this.pipelineService.saveGlobalConfig({
      defaults: dto.defaults,
    });
  }

  @Get(":id")
  public getOne(@Param("id") id: string): PipelineConfig | undefined {
    return this.pipelineService.getAllCached().find((pipeline) => pipeline.id === id);
  }

  @Post()
  public async create(@Body() dto: UpsertPipelineDto): Promise<PipelineConfig> {
    return this.pipelineService.createPipeline(dto);
  }

  @Put(":id")
  public async update(
    @Param("id") id: string,
    @Body() dto: UpsertPipelineDto,
  ): Promise<PipelineConfig> {
    return this.pipelineService.updatePipeline(id, { ...dto, id });
  }

  @Post(":id/enable")
  public async enable(@Param("id") id: string): Promise<PipelineConfig> {
    return this.pipelineService.setEnabled(id, true);
  }

  @Post(":id/disable")
  public async disable(@Param("id") id: string): Promise<PipelineConfig> {
    return this.pipelineService.setEnabled(id, false);
  }

  @Delete(":id")
  public async delete(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.pipelineService.deletePipeline(id);
    return { deleted: true };
  }
}
