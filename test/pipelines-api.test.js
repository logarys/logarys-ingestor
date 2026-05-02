import test from "node:test";
import assert from "node:assert/strict";
import {
  authHeaders,
  createPipelineViaIngestor,
  deletePipelineViaIngestor,
  findStoragePipeline,
  INGESTOR_URL,
  rawPipeline,
  requestJson,
  uniqueSource,
  waitFor,
} from "./helpers.js";

test("pipeline configuration API is protected by the ingestor API token", async () => {
  const response = await requestJson(`${INGESTOR_URL}/pipelines`);

  assert.equal(response.status, 401, response.text);
  assert.match(response.body.message, /Missing Authorization header/);
});

test("pipeline configuration API creates, updates, toggles and deletes pipelines through storage-manager", async () => {
  const source = uniqueSource("crud");

  try {
    await createPipelineViaIngestor(rawPipeline(source));

    await waitFor(async () => {
      const pipeline = await findStoragePipeline(source);
      assert.ok(pipeline, "storage-manager should contain created pipeline");
      assert.equal(pipeline.enabled, true);
    });

    const updateResponse = await requestJson(
      `${INGESTOR_URL}/pipelines/${encodeURIComponent(source)}`,
      {
        method: "PUT",
        headers: authHeaders(),
        body: rawPipeline(source, {
          publish: { subject: `logs.${source}.updated` },
        }),
      },
    );
    assert.ok([200, 201].includes(updateResponse.status), updateResponse.text);

    await waitFor(async () => {
      const pipeline = await findStoragePipeline(source);
      assert.equal(pipeline?.publish?.subject, `logs.${source}.updated`);
    });

    const disableResponse = await requestJson(
      `${INGESTOR_URL}/pipelines/${encodeURIComponent(source)}/disable`,
      {
        method: "POST",
        headers: authHeaders(),
        body: {},
      },
    );
    assert.ok([200, 201].includes(disableResponse.status), disableResponse.text);

    await waitFor(async () => {
      const pipeline = await findStoragePipeline(source);
      assert.equal(pipeline?.enabled, false);
    });

    const enableResponse = await requestJson(
      `${INGESTOR_URL}/pipelines/${encodeURIComponent(source)}/enable`,
      {
        method: "POST",
        headers: authHeaders(),
        body: {},
      },
    );
    assert.ok([200, 201].includes(enableResponse.status), enableResponse.text);

    await waitFor(async () => {
      const pipeline = await findStoragePipeline(source);
      assert.equal(pipeline?.enabled, true);
    });
  } finally {
    await deletePipelineViaIngestor(source);
  }

  await waitFor(async () => {
    const pipeline = await findStoragePipeline(source);
    assert.equal(pipeline, undefined);
  });
});
