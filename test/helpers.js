import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";

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

export async function expectPipelineConfigFile(source) {
  const file = join(TEST_CONF_DIR, "pipelines.d", `${source}.json`);
  await access(file);
  const content = await readFile(file, "utf8");
  return JSON.parse(content);
}

export async function waitForPipelineConfigFile(source, options) {
  return waitFor(() => expectPipelineConfigFile(source), options);
}

export const INGESTOR_URL =
  process.env.INGESTOR_URL ?? "http://127.0.0.1:3000";

export const STORAGE_MANAGER_URL =
  process.env.STORAGE_MANAGER_URL ?? "http://127.0.0.1:3001";

export const INGESTOR_API_TOKEN =
  process.env.INGESTOR_API_TOKEN ?? "functional-test-token";

export const STORAGE_MANAGER_API_TOKEN =
  process.env.STORAGE_MANAGER_API_TOKEN ?? "functional-test-token";

export function jsonHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    ...extra,
  };
}


export function storageHeaders(extra = {}) {
  return jsonHeaders({
    Authorization: `Bearer ${STORAGE_MANAGER_API_TOKEN}`,
    ...extra,
  });
}


export async function waitFor(assertion, options = {}) {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();

  let lastError;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError;
}

export async function getIngestorPipelines() {
  const response = await requestJson(`${INGESTOR_URL}/pipelines`, {
    method: "GET",
    headers: ingestorHeaders(),
  });

  if (response.status !== 200) {
    throw new Error(
      `Unable to get ingestor pipelines: ${response.status} ${JSON.stringify(
        response.body,
      )}`,
    );
  }

  return Array.isArray(response.body) ? response.body : response.body.items ?? [];
}

export async function waitForIngestorPipeline(sourceOrId) {
  return waitFor(async () => {
    const pipelines = await getIngestorPipelines();

    const pipeline = pipelines.find(
      (item) => item.id === sourceOrId || item.source === sourceOrId,
    );

    if (!pipeline) {
      throw new Error(`Pipeline ${sourceOrId} not found in ingestor cache`);
    }

    return pipeline;
  });
}

export async function createPipelineViaStorage(pipeline) {
  const response = await requestJson(`${STORAGE_MANAGER_URL}/pipelines`, {
    method: "POST",
    headers: storageHeaders(),
    body: pipeline,
  });

  if (![200, 201, 409].includes(response.status)) {
    throw new Error(
      `Unable to create pipeline via storage-manager: ${
        response.status
      } ${JSON.stringify(response.body)}`,
    );
  }

  return response.body;
}

export async function cleanupPipelineViaStorage(id) {
  if (!id) return;

  try {
    await requestJson(
      `${STORAGE_MANAGER_URL}/pipelines/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        headers: storageHeaders(),
      },
    );
  } catch {
    // Cleanup only.
  }
}

export function ingestorHeaders(extra = {}) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${INGESTOR_API_TOKEN}`,
    ...extra,
  };
}

export async function requestJson(url, options = {}) {
  const hasBody = options.body !== undefined;
  const body =
    hasBody && typeof options.body !== "string"
      ? JSON.stringify(options.body)
      : options.body;

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
    body,
  });

  const text = await response.text();

  let parsedBody = null;

  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
  }

  return {
    status: response.status,
    body: parsedBody,
    text,
    response,
  };
}

export function rawPipeline(source, overrides = {}) {
  const base = {
    id: source,
    source,
    enabled: true,
    parser: {
      type: "raw",
    },
    defaults: {
      source,
      host: "test-host",
      service: "test-service",
      env: "test",
    },
    publish: {
      subject: `logs.${source}.normalized`,
    },
    security: {
      mode: "none",
    },
  };

  return {
    ...base,
    ...overrides,
    parser: {
      ...base.parser,
      ...(overrides.parser ?? {}),
    },
    defaults: {
      ...base.defaults,
      ...(overrides.defaults ?? {}),
    },
    publish: {
      ...base.publish,
      ...(overrides.publish ?? {}),
    },
    security: {
      ...base.security,
      ...(overrides.security ?? {}),
    },
  };
}

export async function createPipelineViaIngestor(pipeline) {
  assert.equal(typeof pipeline.id, "string", "pipeline.id is required");
  assert.equal(typeof pipeline.source, "string", "pipeline.source is required");
  assert.equal(typeof pipeline.enabled, "boolean", "pipeline.enabled is required");

  const response = await requestJson(`${INGESTOR_URL}/pipelines`, {
    method: "POST",
    headers: ingestorHeaders(),
    body: pipeline,
  });

  assert.equal(
    response.status,
    201,
    `${JSON.stringify(response.body)}\nPayload was:\n${JSON.stringify(
      pipeline,
      null,
      2,
    )}`,
  );

  return response.body;
}