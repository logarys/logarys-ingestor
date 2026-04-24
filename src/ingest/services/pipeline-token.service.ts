import { ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import type { PipelineConfig } from '../../pipelines/domain/pipeline-config.type.js';

@Injectable()
export class PipelineTokenService {
  public validate(request: Request, pipeline: PipelineConfig): void {
    const security = pipeline.security ?? { mode: 'none' };

    if (security.mode === 'none') {
      return;
    }

    const expectedToken = security.token;
    if (!expectedToken) {
      throw new ForbiddenException('Pipeline token is not configured');
    }

    const receivedToken = security.mode === 'header'
      ? this.getHeaderToken(request)
      : this.getQueryToken(request);

    if (!receivedToken || receivedToken !== expectedToken) {
      throw new ForbiddenException('Invalid pipeline token');
    }
  }

  private getHeaderToken(request: Request): string | undefined {
    const value = request.headers['x-token'];
    return Array.isArray(value) ? value[0] : value;
  }

  private getQueryToken(req: Request): string | undefined {
    const token = req.query.token;
  
    if (typeof token === 'string') {
      return token;
    }
  
    return undefined;
  }
}
