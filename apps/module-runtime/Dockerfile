# syntax=docker/dockerfile:1.7
FROM node:24.18.0-alpine3.23 AS build

WORKDIR /workspace
COPY apps/module-runtime/docker/orchestrator-package.json ./package.json
COPY apps/module-runtime/docker/orchestrator-package-lock.json ./package-lock.json
RUN npm ci --ignore-scripts

COPY apps/module-runtime/src ./apps/module-runtime/src
COPY packages/observability-otel/src/modules/module-app/index.ts ./packages/observability-otel/src/modules/module-app/index.ts
COPY packages/types/src/moduleAppData.ts packages/types/src/moduleAppRuntime.ts packages/types/src/moduleAppWorkflow.ts ./packages/types/src/

RUN ./node_modules/.bin/esbuild apps/module-runtime/src/server.ts \
  --alias:@lobechat/observability-otel/modules/module-app=./packages/observability-otel/src/modules/module-app/index.ts \
  --alias:@lobechat/types=./packages/types/src/moduleAppRuntime.ts \
  --bundle \
  --format=esm \
  --outfile=dist/server.mjs \
  --platform=node \
  --target=node24

FROM node:24.18.0-alpine3.23

RUN apk add --no-cache docker-cli \
  && addgroup -S -g 10001 moduleapp \
  && adduser -S -D -H -u 10001 -G moduleapp moduleapp \
  && mkdir -p /app /runtime/artifacts \
  && chown -R 10001:10001 /runtime /app

WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/dist/server.mjs ./server.mjs

ENV NODE_ENV=production \
  PORT=3210
EXPOSE 3210
USER 10001:10001

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "require('http').get('http://127.0.0.1:3210/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"]

CMD ["node", "server.mjs"]
