import http from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const host = process.env.CONSOLE_DEV_HOST ?? "0.0.0.0";
const port = Number(process.env.CONSOLE_DEV_PORT ?? 3000);
const dataFile = process.env.CONSOLE_DEV_DATA_FILE ?? "/data/pipelines.json";

function readPipelines() {
  if (!existsSync(dataFile)) {
    return [];
  }

  try {
    const content = readFileSync(dataFile, "utf8").trim();
    if (!content) {
      return [];
    }

    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[console-dev] failed to read pipelines", error);
    return [];
  }
}

function writePipelines(pipelines) {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(pipelines, null, 2));
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", reject);
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve(null);
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function normalizeImportBody(body) {
  if (Array.isArray(body)) {
    return body;
  }

  if (Array.isArray(body?.pipelines)) {
    return body.pipelines;
  }

  return [];
}

function upsertPipelines(current, incoming) {
  const bySource = new Map(current.map((pipeline) => [pipeline.source, pipeline]));

  for (const pipeline of incoming) {
    if (!pipeline?.source) {
      continue;
    }

    const existing = bySource.get(pipeline.source);

    bySource.set(pipeline.source, {
      ...existing,
      ...pipeline,
      updatedAt: new Date().toISOString(),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    });
  }

  return [...bySource.values()];
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

  try {
    console.log(`[console-dev] ${req.method} ${url.pathname}`);

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/healthz")) {
      sendJson(res, 200, { status: "ok" });
      return;
    }

    if (req.method === "GET" && (url.pathname === "/pipelines" || url.pathname === "/api/pipelines")) {
      sendJson(res, 200, readPipelines());
      return;
    }

    if (req.method === "POST" && (url.pathname === "/pipelines/import" || url.pathname === "/api/pipelines/import")) {
      const body = await readBody(req);
      const incoming = normalizeImportBody(body);
      const pipelines = upsertPipelines(readPipelines(), incoming);
      writePipelines(pipelines);

      sendJson(res, 201, {
        imported: incoming.length,
        total: pipelines.length,
      });
      return;
    }

    if (req.method === "DELETE" && (url.pathname === "/pipelines" || url.pathname === "/api/pipelines")) {
      writePipelines([]);
      sendJson(res, 200, { deleted: true });
      return;
    }

    sendJson(res, 404, {
      message: "Console dev route not found",
      method: req.method,
      path: url.pathname,
    });
  } catch (error) {
    console.error("[console-dev] request failed", error);
    sendJson(res, 500, {
      message: "Console dev request failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, host, () => {
  console.log(`[console-dev] listening on http://${host}:${port}`);
  console.log(`[console-dev] data file: ${dataFile}`);
});
