FROM node:24.18.0-alpine3.23 AS build

WORKDIR /workspace

COPY . .

RUN --mount=type=cache,id=comhub-module-worker-pnpm,target=/pnpm/store \
  corepack enable \
  && corepack prepare pnpm@10.33.0 --activate \
  && pnpm config set store-dir /pnpm/store \
  && pnpm install --filter @lobechat/module-worker... --prod --no-frozen-lockfile --ignore-scripts \
  && pnpm --filter @lobechat/module-worker exec esbuild src/index.ts \
    --bundle \
    --format=esm \
    --banner:js="import { createRequire as __moduleCreateRequire } from 'node:module'; const require = __moduleCreateRequire(import.meta.url);" \
    --outfile=/workspace/worker.mjs \
    --platform=node \
    --target=node24

FROM node:24.18.0-alpine3.23

RUN apk add --no-cache tini \
  && rm -f /sbin/apk /usr/bin/apk /usr/sbin/apk \
  && rm -rf /usr/local/lib/node_modules \
  && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/pnpm /usr/local/bin/yarn \
  && addgroup -S -g 10001 moduleworker \
  && adduser -S -D -H -u 10001 -G moduleworker moduleworker \
  && mkdir -p /app /runtime/artifacts \
  && chown -R 10001:10001 /app /runtime

WORKDIR /app
COPY --from=build --chown=10001:10001 /workspace/worker.mjs /app/worker.mjs

USER 10001:10001

HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "/app/worker.mjs", "healthcheck"]

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "/app/worker.mjs"]
