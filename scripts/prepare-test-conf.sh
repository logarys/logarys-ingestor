#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONF_DIR="$ROOT_DIR/.test-runtime/conf"
PIPELINES_DIR="$CONF_DIR/pipelines.d"

rm -rf "$ROOT_DIR/.test-runtime"
mkdir -p "$PIPELINES_DIR"

cat > "$CONF_DIR/pipelines.json" <<'JSON'
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
JSON

cat > "$PIPELINES_DIR/bootstrap-file-pipeline.json" <<'JSON'
{
  "id": "bootstrap-file-pipeline",
  "source": "bootstrap-file-pipeline",
  "enabled": true,
  "parser": {
    "type": "raw"
  },
  "defaults": {
    "source": "bootstrap-file-pipeline",
    "host": "bootstrap-host",
    "env": "test"
  },
  "publish": {
    "subject": "logs.bootstrap-file-pipeline"
  },
  "security": {
    "mode": "none"
  }
}
JSON

chmod -R 777 "$ROOT_DIR/.test-runtime"
