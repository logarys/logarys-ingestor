import test from "node:test";
import assert from "node:assert/strict";
import { PipelineService } from "../dist/pipelines/services/pipeline.service.js";
import { validatePipelineConfig } from "@logarys/pipeline-validator";

const SUPPORTED_PARSER_TYPES = ["raw", "json", "regex", "loki"];

function pipelineForParserType(parserType, index = 0, overrides = {}) {
  const source = `validator-${parserType}-${index}`;
  const parser = {
    type: parserType,
    ...(parserType === "regex"
      ? {
          pattern:
            "^(?<timestamp>[^ ]+) (?<level>[^ ]+) (?<message>.*)$",
        }
      : {}),
    ...(overrides.parser ?? {}),
  };

  return {
    id: source,
    source,
    enabled: true,
    parser,
    mapping: {
      timestamp: "timestamp",
      level: "level",
      message: "message",
      source: "source",
      host: "host",
      service: "service",
      env: "env",
      ...(overrides.mapping ?? {}),
    },
    defaults: {
      source,
      host: "validator-host",
      service: "validator-service",
      env: "test",
      ...(overrides.defaults ?? {}),
    },
    publish: {
      subject: `logs.${source}.normalized`,
      ...(overrides.publish ?? {}),
    },
    security: {
      mode: "none",
      ...(overrides.security ?? {}),
    },
    ...overrides,
    parser,
  };
}

function createPipelineService(capturedPosts) {
  const service = new PipelineService(
    {
      reload: async () => undefined,
      getAll: () => [],
      replacePipelines: async () => undefined,
      savePipeline: async (pipeline) => pipeline,
      setEnabled: async (id, enabled) => ({ id, source: id, enabled }),
      deletePipeline: async () => undefined,
      getGlobalConfig: () => ({ defaults: {} }),
      saveGlobalConfig: async (config) => config,
    },
    {
      axiosRef: {
        get: async () => ({ data: [] }),
        post: async (url, payload) => {
          capturedPosts.push({ url, payload });
          return { data: payload };
        },
        put: async (url, payload) => {
          capturedPosts.push({ url, payload });
          return { data: payload };
        },
        delete: async () => ({ data: undefined }),
      },
    },
  );

  service.logger = {
    log: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };

  return service;
}

test("@logarys/pipeline-validator accepts every ingestor parser type", async (t) => {
  for (const [index, parserType] of SUPPORTED_PARSER_TYPES.entries()) {
    await t.test(parserType, () => {
      const pipeline = pipelineForParserType(parserType, index);
      const result = validatePipelineConfig(pipeline, {
        document: true,
        requireDocumentFields: true,
      });

      assert.equal(
        result.valid,
        true,
        result.errors.map((error) => error.message).join(" | "),
      );
      assert.equal(result.value.parser.type, parserType);
    });
  }
});

test("ingestor validates every parser type with @logarys/pipeline-validator before storage-manager writes", async (t) => {
  const previousStorageManagerUrl = process.env.STORAGE_MANAGER_URL;
  process.env.STORAGE_MANAGER_URL = "http://storage-manager.test";

  try {
    for (const [index, parserType] of SUPPORTED_PARSER_TYPES.entries()) {
      await t.test(parserType, async () => {
        const capturedPosts = [];
        const service = createPipelineService(capturedPosts);
        const pipeline = pipelineForParserType(parserType, index);

        const created = await service.createPipeline(pipeline);

        assert.equal(created.parser.type, parserType);
        assert.equal(capturedPosts.length, 1);
        assert.equal(capturedPosts[0].url, "http://storage-manager.test/pipelines");
        assert.equal(capturedPosts[0].payload.parser.type, parserType);
        assert.deepEqual(capturedPosts[0].payload.mapping, pipeline.mapping);
      });
    }
  } finally {
    if (previousStorageManagerUrl === undefined) {
      delete process.env.STORAGE_MANAGER_URL;
    } else {
      process.env.STORAGE_MANAGER_URL = previousStorageManagerUrl;
    }
  }
});

test("ingestor rejects unsupported parser types before calling storage-manager", async () => {
  const previousStorageManagerUrl = process.env.STORAGE_MANAGER_URL;
  process.env.STORAGE_MANAGER_URL = "http://storage-manager.test";
  const capturedPosts = [];
  const service = createPipelineService(capturedPosts);

  try {
    await assert.rejects(
      () =>
        service.createPipeline(
          pipelineForParserType("yaml", 0, {
            id: "validator-unsupported",
            source: "validator-unsupported",
            defaults: { source: "validator-unsupported" },
            publish: { subject: "logs.validator-unsupported.normalized" },
          }),
        ),
      /Unsupported parser type: yaml/,
    );

    assert.equal(capturedPosts.length, 0);
  } finally {
    if (previousStorageManagerUrl === undefined) {
      delete process.env.STORAGE_MANAGER_URL;
    } else {
      process.env.STORAGE_MANAGER_URL = previousStorageManagerUrl;
    }
  }
});
