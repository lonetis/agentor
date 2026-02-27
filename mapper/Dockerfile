FROM node:22-alpine

WORKDIR /app
COPY proxy.mjs .

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "require('node:fs').accessSync('/data/port-mappings.json', require('node:fs').constants.R_OK)"

CMD ["node", "proxy.mjs"]
