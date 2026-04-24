import { Module } from '@nestjs/common';
import { PipelineConfigService } from './services/pipeline-config.service.js';
import { PipelineConfigController } from './controllers/pipeline-config.controller.js';

@Module({
  providers: [PipelineConfigService],
  controllers: [PipelineConfigController],
  exports: [PipelineConfigService],
})
export class PipelinesModule {}
