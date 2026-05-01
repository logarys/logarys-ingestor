import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import axios from "axios";
import { Test } from "@nestjs/testing";
import { ValidationPipe } from "@nestjs/common";
import { AppModule } from "../dist/app.module.js";
import { NatsJetstreamService } from "../dist/broker/services/nats-jetstream.service.js";
import { createTestConf } from "./helpers.js";

const INGESTOR_TOKEN = "functional-test-token";
const STORAGE_MANAGER_TOKEN = "functional-test-token";
const STORAGE_MANAGER_URL =
  process.env.REAL_STORAGE_MANAGER_URL ?? "http://127.0.0.1:3001";

async function createAppWithConf(conf) {
  process.env.CONF_FILE = conf.confFile;
  process.env.CONF_PIPELINES_DIR = conf.pipelinesDir;
  process.env.APP_HOST = "127.0.0.1";
  process.env.APP_PORT = "0";
  process.env.NATS_URL = "nats://unused:4222";
  process.env.NATS_CLIENT_NAME = "test-client";
  process.env.NATS_TIMEOUT_MS = "5000";
  process.env.JETSTREAM_PUBLISH_TIMEOUT_MS = "5000";
  process.env.INGESTOR_API_TOKEN = INGESTOR_TOKEN;
  process.env.STORAGE_MANAGER_URL = STORAGE_MANAGER_URL;
  process.env.STORAGE_MANAGER_API_TOKEN = STORAGE_MANAGER_TOKEN;
  delete process.env.CONSOLE_URL;

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

function ingestorAuth(requestBuilder) {
  return requestBuilder.set("Authorization", `Bearer ${INGESTOR_TOKEN}`);
}

function storageAuthHeaders() {
  return {
    Authorization: `Bearer ${STORAGE_MANAGER_TOKEN}`,
  };
}

async function listStorageManagerPipelines() {
  const response = await axios.get(`${STORAGE_MANAGER_URL}/pipelines`, {
    headers: storageAuthHeaders(),
  });

  assert.ok(Array.isArray(response.data), "storage-manager should return an array of pipelines");

  return response.data;
}

async function getStorageManagerPipeline(id) {
  const response = await axios.get(
    `${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(id)}`,
    { headers: storageAuthHeaders() },
  );

  return response.data;
}

async function deleteStorageManagerPipeline(id) {
  try {
    await axios.delete(`${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(id)}`, {
      headers: storageAuthHeaders(),
    });
  } catch (error) {
    if (error?.response?.status !== 404) {
      throw error;
    }
  }
}

async function assertStorageManagerHasPipeline(id, expected) {
  const pipeline = await getStorageManagerPipeline(id);

  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(pipeline[key], value);
  }

  return pipeline;
}

test("pipeline configuration API is protected by the ingestor API token", async () => {
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
    await request(app.getHttpServer()).get("/pipelines").expect(401);

    await request(app.getHttpServer())
      .post("/pipelines")
      .set("Authorization", "Bearer wrong-token")
      .send({
        id: "unauthorized-pipeline",
        source: "unauthorized-pipeline",
        enabled: true,
        parser: { type: "raw" },
        publish: { subject: "logs.unauthorized" },
        security: { mode: "none" },
      })
      .expect(401);
  } finally {
    await app.close();
    await conf.cleanup();
  }
});

test("pipeline configuration API creates, updates, toggles and deletes pipelines through storage-manager", async () => {
  const id = `ingestor-crud-${Date.now()}`;
  const source = id;

  await deleteStorageManagerPipeline(id);

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
      id,
      source,
      enabled: true,
      parser: {
        type: "regex",
        pattern: "^(?<message>.*)$",
      },
      publish: {
        subject: "logs.ingestor-crud.created",
      },
      security: {
        mode: "header",
        token: "ingest-token",
      },
      defaults: {
        service: "crud-service",
      },
    };

    const created = await ingestorAuth(request(app.getHttpServer()).post("/pipelines"))
      .send(createPayload)
      .expect(201);

    assert.equal(created.body.id, id);
    assert.equal(created.body.source, source);
    assert.equal(created.body.publish.subject, "logs.ingestor-crud.created");

    await assertStorageManagerHasPipeline(id, {
      id,
      source,
      enabled: true,
      publish: { subject: "logs.ingestor-crud.created" },
    });

    const listedFromIngestor = await ingestorAuth(request(app.getHttpServer()).get("/pipelines"))
      .expect(200);

    assert.ok(
      listedFromIngestor.body.some((pipeline) => pipeline.id === id),
      "ingestor should expose the storage-manager-backed pipeline in its cache",
    );

    const disabled = await ingestorAuth(
      request(app.getHttpServer()).post(`/pipelines/${encodeURIComponent(id)}/disable`),
    ).expect(201);

    assert.equal(disabled.body.enabled, false);
    await assertStorageManagerHasPipeline(id, { enabled: false });

    const enabled = await ingestorAuth(
      request(app.getHttpServer()).post(`/pipelines/${encodeURIComponent(id)}/enable`),
    ).expect(201);

    assert.equal(enabled.body.enabled, true);
    await assertStorageManagerHasPipeline(id, { enabled: true });

    const updatePayload = {
      ...createPayload,
      publish: {
        subject: "logs.ingestor-crud.updated",
      },
      defaults: {
        service: "crud-service-updated",
      },
    };

    const updated = await ingestorAuth(
      request(app.getHttpServer()).put(`/pipelines/${encodeURIComponent(id)}`),
    )
      .send(updatePayload)
      .expect(200);

    assert.equal(updated.body.publish.subject, "logs.ingestor-crud.updated");

    await assertStorageManagerHasPipeline(id, {
      publish: { subject: "logs.ingestor-crud.updated" },
      defaults: { service: "crud-service-updated" },
    });

    const storageManagerPipelines = await listStorageManagerPipelines();
    assert.ok(
      storageManagerPipelines.some((pipeline) => pipeline.id === id),
      "storage-manager should list the pipeline created through ingestor",
    );

    const deleted = await ingestorAuth(
      request(app.getHttpServer()).delete(`/pipelines/${encodeURIComponent(id)}`),
    ).expect(200);

    assert.equal(deleted.body.deleted, true);

    await assert.rejects(
      () => getStorageManagerPipeline(id),
      (error) => error?.response?.status === 404,
      "storage-manager should no longer expose the deleted pipeline",
    );
  } finally {
    await app.close();
    await deleteStorageManagerPipeline(id);
    await conf.cleanup();
  }
});
