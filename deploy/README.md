# Lightweight deployment

This project deploys only two containers:

- `stop-action`: the PWA + `/api/coach` relay
- `redis`: rate limiting / relay infrastructure

TLS, domains, certificates, and reverse proxying are intentionally **out of scope**. Point your existing Nginx Proxy Manager, Caddy, Traefik, or other proxy to the host/port exposed by this compose stack.

## 1. Configure

```bash
cd deploy
[ -f .env ] || cp .env.example .env
mkdir -p secrets
chmod 700 secrets
touch secrets/openai_api_key.txt secrets/relay_bearer_token.txt
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
```

Edit your local `.env` and replace the example origin with your deployment origin. The template pins v2.2.3 (GHCR tag `sha-3e38df2`). For an existing stack, also check whether `STOP_ACTION_IMAGE` in Dockge's ENV overrides this tag.

Keep both secret files in the stack directory. For a deployment with an active Relay, enter the upstream key in `openai_api_key.txt` using a local editor. Configure `relay_bearer_token.txt` to authenticate public AI requests. See [local secret files](secrets/README.md) for permissions and which credential goes in the browser.

**Important:** this image runs as a non-root user. Docker Compose implements `file:` secrets as bind mounts, so a host file set to `600 root:root` is unreadable inside the container. Use `700` on the `secrets/` directory and `644` on the two mounted files.

Default binding is `127.0.0.1:8787`. This is ideal when the external reverse proxy can reach host loopback. If your proxy runs in another isolated Docker stack, either connect it through your existing shared network design or set `APP_BIND=0.0.0.0` and restrict port 8787 with the host firewall.

## 2. Start

```bash
docker compose pull
docker compose up -d
```

## 3. Proxy externally

Proxy your public HTTPS origin to:

```text
http://HOST_IP:8787
```

Set `ALLOWED_ORIGINS` in `.env` to the public HTTPS origin, for example:

```text
ALLOWED_ORIGINS=https://training.example.com
```

If your proxy forwards API routes individually, include `POST /api/coach`, `GET /api/coach/models`, and the readiness routes. When the browser and Relay use different origins, allow the PWA origin in `ALLOWED_ORIGINS` and forward CORS preflight requests.

## 4. Upgrade

Update `STOP_ACTION_IMAGE` to the released image tag you want to deploy, then pull and recreate the services. For current installations based on the v2.2.3 template, that tag is `sha-3e38df2`.

```bash
docker compose pull
docker compose up -d
```

No reverse-proxy container, certificate volume, or ACME configuration is managed by this repository.

## 5. Configure AI Coach in the browser

Open **我的 → AI 教练 → 连接地址、模型和令牌**. Enter the full Relay URL manually, such as `https://training.example.com/api/coach`. Use the Relay bearer token in **临时令牌** when configured. Select **拉取模型列表**, choose a model and save the settings after granting consent.

- `GET /api/coach/models` lists IDs configured in `ALLOWED_MODELS`. Set comma-separated IDs for several models. An empty value falls back to `OPENAI_MODEL`.
- For another Relay, you can enter a model list path on its origin in **自定义模型列表地址**. For a Relay without a model list, enter the model ID manually.

## v2 readiness and release gates

`GET /api/ready` checks the core application resources. `GET /api/coach/ready` checks the model configuration and rate limiter. `GET /api/health` provides a compatibility status. Validate a working AI deployment by listing models and completing one Coach request.

Bearer authentication remains optional for personal deployments. Only enable `TRUST_PROXY=1` when the Relay is reachable exclusively through a trusted proxy that overwrites forwarded headers. The proxy must prevent direct public access to the Relay. Keep secrets outside the public directory; the runtime image copies no deployment files. Public static resources are an exact whitelist; source, hidden and deployment paths return404.

CI runs QA and Linux Chromium/WebKit checks before building/pushing images. Pin a version or digest, retain the previous digest, and export a migration-before backup from each browser. Server downgrade alone does not downgrade IndexedDB or Service Worker. Client backup/restore and historical-version recovery tests are documented in `docs/MIGRATION_AND_BACKUP.md`; container rollback and Android/iPhone checks remain deployment acceptance tasks.
