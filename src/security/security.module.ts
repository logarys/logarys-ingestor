import { Module } from "@nestjs/common";
import { IngestorApiTokenGuard } from "./ingestor-api-token.guard.js";

@Module({
  providers: [IngestorApiTokenGuard],
  exports: [IngestorApiTokenGuard],
})
export class SecurityModule {}
