export type PipelineSecurityMode = 'none' | 'header' | 'query';
export type ParserType = 'raw' | 'json' | 'regex';

export interface PipelineConfig {
  id: string;
  source: string;
  enabled: boolean;
  parser: {
    type: ParserType;
    pattern?: string;
  };
  mapping?: {
    timestamp?: string;
    level?: string;
    message?: string;
    source?: string;
    host?: string;
    service?: string;
    env?: string;
  };
  defaults?: {
    source?: string;
    host?: string;
    service?: string;
    env?: string;
  };
  publish: {
    subject: string;
  };
  security?: {
    mode: PipelineSecurityMode;
    token?: string;
  };
}

export interface GlobalPipelinesConfig {
  defaults: Partial<Omit<PipelineConfig, 'id' | 'source'>> & {
    defaults?: PipelineConfig['defaults'];
  };
}
