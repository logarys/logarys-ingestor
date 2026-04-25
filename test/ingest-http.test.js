import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../dist/app.module.js";
import { NatsJetstreamService } from "../dist/broker/services/nats-jetstream.service.js";
import { createTestConf } from "./helpers.js";

async function createAppWithConf(conf) {
  process.env.CONF_FILE = conf.confFile;
  process.env.CONF_PIPELINES_DIR = conf.pipelinesDir;
  process.env.APP_HOST = "127.0.0.1";
  process.env.APP_PORT = "0";
  process.env.NATS_URL = "nats://unused:4222";
  process.env.NATS_CLIENT_NAME = "test-client";
  process.env.NATS_TIMEOUT_MS = "5000";
  process.env.JETSTREAM_PUBLISH_TIMEOUT_MS = "5000";

  const publishCalls = [];
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NatsJetstreamService)
    .useValue({
      publish: async (subject, payload, headers) => {
        publishCalls.push({ subject, payload, headers });
      },
    })
    .compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );
  await app.init();

  return { app, publishCalls };
}

test("POST /injest/:source normalizes and publishes one message", async () => {
  const conf = await createTestConf({
    globalConfig: {
      defaults: {
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.normalized" },
        security: { mode: "none" },
      },
    },
    pipelines: [
      {
        id: "php-app",
        source: "php-app",
        enabled: true,
        parser: {
          type: "regex",
          pattern:
            "^(?<timestamp>\\S+\\s+\\S+)\\s+\\[(?<level>[A-Z]+)\\]\\s+(?<message>.*)$",
        },
        defaults: {
          source: "php-app",
          host: "app-01",
          service: "booking-api",
          env: "prod",
        },
        publish: {
          subject: "logs.php.normalized",
        },
        security: {
          mode: "header",
          token: "secret-token",
        },
      },
    ],
  });

  const { app, publishCalls } = await createAppWithConf(conf);

  try {
    const response = await request(app.getHttpServer())
      .post("/injest/php-app")
      .set("X-token", "secret-token")
      .send({
        raw: "2026-04-23 10:15:30 [ERROR] Database connection failed",
        metadata: { requestId: "req-123" },
      })
      .expect(201);

    assert.equal(response.body.accepted, true);
    assert.equal(response.body.pipelineId, "php-app");
    assert.equal(response.body.subject, "logs.php.normalized");
    assert.equal(response.body.normalizedLog.level, "ERROR");
    assert.equal(response.body.normalizedLog.host, "app-01");
    assert.equal(response.body.normalizedLog.context.service, "booking-api");

    assert.equal(publishCalls.length, 1);
    assert.equal(publishCalls[0].subject, "logs.php.normalized");
    assert.equal(publishCalls[0].payload.pipelineId, "php-app");
    assert.equal(
      publishCalls[0].payload.normalizedLog.message,
      "Database connection failed",
    );
    assert.equal(publishCalls[0].headers["x-pipeline-id"], "php-app");
    assert.equal(publishCalls[0].headers["x-source"], "php-app");
    assert.equal(publishCalls[0].headers["x-log-level"], "ERROR");
  } finally {
    await app.close();
    await conf.cleanup();
  }
});

test("POST /injest/:source rejects invalid token", async () => {
  const conf = await createTestConf({
    globalConfig: {
      defaults: {
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.normalized" },
        security: { mode: "none" },
      },
    },
    pipelines: [
      {
        id: "secure-source",
        source: "secure-source",
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.secure" },
        security: { mode: "query", token: "query-secret" },
      },
    ],
  });

  const { app, publishCalls } = await createAppWithConf(conf);

  try {
    const response = await request(app.getHttpServer())
      .post("/injest/secure-source")
      .send({ raw: "hello world" })
      .expect(403);

    assert.match(response.body.message, /Invalid pipeline token/);
    assert.equal(publishCalls.length, 0);
  } finally {
    await app.close();
    await conf.cleanup();
  }
});

test("POST /injest/:source rejects disabled pipelines", async () => {
  const conf = await createTestConf({
    globalConfig: {
      defaults: {
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.normalized" },
      },
    },
    pipelines: [
      {
        id: "disabled-pipeline",
        source: "disabled-pipeline",
        enabled: false,
        parser: { type: "raw" },
        publish: { subject: "logs.disabled" },
      },
    ],
  });

  const { app, publishCalls } = await createAppWithConf(conf);

  try {
    const response = await request(app.getHttpServer())
      .post("/injest/disabled-pipeline")
      .send({ raw: "hello world" })
      .expect(409);

    assert.match(response.body.message, /disabled/);
    assert.equal(publishCalls.length, 0);
  } finally {
    await app.close();
    await conf.cleanup();
  }
});
