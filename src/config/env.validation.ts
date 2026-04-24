export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const requiredNumberKeys = ['APP_PORT', 'NATS_TIMEOUT_MS', 'JETSTREAM_PUBLISH_TIMEOUT_MS'];

  for (const key of requiredNumberKeys) {
    const rawValue = config[key];
    if (rawValue !== undefined && Number.isNaN(Number(rawValue))) {
      throw new Error(`Environment variable ${key} must be a number`);
    }
  }

  return config;
}
