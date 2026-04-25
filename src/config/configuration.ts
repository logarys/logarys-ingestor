export default () => ({
  appHost: process.env.APP_HOST ?? "0.0.0.0",
  appPort: Number.parseInt(process.env.APP_PORT ?? "3000", 10),
  confFile: process.env.CONF_FILE ?? "/conf/pipelines.json",
  confPipelinesDir: process.env.CONF_PIPELINES_DIR ?? "/conf/pipelines.d",
  natsUrl: process.env.NATS_URL ?? "nats://localhost:4222",
  natsClientName: process.env.NATS_CLIENT_NAME ?? "logarys-ingestor",
  natsTimeoutMs: Number.parseInt(process.env.NATS_TIMEOUT_MS ?? "5000", 10),
  jetstreamPublishTimeoutMs: Number.parseInt(
    process.env.JETSTREAM_PUBLISH_TIMEOUT_MS ?? "5000",
    10,
  ),
  logLevels: (process.env.LOG_LEVEL ?? "log,error,warn")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
});
