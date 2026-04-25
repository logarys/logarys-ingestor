import { IsObject, IsOptional, IsString } from "class-validator";

export class IngestLogDto {
  @IsString()
  raw!: string;

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
