import http from "node:http";

export async function startConsoleApiStub(initialPipelines = []) {
  let pipelines = [...initialPipelines];
  const importCalls = [];

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const chunks = [];

    req.on("data", (chunk) => chunks.push(chunk));

    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : null;

      if (req.method === "GET" && url.pathname === "/pipelines") {
        return json(res, 200, pipelines);
      }

      if (req.method === "POST" && url.pathname === "/pipelines") {
        importCalls.push(body);
        pipelines = [...pipelines.filter((pipeline) => pipeline.id !== body.id), body];
        return json(res, 201, body);
      }

      if (req.method === "PUT" && url.pathname.startsWith("/pipelines/")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-1));
        const next = { ...body, id };
        pipelines = [...pipelines.filter((pipeline) => pipeline.id !== id), next];
        return json(res, 200, next);
      }

      if (req.method === "POST" && url.pathname.endsWith("/enable")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-2));
        const current = pipelines.find((pipeline) => pipeline.id === id);
        const next = { ...current, enabled: true };
        pipelines = [...pipelines.filter((pipeline) => pipeline.id !== id), next];
        return json(res, 201, next);
      }

      if (req.method === "POST" && url.pathname.endsWith("/disable")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-2));
        const current = pipelines.find((pipeline) => pipeline.id === id);
        const next = { ...current, enabled: false };
        pipelines = [...pipelines.filter((pipeline) => pipeline.id !== id), next];
        return json(res, 201, next);
      }

      if (req.method === "DELETE" && url.pathname.startsWith("/pipelines/")) {
        const id = decodeURIComponent(url.pathname.split("/").at(-1));
        pipelines = pipelines.filter((pipeline) => pipeline.id !== id);
        return json(res, 200, { deleted: true });
      }

      return json(res, 404, {
        message: "Pipeline API stub route not found",
        method: req.method,
        path: url.pathname,
      });
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    getPipelines: () => pipelines,
    getImportCalls: () => importCalls,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
