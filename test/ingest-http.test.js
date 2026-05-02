import test from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineViaIngestor,
  rawPipeline,
  requestJson,
  uniqueSource,
  INGESTOR_URL,
  cleanupPipelineViaStorage,
  createPipelineViaStorage,
  waitForIngestorPipeline,
  jsonHeaders,
  waitFor,
} from "./helpers.js";

test("POST /ingest/:source normalizes and publishes one message through real NATS", async () => {
  const source = uniqueSource("ingest-ok");
  const pipeline = rawPipeline(source, {
     id: source,
     source,
     enabled: true,
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
    await cleanupPipelineViaStorage(pipeline.id);
  }
});

test("POST /ingest/:source rejects invalid pipeline token", async () => {
  const pipelineId = uniqueSource("secure-source");

  const pipeline = rawPipeline(pipelineId, {
    parser: { type: "raw" },
    defaults: {
      source: pipelineId,
    },
    publish: {
      subject: `logs.${pipelineId}.normalized`,
    },
    security: {
      mode: "query",
      token: "query-secret",
    },
  });

  try {
    await createPipelineViaIngestor(pipeline);

    const response = await requestJson(`${INGESTOR_URL}/ingest/${pipelineId}`, {
      method: "POST",
      body: {
        raw: "hello world",
      },
    });

    assert.equal(response.status, 403, response.text);
    assert.match(JSON.stringify(response.body), /token|forbidden|invalid/i);
  } finally {
    await cleanupPipelineViaStorage(pipelineId);
  }
});

test("POST /ingest/:source rejects disabled pipelines", async () => {
  const pipelineId = uniqueSource("disabled-source");

  const pipeline = rawPipeline(pipelineId, {
    enabled: false,
    parser: { type: "raw" },
    defaults: {
      source: pipelineId,
    },
    publish: {
      subject: `logs.${pipelineId}.normalized`,
    },
    security: {
      mode: "none",
    },
  });

  try {
    await createPipelineViaStorage(pipeline);

    const response = await waitFor(async () => {
      const current = await requestJson(`${INGESTOR_URL}/ingest/${pipelineId}`, {
        method: "POST",
        body: {
          raw: "hello world",
        },
      });

      if (current.status !== 409) {
        throw new Error(
          `Expected disabled pipeline conflict, got ${current.status}: ${current.text}`,
        );
      }

      return current;
    });

    assert.equal(response.status, 409);
    assert.match(JSON.stringify(response.body), /disabled/i);
  } finally {
    await cleanupPipelineViaStorage(pipelineId);
  }
});