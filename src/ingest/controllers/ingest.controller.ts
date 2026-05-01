import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { IngestLogDto } from "../dto/ingest-log.dto.js";
import { IngestResult, IngestService } from "../services/ingest.service.js";

@Controller("ingest")
export class IngestController {
  public constructor(private readonly ingestService: IngestService) {}

  @Post(":source")
  public ingest(
    @Param("source") source: string,
    @Body() dto: IngestLogDto,
    @Req() request: Request,
  ): Promise<IngestResult> {
    return this.ingestService.ingest(source, dto, request);
  }
}
