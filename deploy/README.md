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
printf '%s' 'YOUR_OPENAI_API_KEY' > secrets/openai_api_key.txt
printf '%s' 'OPTIONAL_RELAY_TOKEN' > secrets/relay_bearer_token.txt
chmod 600 secrets/*.txt
```

If you do not want Relay Bearer authentication, create an empty `relay_bearer_token.txt`.

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
