#!/usr/bin/env bash
set -u

LOG_FILE="${TMPDIR:-/tmp}/logarys-ingestor-test-output.log"
DOCKER_LOG_FILE="${TMPDIR:-/tmp}/logarys-ingestor-docker-output.log"
: > "$LOG_FILE"
: > "$DOCKER_LOG_FILE"
CLEANED=0

cleanup() {
  if [ "$CLEANED" -eq 0 ]; then
    docker compose logs --no-color > "$DOCKER_LOG_FILE" 2>&1 || true
    cat "$DOCKER_LOG_FILE" >> "$LOG_FILE"
    docker compose down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

set +e
{
  npm install || exit $?
  docker compose pull || exit $?
  docker compose up -d --build || exit $?
  npm run build || exit $?
  node --test
  TEST_STATUS=$?
  docker compose logs --no-color > "$DOCKER_LOG_FILE" 2>&1
  cat "$DOCKER_LOG_FILE" >> "$LOG_FILE"
  docker compose down -v >/dev/null 2>&1
  CLEANED=1
  exit "$TEST_STATUS"
} 2>&1 | tee -a "$LOG_FILE"
STATUS=${PIPESTATUS[0]}
set -e

WARNING_PATTERN='(^|[[:space:]])(WARN|WARNING|npm warn|warn\[|warning)([[:space:]]|\[|:|$)'
ERROR_PATTERN='(CONNECTION_REFUSED|NatsError|ECONNREFUSED|Unable to import local pipeline configuration|(^|[[:space:]])(ERROR|ERR)([[:space:]]|\[|:|$))'

if grep -E "$WARNING_PATTERN" "$LOG_FILE" >/dev/null 2>&1; then
  echo "Test output contains warnings:" >&2
  grep -E "$WARNING_PATTERN" "$LOG_FILE" >&2
  exit 1
fi

if grep -E "$ERROR_PATTERN" "$LOG_FILE" >/dev/null 2>&1; then
  echo "Test output or Docker service logs contain errors:" >&2
  grep -E "$ERROR_PATTERN" "$LOG_FILE" >&2
  exit 1
fi

exit "$STATUS"
