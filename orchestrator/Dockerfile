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

CMD ["node", ".output/server/index.mjs"]
