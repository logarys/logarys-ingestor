import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { timingSafeEqual } from "node:crypto";
import type { Request } from "express";

@Injectable()
export class IngestorApiTokenGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedToken = process.env.INGESTOR_API_TOKEN ?? process.env.API_TOKEN;

    if (!expectedToken) {
      throw new UnauthorizedException("INGESTOR_API_TOKEN is not configured");
    }

    const authorization = request.headers.authorization;

    if (!authorization) {
      throw new UnauthorizedException("Missing Authorization header");
    }

    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      throw new UnauthorizedException("Invalid Authorization header");
    }

    if (!this.tokenEquals(token, expectedToken)) {
      throw new UnauthorizedException("Invalid API token");
    }

    return true;
  }

  private tokenEquals(receivedToken: string, expectedToken: string): boolean {
    const received = Buffer.from(receivedToken);
    const expected = Buffer.from(expectedToken);

    if (received.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(received, expected);
  }
}
