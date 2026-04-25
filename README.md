# logarys-ingestor

NestJS HTTP ingestion service for raw logs.

It receives raw logs over HTTP, selects a pipeline from the `source` path segment, normalizes the log with `small-log-normalizer`, then publishes exactly one JSON message per normalized log to **NATS JetStream**.

## Features

- HTTP ingestion route: `POST /injest/:source`
- One pipeline per source
- Global defaults loaded from `/conf/pipelines.json`
- Per-pipeline configuration loaded from `/conf/pipelines.d/*.json`
- Optional token-based pipeline security
- Log normalization through `small-log-normalizer`
- Publication of one JSON message per normalized log to NATS JetStream
- Pipeline management API
- Functional tests for ingestion and pipeline configuration API

## Project layout

```txt
/app
  src/
  conf/
  Dockerfile
  docker-compose.yaml
```

At runtime, the application expects:

- `/conf/pipelines.json` for global defaults
- `/conf/pipelines.d/*.json` for pipeline files

## Requirements

- Node.js 22+
- npm 10+
- NATS with JetStream enabled

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Start locally

```bash
node dist/main.js
```

## Run tests

```bash
npm test
```

The test suite builds the application and runs functional HTTP tests with a mocked JetStream publisher.

## Environment variables

| Variable                       |                 Default | Description                                     |
| ------------------------------ | ----------------------: | ----------------------------------------------- |
| `APP_HOST`                     |               `0.0.0.0` | HTTP bind host                                  |
| `APP_PORT`                     |                  `3000` | HTTP bind port                                  |
| `CONF_FILE`                    |  `/conf/pipelines.json` | Global pipeline config file                     |
| `CONF_PIPELINES_DIR`           |     `/conf/pipelines.d` | Directory containing one JSON file per pipeline |
| `NATS_URL`                     | `nats://localhost:4222` | NATS server URL                                 |
| `NATS_CLIENT_NAME`             |      `logarys-ingestor` | NATS client name                                |
| `NATS_TIMEOUT_MS`              |                  `5000` | NATS connection timeout                         |
| `JETSTREAM_PUBLISH_TIMEOUT_MS` |                  `5000` | JetStream publish timeout                       |
| `LOG_LEVEL`                    |        `log,error,warn` | Nest logger levels                              |

## Configuration files

### Global defaults: `/conf/pipelines.json`

```json
{
  "defaults": {
    "enabled": true,
    "parser": {
      "type": "raw"
    },
    "publish": {
      "subject": "logs.normalized"
    },
    "security": {
      "mode": "none"
    }
  }
}
```

### Pipeline file: `/conf/pipelines.d/php-app.json`

```json
{
  "id": "php-app",
  "source": "php-app",
  "enabled": true,
  "parser": {
    "type": "regex",
    "pattern": "^(?<timestamp>\\S+\\s+\\S+)\\s+\\[(?<level>[A-Z]+)\\]\\s+(?<message>.*)$"
  },
  "defaults": {
    "source": "php-app",
    "host": "app-01",
    "service": "booking-api",
    "env": "prod"
  },
  "publish": {
    "subject": "logs.php.normalized"
  },
  "security": {
    "mode": "header",
    "token": "my-secret-token"
  }
}
```

## Pipeline model

A pipeline file supports these fields:

- `id`: unique pipeline identifier
- `source`: the route segment used by `/injest/:source`
- `enabled`: enables or disables ingestion
- `parser.type`: `raw`, `json`, or `regex`
- `parser.pattern`: required for `regex`
- `mapping`: optional mapping between regex group names and normalized field names
- `defaults`: fallback values injected before normalization
- `publish.subject`: NATS subject used to publish the normalized log
- `security.mode`: `none`, `header`, or `query`
- `security.token`: expected token when security is enabled

## Ingestion API

### Route

```http
POST /injest/:source
```

Example:

```http
POST /injest/php-app
```

### Request body

```json
{
  "raw": "2026-04-23 10:15:30 [ERROR] Database connection failed",
  "host": "override-host",
  "metadata": {
    "requestId": "req-123"
  }
}
```

Supported fields:

- `raw` required
- `source` optional override
- `host` optional override
- `service` optional override
- `env` optional override
- `metadata` optional object merged into `context.extra`

### Security modes

#### No security

```json
{
  "security": {
    "mode": "none"
  }
}
```

#### Header token

Pipeline config:

```json
{
  "security": {
    "mode": "header",
    "token": "my-secret-token"
  }
}
```

Request:

```bash
curl -X POST http://localhost:3000/injest/php-app \
  -H 'Content-Type: application/json' \
  -H 'X-token: my-secret-token' \
  -d '{"raw":"2026-04-23 10:15:30 [ERROR] Database connection failed"}'
```

#### Query token

Pipeline config:

```json
{
  "security": {
    "mode": "query",
    "token": "my-secret-token"
  }
}
```

Request:

```bash
curl -X POST 'http://localhost:3000/injest/php-app?token=my-secret-token' \
  -H 'Content-Type: application/json' \
  -d '{"raw":"2026-04-23 10:15:30 [ERROR] Database connection failed"}'
```

### Success response

```json
{
  "accepted": true,
  "pipelineId": "php-app",
  "subject": "logs.php.normalized",
  "normalizedLog": {
    "timestamp": "2026-04-23T08:15:30.000Z",
    "level": "ERROR",
    "message": "Database connection failed",
    "source": "php-app",
    "host": "app-01",
    "context": {
      "service": "booking-api",
      "env": "prod",
      "raw": "2026-04-23 10:15:30 [ERROR] Database connection failed",
      "extra": {
        "requestId": "req-123"
      }
    }
  }
}
```

### Error responses

- `400` invalid request body
- `403` missing or invalid pipeline token
- `404` pipeline not found
- `409` pipeline disabled

## Published JetStream message

The app publishes one JSON document per accepted log:

```json
{
  "pipelineId": "php-app",
  "source": "php-app",
  "receivedAt": "2026-04-24T08:00:00.000Z",
  "normalizedLog": {
    "timestamp": "2026-04-23T08:15:30.000Z",
    "level": "ERROR",
    "message": "Database connection failed",
    "source": "php-app",
    "host": "app-01",
    "context": {
      "service": "booking-api",
      "env": "prod",
      "raw": "2026-04-23 10:15:30 [ERROR] Database connection failed",
      "extra": {}
    }
  }
}
```

Headers added to the published message:

- `x-pipeline-id`
- `x-source`
- `x-log-level`

## Pipeline configuration API

### Global config

- `GET /pipelines/config`
- `PUT /pipelines/config`

Example:

```bash
curl -X PUT http://localhost:3000/pipelines/config \
  -H 'Content-Type: application/json' \
  -d '{
    "defaults": {
      "publish": {"subject": "logs.default"},
      "security": {"mode": "none"}
    }
  }'
```

### Pipeline management

- `GET /pipelines`
- `GET /pipelines/:id`
- `POST /pipelines`
- `PUT /pipelines/:id`
- `DELETE /pipelines/:id`
- `POST /pipelines/:id/enable`
- `POST /pipelines/:id/disable`

Create pipeline example:

```bash
curl -X POST http://localhost:3000/pipelines \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "nginx-access",
    "source": "nginx-access",
    "enabled": true,
    "parser": {
      "type": "regex",
      "pattern": "^(?<message>.*)$"
    },
    "publish": {
      "subject": "logs.nginx.normalized"
    },
    "security": {
      "mode": "header",
      "token": "ingest-token"
    }
  }'
```

## Docker

### Build image

```bash
docker build -t your-dockerhub-user/logarys-ingestor:latest .
```

### Run container

```bash
docker run --rm \
  -p 3000:3000 \
  -e NATS_URL=nats://host.docker.internal:4222 \
  -v $(pwd)/conf:/conf \
  your-dockerhub-user/logarys-ingestor:latest
```

## Docker Compose

The provided `docker-compose.yaml` starts:

- a NATS server with JetStream enabled
- the NestJS ingestion service

Run it with:

```bash
docker compose up --build
```

## Functional tests included

The repository includes functional tests covering:

- successful ingestion and publication
- token-based rejection
- disabled pipeline rejection
- pipeline configuration CRUD and enable/disable actions

The tests run without a real NATS server by mocking the JetStream publishing service.

## Notes

- The route base is intentionally `/injest/:source` to match the requested contract.
- Global config is merged first, then pipeline config, then request-level overrides.
- Pipeline files are persisted exactly as JSON under `/conf/pipelines.d`.
