import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import axios from "axios";
import { PipelineService } from "../dist/pipelines/services/pipeline.service.js";

const execFile = promisify(execFileCallback);

function createLocalConfigService(pipelines) {
  return {
    async reload() {},
    getAll() {
      return pipelines;
    },
  };
}

function createHttpService() {
  return {
    axiosRef: axios,
  };
}

function extractPipelines(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    if (Array.isArray(payload.pipelines)) return payload.pipelines;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.data)) return payload.data;
  }

  return [];
}

function jsString(value) {
  return JSON.stringify(value);
}

async function mongoEval(script) {
  const { stdout } = await execFile("docker", [
    "compose",
    "exec",
    "-T",
    "mongodb",
    "mongosh",
    "--quiet",
    "--eval",
    script,
  ]);

  return stdout.trim();
}

async function deletePipelineFromEveryCollection(source) {
  await mongoEval(`
    const database = db.getSiblingDB("logarys");
    for (const collectionName of database.getCollectionNames()) {
      database.getCollection(collectionName).deleteMany({ source: ${jsString(source)} });
    }
  `);
}

async function findPipelineInDb(source) {
  const result = await mongoEval(`
    const database = db.getSiblingDB("logarys");
    let result = null;

    for (const collectionName of database.getCollectionNames()) {
      const pipeline = database.getCollection(collectionName).findOne({ source: ${jsString(source)} });

      if (pipeline) {
        result = {
          collection: collectionName,
          source: pipeline.source,
          id: pipeline.id ?? pipeline._id?.toString?.(),
        };
        break;
      }
    }

    print(JSON.stringify(result));
  `);

  return result ? JSON.parse(result) : null;
}

test("PipelineService bootstraps local file pipelines into the real storage-manager MongoDB", async () => {
  const storageManagerUrl = process.env.REAL_STORAGE_MANAGER_URL ?? "http://127.0.0.1:3001";
  const token = process.env.STORAGE_MANAGER_API_TOKEN ?? "functional-test-token";
  const source = `bootstrap-db-test-${Date.now()}`;
  const localPipelines = [
    {
      id: source,
      source,
      enabled: true,
      parser: { type: "raw" },
      publish: { subject: "logs.bootstrap-db-test" },
      security: { mode: "none" },
      defaults: {
        service: "bootstrap-db-test",
      },
    },
  ];

  await deletePipelineFromEveryCollection(source);

  try {
    delete process.env.CONSOLE_URL;
    process.env.STORAGE_MANAGER_URL = storageManagerUrl;
    process.env.STORAGE_MANAGER_API_TOKEN = token;

    const service = new PipelineService(
      createLocalConfigService(localPipelines),
      createHttpService(),
    );

    await service.initFromFileOrRemote();

    const response = await axios.get(`${storageManagerUrl}/pipelines`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const remotePipelines = extractPipelines(response.data);

    assert.ok(
      remotePipelines.some((pipeline) => pipeline.source === source),
      "storage-manager API should return the bootstrapped pipeline",
    );

    const dbPipeline = await findPipelineInDb(source);

    assert.ok(dbPipeline, "MongoDB should contain the bootstrapped pipeline");
    assert.equal(dbPipeline.source, source);
  } finally {
    await deletePipelineFromEveryCollection(source);
  }
});
