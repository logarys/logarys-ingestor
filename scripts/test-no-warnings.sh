#!/usr/bin/env bash
set -Eeuo pipefail

LOG_FILE="${TMPDIR:-/tmp}/logarys-ingestor-test-output.log"
DOCKER_LOG_FILE="${TMPDIR:-/tmp}/logarys-ingestor-docker-output.log"
: > "$LOG_FILE"
: > "$DOCKER_LOG_FILE"

cleanup() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

prepare_test_conf() {
  rm -rf .test-runtime
  mkdir -p .test-runtime/conf/pipelines.d

  cat > .test-runtime/conf/pipelines.json <<'JSON'
{
  "defaults": {
    "enabled": true,
    "parser": { "type": "raw" },
    "publish": { "subject": "logs.normalized" },
    "security": { "mode": "none" }
  }
}
JSON

  cat > .test-runtime/conf/pipelines.d/php-app.json <<'JSON'
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
JSON
}

run_tests_on_host() {
  npm install
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose up -d --build
  npm run build

  TEST_INGESTOR_URL="http://127.0.0.1:3000" \
  TEST_STORAGE_MANAGER_URL="http://127.0.0.1:3001" \
  TEST_INGESTOR_API_TOKEN="functional-test-token" \
  TEST_STORAGE_MANAGER_API_TOKEN="functional-test-token" \
  node --test \
    test/loki-pipeline.test.js \
    test/pipeline-validator-integration.test.js \
    test/ingest-http.test.js \
    test/pipelines-api.test.js \
    test/startup-sync.test.js
}

run_tests_in_container() {
  docker compose down -v --remove-orphans >/dev/null 2>&1 || true
  docker compose up -d --build mongodb nats storage-manager app
  docker compose run --rm test-runner
}

set +e
{
  prepare_test_conf
  if [ "${RUN_TESTS_IN_CONTAINER:-0}" = "1" ]; then
    run_tests_in_container
  else
    run_tests_on_host
  fi
  TEST_STATUS=$?
  docker compose logs --no-color app storage-manager > "$DOCKER_LOG_FILE" 2>&1 || true
  exit "$TEST_STATUS"
} 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}
set -e

cat "$DOCKER_LOG_FILE" >> "$LOG_FILE"

WARNING_PATTERN='(^|[[:space:]])(WARN|WARNING|npm warn|warn\[|warning)([[:space:]]|\[|:|$)'
ERROR_PATTERN='(CONNECTION_REFUSED|NatsError|ECONNREFUSED|EAI_AGAIN|Unable to import local pipeline configuration|Unable to rewrite local pipeline files|(^|[[:space:]])(ERROR|ERR)([[:space:]]|\[|:|$))'

if grep -E "$WARNING_PATTERN" "$LOG_FILE" >/dev/null 2>&1; then
  echo "Test output contains warnings:" >&2
  grep -E "$WARNING_PATTERN" "$LOG_FILE" >&2
  exit 1
fi

if grep -E "$ERROR_PATTERN" "$LOG_FILE" >/dev/null 2>&1; then
  echo "Test output or app/storage-manager logs contain errors:" >&2
  grep -E "$ERROR_PATTERN" "$LOG_FILE" >&2
  exit 1
fi

exit "$STATUS"
