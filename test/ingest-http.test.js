import test from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineViaIngestor,
  deletePipelineViaIngestor,
  rawPipeline,
  requestJson,
  uniqueSource,
  INGESTOR_URL,
} from "./helpers.js";

test("POST /ingest/:source normalizes and publishes one message through real NATS", async () => {
  const source = uniqueSource("ingest-ok");
  const pipeline = rawPipeline(source, {
    parser: {
      type: "regex",
      pattern:
        "^(?<timestamp>\\S+\\s+\\S+)\\s+\\[(?<level>[A-Z]+)\\]\\s+(?<message>.*)$",
    },
    defaults: {
      source,
      host: "app-01",
      service: "booking-api",
      env: "prod",
    },
    security: {
      mode: "header",
      token: "secret-token",
    },
  });

  try {
    await createPipelineViaIngestor(pipeline);

    const response = await requestJson(`${INGESTOR_URL}/ingest/${source}`, {
      method: "POST",
      headers: {
        "X-token": "secret-token",
      },
      body: {
        raw: "2026-04-23 10:15:30 [ERROR] Database connection failed",
        metadata: { requestId: "req-123" },
      },
    });

    assert.equal(response.status, 201, response.text);
    assert.equal(response.body.accepted, true);
    assert.equal(response.body.pipelineId, source);
    assert.equal(response.body.subject, `logs.${source}.normalized`);
    assert.equal(response.body.normalizedLog.level, "ERROR");
    assert.equal(response.body.normalizedLog.host, "app-01");
    assert.equal(response.body.normalizedLog.context.service, "booking-api");
    assert.equal(response.body.normalizedLog.message, "Database connection failed");
  } finally {
    await deletePipelineViaIngestor(source);
  }
});

test("POST /ingest/:source rejects invalid pipeline token", async () => {
  const source = uniqueSource("ingest-token");

  try {
    await createPipelineViaIngestor(
      rawPipeline(source, {
        security: {
          mode: "query",
          token: "query-secret",
        },
      }),
    );

    const response = await requestJson(`${INGESTOR_URL}/ingest/${source}`, {
      method: "POST",
      body: { raw: "hello world" },
    });

    assert.equal(response.status, 403, response.text);
    assert.match(response.body.message, /Invalid pipeline token/);
  } finally {
    await deletePipelineViaIngestor(source);
  }
});

test("POST /ingest/:source rejects disabled pipelines", async () => {
  const source = uniqueSource("ingest-disabled");

  try {
    await createPipelineViaIngestor(
      rawPipeline(source, {
        enabled: false,
      }),
    );

    const response = await requestJson(`${INGESTOR_URL}/ingest/${source}`, {
      method: "POST",
      body: { raw: "hello world" },
    });

    assert.equal(response.status, 409, response.text);
    assert.match(response.body.message, /disabled/i);
  } finally {
    await deletePipelineViaIngestor(source);
  }
});
