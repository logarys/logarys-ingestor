import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from "@nestjs/common";
import type {
  GlobalPipelinesConfig,
  PipelineConfig,
} from "../domain/pipeline-config.type.js";
import {
  UpsertPipelineDto,
  UpdateGlobalConfigDto,
} from "../dto/pipeline.dto.js";
import { PipelineConfigService } from "../services/pipeline-config.service.js";

@Controller("pipelines")
export class PipelineConfigController {
  public constructor(
    private readonly pipelineConfigService: PipelineConfigService,
  ) {}

  @Get()
  public getAll(): PipelineConfig[] {
    return this.pipelineConfigService.getAll();
  }

  @Get("config")
  public getGlobalConfig(): GlobalPipelinesConfig {
    return this.pipelineConfigService.getGlobalConfig();
  }

  @Put("config")
  public async updateGlobalConfig(
    @Body() dto: UpdateGlobalConfigDto,
  ): Promise<GlobalPipelinesConfig> {
    return this.pipelineConfigService.saveGlobalConfig({
      defaults: dto.defaults,
    });
  }

  @Get(":id")
  public getOne(@Param("id") id: string): PipelineConfig {
    return this.pipelineConfigService.getById(id);
  }

  @Post()
  public async create(@Body() dto: UpsertPipelineDto): Promise<PipelineConfig> {
    return this.pipelineConfigService.savePipeline(dto);
  }

  @Put(":id")
  public async update(
    @Param("id") id: string,
    @Body() dto: UpsertPipelineDto,
  ): Promise<PipelineConfig> {
    return this.pipelineConfigService.savePipeline({ ...dto, id });
  }

  @Post(":id/enable")
  public async enable(@Param("id") id: string): Promise<PipelineConfig> {
    return this.pipelineConfigService.setEnabled(id, true);
  }

  @Post(":id/disable")
  public async disable(@Param("id") id: string): Promise<PipelineConfig> {
    return this.pipelineConfigService.setEnabled(id, false);
  }

  @Delete(":id")
  public async delete(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.pipelineConfigService.deletePipeline(id);
    return { deleted: true };
  }
}
