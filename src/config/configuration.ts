export default () => ({
  natsTimeoutMs: Number.parseInt(process.env.NATS_TIMEOUT_MS ?? "5000", 10),
  jetstreamPublishTimeoutMs: Number.parseInt(
    process.env.JETSTREAM_PUBLISH_TIMEOUT_MS ?? "5000",
    10,
  ),
  logLevels: (process.env.LOG_LEVEL ?? "log,error,warn")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  appHost: process.env.APP_HOST ?? "0.0.0.0",
  appPort: Number.parseInt(process.env.APP_PORT ?? "3000", 10),

  confFile: process.env.CONF_FILE ?? "./conf/pipelines.json",
  confPipelinesDir: process.env.CONF_PIPELINES_DIR ?? "./conf/pipelines.d",

  natsUrl: process.env.NATS_URL ?? "nats://127.0.0.1:4222",
  natsClientName: process.env.NATS_CLIENT_NAME ?? "logarys-ingestor",
  natsStream: process.env.NATS_STREAM ?? "LOGS",
  natsSubjects: process.env.NATS_SUBJECTS ?? "logs.>",

  storageManagerUrl: process.env.STORAGE_MANAGER_URL,
  storageManagerApiToken: process.env.STORAGE_MANAGER_API_TOKEN,
  ingestorApiToken: process.env.INGESTOR_API_TOKEN,
});
