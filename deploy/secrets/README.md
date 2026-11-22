# Local secret files

Create both files in the local stack directory. Git ignores contents of this directory except for these instructions and its ignore file.

- `openai_api_key.txt` — upstream provider key used by this stack's Relay. Enter it in the file with a local editor. Leave the file empty when the stack is used only for local training or with a separately hosted Relay.
- `relay_bearer_token.txt` — set a token when exposing an active Relay publicly. Use this token in the browser's **临时令牌** field for the model list and Coach requests.

Recommended host permissions:

```bash
chmod 700 secrets
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
```

The application container runs as a non-root user. Docker Compose file-backed secrets are bind mounts, so `600 root:root` causes `EACCES` inside the container. Keeping the directory at `700` protects host-side traversal while `644` lets the non-root process read the mounted files.

Redact real origins, server addresses, API keys, and tokens before sharing deployment configuration or screenshots.
