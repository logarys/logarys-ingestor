import test from "node:test";
import assert from "node:assert/strict";
import { EngineFactoryService } from "../dist/ingest/services/engine-factory.service.js";
import { IngestService } from "../dist/ingest/services/ingest.service.js";

function lokiPipeline(overrides = {}) {
  const source = overrides.source ?? "locafire-prod-1-dockers";

  return {
    id: overrides.id ?? source,
    source,
    enabled: overrides.enabled ?? true,
    parser: {
      type: "loki",
      ...(overrides.parser ?? {}),
    },
    defaults: {
      source: "locafire-docker",
      host: "locafire-prod-1",
      service: "docker",
      env: "production",
      ...(overrides.defaults ?? {}),
    },
    publish: {
      subject: "logs.locafire-docker.normalized",
      ...(overrides.publish ?? {}),
    },
    security: {
      mode: "none",
      ...(overrides.security ?? {}),
    },
  };
}

function createEngine(pipeline = lokiPipeline()) {
  return new EngineFactoryService().create(pipeline);
}

test("loki parser normalizes Promtail output key-value lines", () => {
  const pipeline = lokiPipeline();
  const engine = createEngine(pipeline);

  const normalized = engine.normalize({
    raw: 'timestamp=2026-05-01T21:30:00Z level=info msg="Manual test" container=api-1 service=api stream=stdout',
    source: pipeline.defaults.source,
    host: pipeline.defaults.host,
    service: pipeline.defaults.service,
    env: pipeline.defaults.env,
    metadata: {
      job: "docker",
      project: "locafire",
    },
  });

  assert.equal(normalized.timestamp, "2026-05-01T21:30:00.000Z");
  assert.equal(normalized.level, "INFO");
  assert.equal(normalized.message, "Manual test");
  assert.equal(normalized.source, "locafire-docker");
  assert.equal(normalized.host, "locafire-prod-1");
  assert.equal(normalized.context.service, "api");
  assert.equal(normalized.context.env, "production");
  assert.equal(normalized.context.extra.container, "api-1");
  assert.equal(normalized.context.extra.stream, "stdout");
  assert.equal(normalized.context.extra.job, "docker");
  assert.equal(normalized.context.extra.project, "locafire");
});

test("loki parser uses Loki nanosecond timestamp when the line has no timestamp", () => {
  const pipeline = lokiPipeline();
  const engine = createEngine(pipeline);
  const lokiTimestampNs = "1777689335000000000";
  const expectedTimestamp = new Date(
    Number(BigInt(lokiTimestampNs) / 1_000_000n),
  ).toISOString();

  const normalized = engine.normalize({
    raw: 'level=error msg="From Loki timestamp" container=worker-1 service=worker stream=stderr',
    source: pipeline.defaults.source,
    host: pipeline.defaults.host,
    service: pipeline.defaults.service,
    env: pipeline.defaults.env,
    metadata: {
      lokiTimestampNs,
      job: "docker",
    },
  });

  assert.equal(normalized.timestamp, expectedTimestamp);
  assert.equal(normalized.level, "ERROR");
  assert.equal(normalized.message, "From Loki timestamp");
  assert.equal(normalized.context.service, "worker");
  assert.equal(normalized.context.extra.container, "worker-1");
  assert.equal(normalized.context.extra.stream, "stderr");
  assert.equal(normalized.context.extra.lokiTimestampNs, lokiTimestampNs);
});

test("ingest service expands a Loki push payload into multiple normalized publications", async () => {
  const pipeline = lokiPipeline();
  const published = [];

  const service = new IngestService(
    {
      getPipeline: (source) => (source === pipeline.source ? pipeline : undefined),
    },
    {
      validate: () => undefined,
    },
    new EngineFactoryService(),
    {
      publish: async (subject, payload, headers) => {
        published.push({ subject, payload, headers });
      },
    },
  );

  const firstTimestampNs = "1777689335000000000";
  const secondTimestampNs = "1777689336000000000";
  const secondExpectedTimestamp = new Date(
    Number(BigInt(secondTimestampNs) / 1_000_000n),
  ).toISOString();

  const result = await service.ingest(
    pipeline.source,
    {
      streams: [
        {
          stream: {
            source: "locafire-docker",
            host: "locafire-prod-1",
            service: "api",
            env: "production",
            job: "docker",
            container: "api-1",
          },
          values: [
            [
              firstTimestampNs,
              'timestamp=2026-05-01T21:30:00Z level=info msg="First log" container=api-1 service=api stream=stdout',
            ],
            [
              secondTimestampNs,
              'level=error msg="Second log" container=worker-1 service=worker stream=stderr',
            ],
          ],
        },
      ],
    },
    {},
  );

  assert.equal(result.accepted, true);
  assert.equal(result.pipelineId, pipeline.id);
  assert.equal(result.subject, pipeline.publish.subject);
  assert.equal(result.count, 2);
  assert.equal(result.normalizedLogs.length, 2);

  assert.equal(published.length, 2);
  assert.equal(published[0].subject, pipeline.publish.subject);
  assert.equal(published[0].payload.pipelineId, pipeline.id);
  assert.equal(published[0].payload.source, pipeline.source);
  assert.equal(published[0].payload.normalizedLog.level, "INFO");
  assert.equal(published[0].payload.normalizedLog.message, "First log");
  assert.equal(published[0].headers["x-log-level"], "INFO");

  assert.equal(published[1].payload.normalizedLog.timestamp, secondExpectedTimestamp);
  assert.equal(published[1].payload.normalizedLog.level, "ERROR");
  assert.equal(published[1].payload.normalizedLog.message, "Second log");
  assert.equal(published[1].payload.normalizedLog.context.service, "worker");
  assert.equal(published[1].payload.normalizedLog.context.extra.container, "worker-1");
  assert.equal(published[1].headers["x-log-level"], "ERROR");
});
