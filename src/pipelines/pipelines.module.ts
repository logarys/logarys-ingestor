import { Module } from "@nestjs/common";
import { PipelineConfigService } from "./services/pipeline-config.service.js";
import { PipelineConfigController } from "./controllers/pipeline-config.controller.js";
import { HttpModule } from "@nestjs/axios";
import { PipelineService } from "./services/pipeline.service.js";
import { SecurityModule } from "../security/security.module.js";

@Module({
  imports: [HttpModule, SecurityModule],
  providers: [PipelineConfigService, PipelineService],
  controllers: [PipelineConfigController],
  exports: [PipelineService],
})
export class PipelinesModule {}
