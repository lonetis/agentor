FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx nuxt build

FROM node:22-alpine

WORKDIR /app
COPY --from=builder /app/.output/ .output/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
