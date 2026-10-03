# Lightweight deployment

This project deploys only two containers:

- `stop-action`: the PWA + `/api/coach` relay
- `redis`: rate limiting / relay infrastructure

TLS, domains, certificates, and reverse proxying are intentionally **out of scope**. Point your existing Nginx Proxy Manager, Caddy, Traefik, or other proxy to the host/port exposed by this compose stack.

## 1. Configure

```bash
cd deploy
cp .env.example .env
mkdir -p secrets
chmod 700 secrets
printf '%s' 'YOUR_OPENAI_API_KEY' > secrets/openai_api_key.txt
printf '%s' 'OPTIONAL_RELAY_TOKEN' > secrets/relay_bearer_token.txt
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
```

If you do not want Relay Bearer authentication, create an empty `relay_bearer_token.txt`.

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

## 4. Upgrade

```bash
docker compose pull
docker compose up -d
```

No reverse-proxy container, certificate volume, or ACME configuration is managed by this repository.

## v2 readiness and release gates

`GET /api/ready` checks the core application resources. Empty model secrets do not make the local application unhealthy. `GET /api/coach/ready` checks model configuration and rate limiter availability; `/api/health` retains compatibility fields. Configure proxies to pass the new endpoint too. A Coach failure does not block training.

Bearer authentication remains optional for personal deployments. Only enable `TRUST_PROXY=1` when the Relay is reachable exclusively through a trusted proxy that overwrites forwarded headers. The proxy must prevent direct public access to the Relay. Keep secrets outside the public directory; the runtime image copies no deployment files. Public static resources are an exact whitelist; source, hidden and deployment paths return404.

CI runs QA and Linux Chromium/WebKit checks before building/pushing images. Pin a version or digest, retain the previous digest, and export a migration-before backup from each browser. Server downgrade alone does not downgrade IndexedDB or Service Worker. Client backup/restore and historical-version recovery tests are documented in `docs/MIGRATION_AND_BACKUP.md`; container rollback and Android/iPhone checks remain deployment acceptance tasks.
