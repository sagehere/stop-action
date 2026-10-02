FROM node:22-alpine

WORKDIR /app
COPY --chown=node:node . /app

ENV HOST=0.0.0.0 \
    PORT=8787 \
    STATIC_ROOT=/app \
    NODE_ENV=production

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "relay/server.mjs"]
