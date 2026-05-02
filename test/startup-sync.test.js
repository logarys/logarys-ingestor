import test from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineViaStorage,
  deleteAllPipelinesViaStorage,
  deletePipelineViaStorage,
  waitForPipelineConfigFile,
  findIngestorPipeline,
  findStoragePipeline,
  getIngestorPipelines,
  getStoragePipelines,
  rawPipeline,
  uniqueSource,
  waitFor,
} from "./helpers.js";

test("ingestor bootstraps local file pipelines into storage-manager when remote DB is empty", async () => {
  await waitFor(async () => {
    const pipeline = await findStoragePipeline("php-app");
    assert.ok(pipeline, "php-app should be imported from local files");
    assert.equal(pipeline.source, "php-app");
  });

  const cached = await findIngestorPipeline("php-app");
  assert.ok(cached, "ingestor cache should contain php-app");
});

test("ingestor refreshes cache and rewrites local files when storage-manager changes", async () => {
  const source = uniqueSource("remote-refresh");

  try {
    await createPipelineViaStorage(rawPipeline(source));

    await waitFor(async () => {
      const pipeline = await findIngestorPipeline(source);
      assert.ok(pipeline, "ingestor should refresh pipeline from storage-manager");
    });

    const filePipeline = await waitForPipelineConfigFile(source, { timeoutMs: 10000 });
    assert.equal(filePipeline.source, source);
  } finally {
    await deletePipelineViaStorage(source);
  }
});

test("ingestor does not re-import stale local files when storage-manager collection becomes empty", async () => {
  await deleteAllPipelinesViaStorage();

  await waitFor(async () => {
    await deleteAllPipelinesViaStorage();
    const storagePipelines = await getStoragePipelines();
    assert.equal(storagePipelines.length, 0);
  }, { timeoutMs: 15000 });

  await waitFor(async () => {
    const ingestorPipelines = await getIngestorPipelines();
    assert.equal(ingestorPipelines.length, 0);
  }, { timeoutMs: 15000 });

  await new Promise((resolve) => setTimeout(resolve, 1200));

  const storagePipelines = await getStoragePipelines();
  assert.equal(storagePipelines.length, 0, "local files must not be re-imported after remote deletion");
});
