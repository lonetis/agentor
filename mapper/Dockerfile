FROM node:22-alpine

WORKDIR /app
COPY proxy.mjs .

HEALTHCHECK --interval=10s --timeout=3s CMD node -e "require('node:fs').accessSync('/data/port-mappings.json', require('node:fs').constants.R_OK)"

CMD ["node", "proxy.mjs"]
