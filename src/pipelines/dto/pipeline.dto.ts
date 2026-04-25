import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

class ParserDto {
  @IsString()
  @IsIn(["raw", "json", "regex"])
  type!: "raw" | "json" | "regex";

  @IsOptional()
  @IsString()
  pattern?: string;
}

class MappingDto {
  @IsOptional() @IsString() timestamp?: string;
  @IsOptional() @IsString() level?: string;
  @IsOptional() @IsString() message?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() env?: string;
}

class DefaultsDto {
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() host?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() env?: string;
}

class PublishDto {
  @IsString()
  @IsNotEmpty()
  subject!: string;
}

class SecurityDto {
  @IsString()
  @IsIn(["none", "header", "query"])
  mode!: "none" | "header" | "query";

  @IsOptional()
  @IsString()
  token?: string;
}

export class UpsertPipelineDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsString()
  @IsNotEmpty()
  source!: string;

  @IsBoolean()
  enabled!: boolean;

  @ValidateNested()
  @Type(() => ParserDto)
  parser!: ParserDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => MappingDto)
  mapping?: MappingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => DefaultsDto)
  defaults?: DefaultsDto;

  @ValidateNested()
  @Type(() => PublishDto)
  publish!: PublishDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SecurityDto)
  security?: SecurityDto;
}

export class UpdateGlobalConfigDto {
  @IsObject()
  defaults!: Record<string, unknown>;
}
