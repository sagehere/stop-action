#!/usr/bin/env bash
set -eu
ROOT="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

node --check "$ROOT/db.js"
node --check "$ROOT/app.js"
node "$ROOT/smoke_runtime.js" "$ROOT/app.js"
node --check "$ROOT/relay/server.mjs"
node --check "$ROOT/relay/rate_limit.mjs"
node "$ROOT/relay/test_relay.mjs"
node "$ROOT/relay/test_upstream_contract.mjs"
node "$ROOT/relay/test_rate_limit.mjs"
node "$ROOT/e2e/test_proxy_contract.mjs"
"$ROOT/e2e/test_local_smoke.sh"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import re, sys, yaml
root=Path(sys.argv[1])
html=(root/'index.html').read_text()
js=(root/'app.js').read_text()
db=(root/'db.js').read_text()
compose_text=(root/'deploy/docker-compose.yml').read_text()
workflow=(root/'.github/workflows/docker-image.yml').read_text()

all_ids=re.findall(r'id="([^"]+)"', html)
dup=sorted({x for x in all_ids if all_ids.count(x)>1})
if dup: raise SystemExit(f'Duplicate HTML IDs: {dup}')
ids=set(all_ids)
refs=set()
for m in re.finditer(r"(?<!\$)\$\('#([^']+)'\)", js):
    selector=m.group(1)
    if all(ch not in selector for ch in ' .:#[]>+~'): refs.add(selector)
missing=sorted(refs-ids)
if missing: raise SystemExit(f'Missing direct DOM IDs: {missing}')

required=[
 'index.html','app.js','db.js','sw.js','manifest.webmanifest','icon.svg','smoke_runtime.js',
 'Dockerfile','.dockerignore','.gitignore','README.md','qa.sh',
 '.github/workflows/docker-image.yml','docs/DEVICE_TEST_DATA.md','docs/MOBILE_ACCEPTANCE_CHECKLIST.md',
 'docs/COACH_CHAT_ADAPTER_SPEC.md','docs/COACH_LAYER_SPEC.md','docs/RELAY_SECURITY_SPEC.md',
 'relay/server.mjs','relay/rate_limit.mjs','relay/test_relay.mjs','relay/test_upstream_contract.mjs',
 'relay/test_rate_limit.mjs','relay/package.json','relay/.env.example','relay/README.md',
 'deploy/docker-compose.yml','deploy/.env.example','deploy/README.md','deploy/secrets/README.md',
 'e2e/production_smoke.sh','e2e/test_proxy_contract.mjs','e2e/test_local_smoke.sh','e2e/coach_request.json'
]
for name in required:
    if not (root/name).exists(): raise SystemExit(f'Missing asset: {name}')

checks={
 'App v1.0': 'v1.0' in html and 'stop-action-v10' in (root/'sw.js').read_text(),
 'IndexedDB':'indexedDB.open' in db,
 'Adaptive Engine':'adaptiveEngine' in js and 'LOWER_STOP_THRESHOLD' in js,
 'Exercise Registry':'const EXERCISES' in js and 'pelvic_coordination' in js,
 'Program Builder':'builderModules' in html and 'saveCustomProgram' in js,
 'Prompt Modes':'promptModes' in html and 'autonomous' in js,
 'Data quality':'function dataQuality' in js and 'usableForTrend' in js,
 'Coach explain-only':'coachRuleEngine' in js and 'COACH_FORBIDDEN_FIELDS' in js,
 'Session-only token':'externalCoachToken' in js and "DB.setMeta('externalCoachToken'" not in js,
 'Relay Structured Outputs':'store: false' in (root/'relay/server.mjs').read_text() and 'json_schema' in (root/'relay/server.mjs').read_text(),
 'Relay privacy':'FORBIDDEN_CONTEXT_KEYS' in (root/'relay/server.mjs').read_text(),
 'Redis rate limit':'createRateLimiter' in (root/'relay/server.mjs').read_text() and 'RATE_LIMIT_BACKEND' in compose_text,
 'Device test opt-in':'betaTelemetryEnabled:false' in js and 'toggleBetaTelemetry' in html,
 'Device test export':'stop-action-device-test' in js and 'exportBetaJson' in js and 'exportBetaCsv' in js,
 'Device test privacy':"delete safeMeta.arousal" in js and "delete safeMeta.signal" in js,
 'GHCR only':'ghcr.io' in workflow and 'docker.io' not in workflow.lower(),
 'Multi-arch':'linux/amd64,linux/arm64' in workflow,
 'Main branch publish':'branches: [main]' in workflow,
}

compose=yaml.safe_load(compose_text)
services=compose.get('services',{})
if set(services) != {'stop-action','redis'}:
    raise SystemExit(f'Compose must contain only stop-action + redis, got: {sorted(services)}')
if 'ports' not in services['stop-action']: raise SystemExit('stop-action port is not exposed for external reverse proxy')
if 'ghcr.io/sagehere/stop-action' not in compose_text: raise SystemExit('Compose image is not GHCR stop-action')
for forbidden in ('caddy','nginx','traefik','npm'):
    if forbidden in services: raise SystemExit(f'Reverse proxy service must not be deployed here: {forbidden}')
if list((root/'deploy/secrets').glob('*.txt')): raise SystemExit('Real secret .txt files must not be included')

failed=[name for name,ok in checks.items() if not ok]
if failed: raise SystemExit('Feature checks failed: '+', '.join(failed))
print('QA OK')
print(f'HTML IDs: {len(ids)}')
print('Features: '+', '.join(checks))
PY
