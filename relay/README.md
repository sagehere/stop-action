# Coach Relay

A dependency-free Node.js 20+ service that serves the PWA and exposes `/api/coach`.

## Local mock

```bash
MOCK_OPENAI=1 node server.mjs
```

Open `http://127.0.0.1:8787/`.

## Local real API

```bash
export OPENAI_MODEL='gpt-6-astra'
OPENAI_API_KEY_FILE=../deploy/secrets/openai_api_key.txt node server.mjs
```

Put the upstream key into the indicated file with a local editor. In Docker, the stack mounts the file under `/run/secrets/`.

## Endpoints

- `GET /api/health` — process liveness and non-secret configuration summary.
- `GET /api/ready` — checks core application assets.
- `GET /api/coach/ready` — checks model configuration and rate limiter readiness.
- `GET /api/coach/models` — lists model IDs from `ALLOWED_MODELS`, with `OPENAI_MODEL` as the fallback. Uses the same origin and bearer token checks as the coach endpoint.
- `POST /api/coach` — validated Coach request.
- all other GET/HEAD paths — static PWA.

## Multi-instance rate limiting

Development default:

```text
RATE_LIMIT_BACKEND=memory
```

Production:

```text
RATE_LIMIT_BACKEND=redis
REDIS_URL=redis://redis:6379/0
RATE_LIMIT_FAIL_CLOSED=1
```

The Redis limiter uses an atomic `INCR + PEXPIRE` Lua script. If Redis is unavailable and fail-closed is disabled, the Relay falls back to per-process memory limiting and marks the response/log as degraded.

## Upstream behavior

- OpenAI Responses API
- strict Structured Outputs via `text.format.type=json_schema`
- `store:false`
- server-controlled model allowlist
- per-attempt timeout + total deadline
- optional retry of temporary 429/503 only
- honors `Retry-After` when supplied and adds jitter
- logs OpenAI `x-request-id` for operational debugging
- explicitly handles model refusals and incomplete responses

## Security

The Relay revalidates the browser request and rejects:

- raw event streams;
- Session IDs and revision logs;
- exact training timestamps;
- Training Engine control fields;
- direct threshold-control instructions returned by the model.

The log function intentionally never writes request bodies, Coach Context, user questions, bearer tokens, API keys, or raw upstream output.

## Tests

```bash
node test_relay.mjs
node test_upstream_contract.mjs
node test_rate_limit.mjs
```

Or from project root:

```bash
./qa.sh
```

For lightweight deployment, see `../deploy/README.md`. Reverse proxy and TLS are managed outside this repository.
