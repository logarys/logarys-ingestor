import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanupPipelineViaStorage,
  INGESTOR_URL,
  ingestorHeaders,
  requestJson,
} from "./helpers.js";

test("pipeline configuration API is protected by the ingestor API token", async () => {
  const response = await requestJson(`${INGESTOR_URL}/pipelines`);

  assert.equal(response.status, 401, response.text);
  assert.match(response.body.message, /Missing Authorization header/);
});

test("pipeline configuration API creates, updates, toggles and deletes pipelines through storage-manager", async () => {
  const pipelineId = `api-source-${Date.now()}`;

  const pipeline = {
    id: pipelineId,
    source: pipelineId,
    enabled: true,
    parser: {
      type: "raw",
    },
    defaults: {
      source: pipelineId,
    },
    publish: {
      subject: `logs.${pipelineId}.normalized`,
    },
    security: {
      mode: "none",
    },
  };

  try {
    const createResponse = await requestJson(`${INGESTOR_URL}/pipelines`, {
      method: "POST",
      headers: ingestorHeaders(),
      body: pipeline,
    });

    assert.ok([200, 201].includes(createResponse.status), JSON.stringify(createResponse.body));

    const updateResponse = await requestJson(`${INGESTOR_URL}/pipelines/${encodeURIComponent(pipelineId)}`, {
      method: "PUT",
      headers: ingestorHeaders(),
      body: {
        ...pipeline,
        defaults: {
          source: pipelineId,
          host: "updated-host",
        },
      },
    });

    assert.ok([200, 201].includes(updateResponse.status), JSON.stringify(updateResponse.body));

    const disableResponse = await requestJson(`${INGESTOR_URL}/pipelines/${encodeURIComponent(pipelineId)}/disable`, {
      method: "POST",
      headers: ingestorHeaders(),
      body: {},
    });

    assert.ok([200, 201].includes(disableResponse.status), JSON.stringify(disableResponse.body));

    const enableResponse = await requestJson(`${INGESTOR_URL}/pipelines/${encodeURIComponent(pipelineId)}/enable`, {
      method: "POST",
      headers: ingestorHeaders(),
      body: {},
    });

    assert.ok([200, 201].includes(enableResponse.status), JSON.stringify(enableResponse.body));

    const deleteResponse = await requestJson(`${INGESTOR_URL}/pipelines/${encodeURIComponent(pipelineId)}`, {
      method: "DELETE",
      headers: ingestorHeaders(),
    });

    assert.ok([200, 204, 404].includes(deleteResponse.status), JSON.stringify(deleteResponse.body));
  } finally {
    await cleanupPipelineViaStorage(pipelineId);
  }
});
