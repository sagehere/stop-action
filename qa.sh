#!/usr/bin/env bash
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
cd "$ROOT"
node tests/qa.cjs
./e2e/test_local_smoke.sh
if [ "${RUN_BROWSER_TESTS:-0}" = "1" ]; then
  node tests/browser.cjs
fi
