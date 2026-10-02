# Coach Relay v1.2 (Stop Action v1.0)

A dependency-free Node.js 20+ service that serves the PWA and exposes `/api/coach`.

## Local mock

```bash
MOCK_OPENAI=1 node server.mjs
```

Open `http://127.0.0.1:8787/`.

## Local real API

```bash
export OPENAI_API_KEY='...'
export OPENAI_MODEL='gpt-6-astra'
export ALLOWED_MODELS='gpt-6-astra'
node server.mjs
```

The key can also be mounted as a file:

```bash
OPENAI_API_KEY_FILE=/run/secrets/openai_api_key node server.mjs
```

## Endpoints

- `GET /api/health` — process liveness and non-secret configuration summary.
- `GET /api/ready` — model credential + rate limiter readiness.
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
