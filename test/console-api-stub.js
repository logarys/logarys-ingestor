import http from "node:http";

export async function startConsoleApiStub(initialPipelines = []) {
  let pipelines = [...initialPipelines];

  const json = (res, status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const chunks = [];

    req.on("data", chunk => chunks.push(chunk));

    req.on("end", () => {
      const url = new URL(req.url, "http://127.0.0.1");
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
        : null;

      console.log("[console-api-stub]", req.method, url.pathname);

      if (
        req.method === "GET" &&
        [
          "/pipelines",
          "/api/pipelines",
          "/config/pipelines",
          "/pipeline-configurations",
        ].includes(url.pathname)
      ) {
        return json(res, 200, pipelines);
      }

      if (
        req.method === "POST" &&
        [
          "/pipelines/import",
          "/api/pipelines/import",
          "/config/pipelines/import",
          "/pipeline-configurations/import",
        ].includes(url.pathname)
      ) {
        pipelines = Array.isArray(body) ? body : body?.pipelines ?? [];

        return json(res, 201, {
          imported: pipelines.length,
          pipelines,
        });
      }

      return json(res, 404, {
        message: "Console API stub route not found",
        method: req.method,
        path: url.pathname,
      });
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();

  return {
    url: `http://127.0.0.1:${address.port}`,
    getPipelines: () => pipelines,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}