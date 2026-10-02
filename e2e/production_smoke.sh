#!/usr/bin/env sh
set -eu

# By default this tests the app directly. To test through your external proxy,
# pass BASE_URL=https://your-domain.example.com.
BASE_URL="${BASE_URL:-http://127.0.0.1:8787}"
TOKEN="${RELAY_BEARER_TOKEN:-}"
RUN_LLM_TEST="${RUN_LLM_TEST:-0}"
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

case "$BASE_URL" in
  https://*|http://127.0.0.1:*|http://localhost:*) ;;
  *) echo "Refusing non-HTTPS non-local BASE_URL: $BASE_URL" >&2; exit 2 ;;
esac

printf '1/5 health... '
curl -fsS "$BASE_URL/api/health" | grep -q '"ok":true'
echo OK

printf '2/5 readiness... '
curl -fsS "$BASE_URL/api/ready" | grep -q '"ok":true'
echo OK

printf '3/5 PWA shell... '
curl -fsS -o /tmp/stop-action-index.html "$BASE_URL/"
grep -q 'v1.0' /tmp/stop-action-index.html
echo OK

printf '4/5 service worker assets... '
for asset in app.js db.js sw.js manifest.webmanifest icon.svg; do curl -fsS -o /dev/null "$BASE_URL/$asset"; done
echo OK

printf '5/5 Coach path... '
if [ "$RUN_LLM_TEST" != "1" ]; then
  echo 'SKIPPED (set RUN_LLM_TEST=1 to make one real model request)'
  exit 0
fi
if [ -n "$TOKEN" ]; then
  response="$(curl -fsS -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" --data-binary @"$ROOT/e2e/coach_request.json" "$BASE_URL/api/coach")"
else
  response="$(curl -fsS -H 'Content-Type: application/json' --data-binary @"$ROOT/e2e/coach_request.json" "$BASE_URL/api/coach")"
fi
printf '%s' "$response" | grep -q '"schema":"coach-chat-response-v1"'
printf '%s' "$response" | grep -q '"answer"'
echo OK
