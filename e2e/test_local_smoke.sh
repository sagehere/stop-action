#!/usr/bin/env sh
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PORT="${PORT:-18991}"
HOST=127.0.0.1 PORT="$PORT" MOCK_OPENAI=1 node "$ROOT/relay/server.mjs" > /tmp/ec-v09-local-smoke.log 2>&1 &
pid=$!
trap 'kill "$pid" >/dev/null 2>&1 || true' EXIT INT TERM
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$PORT/api/ready" >/dev/null 2>&1; then break; fi
  sleep 0.05
done
BASE_URL="http://127.0.0.1:$PORT" RUN_LLM_TEST=1 "$ROOT/e2e/production_smoke.sh"
echo 'LOCAL PRODUCTION SMOKE OK'
