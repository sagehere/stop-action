# Local secret files

Create these files locally; they are ignored by Git:

- `openai_api_key.txt` — required only when external Coach uses the bundled Relay.
- `relay_bearer_token.txt` — optional. Leave the file empty to disable Relay Bearer authentication.

Recommended host permissions:

```bash
chmod 700 secrets
chmod 644 secrets/openai_api_key.txt secrets/relay_bearer_token.txt
```

The application container runs as a non-root user. Docker Compose file-backed secrets are bind mounts, so `600 root:root` causes `EACCES` inside the container. Keeping the directory at `700` protects host-side traversal while `644` lets the non-root process read the mounted files.

Never commit either file.
