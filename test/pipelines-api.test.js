import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(NatsJetstreamService)
    .useValue({
      publish: async () => undefined,
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

  return app;
}

test("pipeline configuration API creates, updates, enables and deletes pipelines", async () => {
  const conf = await createTestConf({
    globalConfig: {
      defaults: {
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.normalized" },
      },
    },
    pipelines: [],
  });

  const app = await createAppWithConf(conf);

  try {
    const createPayload = {
      id: "nginx-access",
      source: "nginx-access",
      enabled: true,
      parser: {
        type: "regex",
        pattern: "^(?<message>.*)$",
      },
      publish: {
        subject: "logs.nginx.normalized",
      },
      security: {
        mode: "header",
        token: "ingest-token",
      },
    };

    const created = await request(app.getHttpServer())
      .post("/pipelines")
      .send(createPayload)
      .expect(201);

    assert.equal(created.body.id, "nginx-access");
    assert.equal(created.body.publish.subject, "logs.nginx.normalized");

    const listed = await request(app.getHttpServer())
      .get("/pipelines")
      .expect(200);

    assert.equal(listed.body.length, 1);
    assert.equal(listed.body[0].id, "nginx-access");

    const disabled = await request(app.getHttpServer())
      .post("/pipelines/nginx-access/disable")
      .expect(201);

    assert.equal(disabled.body.enabled, false);

    const enabled = await request(app.getHttpServer())
      .post("/pipelines/nginx-access/enable")
      .expect(201);

    assert.equal(enabled.body.enabled, true);

    await request(app.getHttpServer())
      .put("/pipelines/config")
      .send({
        defaults: {
          publish: { subject: "logs.default" },
          security: { mode: "none" },
        },
      })
      .expect(200);

    const globalConfigContent = JSON.parse(
      await readFile(conf.confFile, "utf8"),
    );
    assert.equal(globalConfigContent.defaults.publish.subject, "logs.default");

    const deleted = await request(app.getHttpServer())
      .delete("/pipelines/nginx-access")
      .expect(200);

    assert.equal(deleted.body.deleted, true);

    const listedAfterDelete = await request(app.getHttpServer())
      .get("/pipelines")
      .expect(200);

    assert.equal(listedAfterDelete.body.length, 0);
  } finally {
    await app.close();
    await conf.cleanup();
  }
});
