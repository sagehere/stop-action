# Relay Security Spec v1.1

## Trust boundaries

1. Browser is untrusted.
2. Relay is the policy enforcement point.
3. Redis is private infrastructure used only for rate-limit counters.
4. OpenAI is an external processor receiving only `coach-context-v1` plus the current Coach conversation/question after explicit user consent.

## Secrets

`OPENAI_API_KEY` and optional `RELAY_BEARER_TOKEN` must remain server-side. Production supports secret-file injection through `*_FILE`, which is the default Docker Compose deployment.

## Request validation

Relay accepts only `coach-chat-request-v1` and requires:

- explain-only policy flags;
- minimized `coach-context-v1` privacy flags;
- bounded conversation and message length;
- allowlisted model;
- allowlisted response fields;
- no raw event/session/revision fields;
- no Training Engine control fields.

## Output validation

Structured Outputs is used upstream, but Relay still validates the returned object and rejects:

- unknown/control fields;
- direct instructions that set Stop/Resume thresholds, training week, or safety flags;
- empty answers;
- malformed structured output.

Refusals and incomplete responses are treated as explicit upstream conditions and never write training state.

## Data retention

Responses requests are sent with `store:false`. Relay does not persist request or response bodies.

## Rate limiting

Development may use per-process memory counters. Production uses Redis with an atomic fixed-window counter. `RATE_LIMIT_FAIL_CLOSED=1` is recommended for public deployment.

## Reverse proxy

Same-Origin is the default. When `TRUST_PROXY=1`, Relay uses the trusted proxy's `X-Forwarded-Proto` / `X-Forwarded-For` values. Do not enable `TRUST_PROXY=1` if clients can reach the Relay directly.

## Logging

Allowed examples:

- Relay request ID
- OpenAI request ID
- status / duration
- selected allowlisted model
- truncated hash of client IP
- rate-limit backend

Forbidden:

- user question
- Coach Context
- raw model output
- bearer token
- OpenAI key
- raw training Event Stream
