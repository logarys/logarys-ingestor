import test from "node:test";
import assert from "node:assert/strict";
import { Logger } from "@nestjs/common";
import { PipelineService } from "../dist/pipelines/services/pipeline.service.js";

function createLocalConfigService(pipelines) {
  let reloadCalls = 0;

  return {
    async reload() {
      reloadCalls++;
    },
    getAll() {
      return pipelines;
    },
    async savePipeline(pipeline) {
      pipelines = [...pipelines.filter((item) => item.id !== pipeline.id), pipeline];
      return pipeline;
    },
    async setEnabled(id, enabled) {
      const pipeline = pipelines.find((item) => item.id === id);
      const next = { ...pipeline, enabled };
      pipelines = [...pipelines.filter((item) => item.id !== id), next];
      return next;
    },
    async deletePipeline(id) {
      pipelines = pipelines.filter((item) => item.id !== id);
    },
    getGlobalConfig() {
      return { defaults: {} };
    },
    async saveGlobalConfig(config) {
      return config;
    },
    get reloadCalls() {
      return reloadCalls;
    },
  };
}

function createHttpService({ remotePipelines = [], failImport = false } = {}) {
  const posts = [];
  const puts = [];
  const deletes = [];
  let remote = remotePipelines;

  return {
    posts,
    puts,
    deletes,
    setRemotePipelines(pipelines) {
      remote = pipelines;
    },
    axiosRef: {
      async get(url, options) {
        assert.equal(url, "http://storage.test/pipelines");
        assert.equal(options.headers.Authorization, "Bearer storage-token");
        return { data: remote };
      },
      async post(url, body, options) {
        posts.push({ url, body, headers: options.headers });
        assert.equal(options.headers.Authorization, "Bearer storage-token");

        if (failImport) {
          throw new Error("import failed");
        }

        if (url.endsWith("/enable") || url.endsWith("/disable")) {
          const id = decodeURIComponent(url.split("/").at(-2));
          const enabled = url.endsWith("/enable");
          const current = remote.find((item) => item.id === id) ?? { id, source: id };
          const updated = { ...current, enabled };
          remote = [...remote.filter((item) => item.id !== id), updated];
          return { status: 201, data: updated };
        }

        remote = [...remote.filter((item) => item.id !== body.id), body];
        return { status: 201, data: body };
      },
      async put(url, body, options) {
        puts.push({ url, body, headers: options.headers });
        assert.equal(options.headers.Authorization, "Bearer storage-token");
        remote = [...remote.filter((item) => item.id !== body.id), body];
        return { status: 200, data: body };
      },
      async delete(url, options) {
        deletes.push({ url, headers: options.headers });
        assert.equal(options.headers.Authorization, "Bearer storage-token");
        const id = decodeURIComponent(url.split("/").at(-1));
        remote = remote.filter((item) => item.id !== id);
        return { status: 200, data: { deleted: true } };
      },
    },
  };
}

function resetEnv() {
  delete process.env.CONSOLE_URL;
  process.env.STORAGE_MANAGER_URL = "http://storage.test";
  process.env.STORAGE_MANAGER_API_TOKEN = "storage-token";
}

test("PipelineService imports local pipelines when storage-manager has no pipelines", async () => {
  resetEnv();

  const localPipelines = [
    {
      id: "php-app",
      source: "php-app",
      enabled: true,
      parser: { type: "raw" },
      publish: { subject: "logs.php" },
      security: { mode: "none" },
    },
  ];

  const localConfig = createLocalConfigService(localPipelines);
  const http = createHttpService({ remotePipelines: [] });
  const service = new PipelineService(localConfig, http);

  await service.initFromFileOrRemote();

  assert.equal(localConfig.reloadCalls, 1);
  assert.equal(http.posts.length, 1);
  assert.deepEqual(http.posts[0].body, localPipelines[0]);
  assert.equal(http.posts[0].url, "http://storage.test/pipelines");
  assert.equal(service.getPipeline("php-app")?.id, "php-app");
});

test("PipelineService imports only local pipelines missing from storage-manager", async () => {
  resetEnv();

  const remotePipeline = {
    id: "remote-app",
    source: "remote-app",
    enabled: true,
    parser: { type: "raw" },
    publish: { subject: "logs.remote" },
    security: { mode: "none" },
  };

  const missingLocalPipeline = {
    id: "local-app",
    source: "local-app",
    enabled: true,
    parser: { type: "raw" },
    publish: { subject: "logs.local" },
    security: { mode: "none" },
  };

  const localConfig = createLocalConfigService([remotePipeline, missingLocalPipeline]);
  const http = createHttpService({ remotePipelines: [remotePipeline] });
  const service = new PipelineService(localConfig, http);

  await service.initFromFileOrRemote();

  assert.equal(http.posts.length, 1);
  assert.deepEqual(http.posts[0].body, missingLocalPipeline);
  assert.equal(service.getPipeline("remote-app")?.id, "remote-app");
  assert.equal(service.getPipeline("local-app")?.id, "local-app");
});

test("PipelineService keeps disabled pipelines in cache so ingestion can return disabled conflict", async () => {
  resetEnv();

  const disabledPipeline = {
    id: "disabled-pipeline",
    source: "disabled-pipeline",
    enabled: false,
    parser: { type: "raw" },
    publish: { subject: "logs.disabled" },
    security: { mode: "none" },
  };

  const localConfig = createLocalConfigService([]);
  const http = createHttpService({ remotePipelines: [disabledPipeline] });
  const service = new PipelineService(localConfig, http);

  await service.initFromFileOrRemote();

  assert.equal(service.getPipeline("disabled-pipeline")?.enabled, false);
});

test("PipelineService CRUD proxies mutations to storage-manager", async () => {
  resetEnv();

  const pipeline = {
    id: "crud-app",
    source: "crud-app",
    enabled: true,
    parser: { type: "raw" },
    publish: { subject: "logs.crud" },
    security: { mode: "none" },
  };

  const localConfig = createLocalConfigService([]);
  const http = createHttpService({ remotePipelines: [] });
  const service = new PipelineService(localConfig, http);

  await service.createPipeline(pipeline);
  assert.equal(http.posts[0].url, "http://storage.test/pipelines");

  await service.updatePipeline("crud-app", { ...pipeline, enabled: false });
  assert.equal(http.puts[0].url, "http://storage.test/pipelines/crud-app");

  await service.setEnabled("crud-app", true);
  assert.equal(http.posts.at(-1).url, "http://storage.test/pipelines/crud-app/enable");

  await service.deletePipeline("crud-app");
  assert.equal(http.deletes[0].url, "http://storage.test/pipelines/crud-app");
});

test("PipelineService fails when storage-manager import fails", async () => {
  resetEnv();

  const originalLoggerError = Logger.prototype.error;
  const loggedErrors = [];
  Logger.prototype.error = function error(message) {
    loggedErrors.push(String(message));
  };

  const localPipeline = {
    id: "local-app",
    source: "local-app",
    enabled: true,
    parser: { type: "raw" },
    publish: { subject: "logs.local" },
    security: { mode: "none" },
  };

  const localConfig = createLocalConfigService([localPipeline]);
  const http = createHttpService({ remotePipelines: [], failImport: true });
  const service = new PipelineService(localConfig, http);

  try {
    await assert.rejects(
      () => service.initFromFileOrRemote(),
      /Unable to import local pipeline configuration to storage-manager/,
    );
  } finally {
    Logger.prototype.error = originalLoggerError;
  }

  assert.equal(http.posts.length, 1);
  assert.match(loggedErrors.join("\n"), /Unable to import local pipeline configuration/);
  assert.equal(service.getPipeline("local-app"), undefined);
});
