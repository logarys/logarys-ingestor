import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

export const INGESTOR_URL = process.env.INGESTOR_URL ?? "http://127.0.0.1:3000";
export const STORAGE_MANAGER_URL =
  process.env.REAL_STORAGE_MANAGER_URL ?? "http://127.0.0.1:3001";
export const INGESTOR_TOKEN = process.env.INGESTOR_API_TOKEN ?? "functional-test-token";
export const STORAGE_MANAGER_TOKEN =
  process.env.STORAGE_MANAGER_API_TOKEN ?? "functional-test-token";
export const TEST_CONF_DIR = process.env.TEST_CONF_DIR ?? ".test-runtime/conf";

export function uniqueSource(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function authHeaders(token = INGESTOR_TOKEN) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export async function requestJson(url, options = {}) {
  const headers = {
    ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...(options.headers ?? {}),
  };

  const response = await fetch(url, {
    ...options,
    headers,
    body:
      options.body === undefined || typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body),
  });

  const text = await response.text();
  let body = null;

  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    body,
    text,
  };
}

export async function waitFor(assertion, { timeoutMs = 10000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const timeoutError = new Error(
    `Timed out after ${timeoutMs}ms while waiting for condition: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
  timeoutError.cause = lastError;
  throw timeoutError;
}

export async function getIngestorPipelines() {
  const response = await requestJson(`${INGESTOR_URL}/pipelines`, {
    headers: authHeaders(),
  });
  assert.equal(response.status, 200, response.text);
  return Array.isArray(response.body) ? response.body : [];
}

export async function getStoragePipelines() {
  const response = await requestJson(`${STORAGE_MANAGER_URL}/pipelines`, {
    headers: authHeaders(STORAGE_MANAGER_TOKEN),
  });
  assert.equal(response.status, 200, response.text);

  if (Array.isArray(response.body)) return response.body;
  if (Array.isArray(response.body?.items)) return response.body.items;
  if (Array.isArray(response.body?.pipelines)) return response.body.pipelines;
  if (Array.isArray(response.body?.data)) return response.body.data;

  return [];
}

export async function findStoragePipeline(source) {
  const pipelines = await getStoragePipelines();
  return pipelines.find((pipeline) => pipeline.source === source);
}

export async function findIngestorPipeline(source) {
  const pipelines = await getIngestorPipelines();
  return pipelines.find((pipeline) => pipeline.source === source);
}

export async function createPipelineViaIngestor(pipeline) {
  const response = await requestJson(`${INGESTOR_URL}/pipelines`, {
    method: "POST",
    headers: authHeaders(),
    body: pipeline,
  });

  assert.equal(response.status, 201, response.text);
  return response.body;
}

export async function createPipelineViaStorage(pipeline) {
  const response = await requestJson(`${STORAGE_MANAGER_URL}/pipelines`, {
    method: "POST",
    headers: authHeaders(STORAGE_MANAGER_TOKEN),
    body: pipeline,
  });

  assert.ok([200, 201, 409].includes(response.status), response.text);

  if (response.status === 409) {
    const update = await requestJson(
      `${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(pipeline.id)}`,
      {
        method: "PUT",
        headers: authHeaders(STORAGE_MANAGER_TOKEN),
        body: pipeline,
      },
    );
    assert.ok([200, 201].includes(update.status), update.text);
    return update.body;
  }

  return response.body;
}

export async function updatePipelineViaStorage(id, pipeline) {
  const response = await requestJson(
    `${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      headers: authHeaders(STORAGE_MANAGER_TOKEN),
      body: { ...pipeline, id },
    },
  );

  assert.ok([200, 201].includes(response.status), response.text);
  return response.body;
}

export async function deletePipelineViaStorage(id) {
  const response = await requestJson(
    `${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: authHeaders(STORAGE_MANAGER_TOKEN),
    },
  );

  assert.ok([200, 204, 404].includes(response.status), response.text);
}

export async function deletePipelineViaIngestor(id) {
  const response = await requestJson(
    `${INGESTOR_URL}/pipelines/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: authHeaders(),
    },
  );

  assert.ok([200, 204, 404].includes(response.status), response.text);
}

export async function deleteAllPipelinesViaStorage() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const pipelines = await getStoragePipelines();

    if (pipelines.length === 0) {
      return;
    }

    for (const pipeline of pipelines) {
      const ids = [pipeline.id, pipeline.source, pipeline._id]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);

      for (const id of ids) {
        await deletePipelineViaStorage(id);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

export function rawPipeline(source, extra = {}) {
  return {
    id: source,
    source,
    enabled: true,
    parser: { type: "raw" },
    defaults: {
      source,
      host: "test-host",
      service: "test-service",
      env: "test",
    },
    publish: { subject: `logs.${source}.normalized` },
    security: { mode: "none" },
    ...extra,
  };
}

export async function expectPipelineConfigFile(source) {
  const file = join(TEST_CONF_DIR, "pipelines.d", `${source}.json`);
  await access(file);
  const content = await readFile(file, "utf8");
  return JSON.parse(content);
}

export async function waitForPipelineConfigFile(source, options) {
  return waitFor(() => expectPipelineConfigFile(source), options);
}
