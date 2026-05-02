import { IsArray, IsObject, IsOptional, IsString } from "class-validator";

export interface LokiPushStream {
  stream?: Record<string, string>;
  values?: Array<[string, string]>;
}

export class IngestLogDto {
  @IsOptional()
  @IsString()
  raw?: string;

  @IsOptional()
  @IsArray()
  streams?: LokiPushStream[];

  @IsOptional()
  @IsString()
  host?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  service?: string;

  @IsOptional()
  @IsString()
  env?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
