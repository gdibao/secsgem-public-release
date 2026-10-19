# syntax frontend removed (R2: registry blocked; buildkit v0.32 builtin frontend covers cache-mounts)

## Set global build ENV
ARG NODEJS_VERSION="24.18.0"

## Base image for all building stages
FROM node:${NODEJS_VERSION}-slim AS base

ARG USE_CN_MIRROR

ENV DEBIAN_FRONTEND="noninteractive"

RUN set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        sed -i "s/deb.debian.org/mirrors.ustc.edu.cn/g" "/etc/apt/sources.list.d/debian.sources"; \
    fi && \
    apt update && \
    apt install ca-certificates proxychains-ng -qy && \
    mkdir -p /distroless/bin /distroless/etc /distroless/etc/ssl/certs /distroless/lib && \
    cp /usr/lib/$(arch)-linux-gnu/libproxychains.so.4 /distroless/lib/libproxychains.so.4 && \
    cp /usr/lib/$(arch)-linux-gnu/libdl.so.2 /distroless/lib/libdl.so.2 && \
    cp /usr/bin/proxychains4 /distroless/bin/proxychains && \
    cp /etc/proxychains4.conf /distroless/etc/proxychains4.conf && \
    cp /usr/lib/$(arch)-linux-gnu/libstdc++.so.6 /distroless/lib/libstdc++.so.6 && \
    cp /usr/lib/$(arch)-linux-gnu/libgcc_s.so.1 /distroless/lib/libgcc_s.so.1 && \
    cp /usr/lib/$(arch)-linux-gnu/librt.so.1 /distroless/lib/librt.so.1 && \
    cp /usr/local/bin/node /distroless/bin/node && \
    cp /etc/ssl/certs/ca-certificates.crt /distroless/etc/ssl/certs/ca-certificates.crt && \
    rm -rf /tmp/* /var/lib/apt/lists/* /var/tmp/*

## Builder image, install all the dependencies and build the app
FROM base AS builder

ARG USE_CN_MIRROR
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_ANALYTICS_UMAMI
ARG NEXT_PUBLIC_UMAMI_SCRIPT_URL
ARG NEXT_PUBLIC_UMAMI_WEBSITE_ID
ARG FEATURE_FLAGS

ENV NEXT_PUBLIC_BASE_PATH="${NEXT_PUBLIC_BASE_PATH}" \
    FEATURE_FLAGS="${FEATURE_FLAGS}"

ENV APP_URL="http://app.com" \
    DATABASE_DRIVER="node" \
    DATABASE_URL="postgres://postgres:password@localhost:5432/postgres"

# Sentry
ENV NEXT_PUBLIC_SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN}" \
    SENTRY_ORG="" \
    SENTRY_PROJECT=""

# Umami
ENV NEXT_PUBLIC_ANALYTICS_UMAMI="${NEXT_PUBLIC_ANALYTICS_UMAMI}" \
    NEXT_PUBLIC_UMAMI_SCRIPT_URL="${NEXT_PUBLIC_UMAMI_SCRIPT_URL}" \
    NEXT_PUBLIC_UMAMI_WEBSITE_ID="${NEXT_PUBLIC_UMAMI_WEBSITE_ID}"

# Node
ENV NODE_OPTIONS="--max-old-space-size=16384"
ENV COREPACK_HOME="/opt/corepack"

WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY .npmrc ./
COPY packages ./packages
COPY patches ./patches
# workspace manifests must exist before pnpm i so --filter can resolve them
COPY apps/server/package.json ./apps/server/package.json
COPY apps/auth/package.json ./apps/auth/package.json
COPY apps/module-runtime/package.json ./apps/module-runtime/package.json
COPY apps/module-worker/package.json ./apps/module-worker/package.json
COPY apps/desktop/src/main/package.json ./apps/desktop/src/main/package.json
COPY apps/share/package.json ./apps/share/package.json
COPY apps/workbench/package.json ./apps/workbench/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY e2e/package.json ./e2e/package.json
# pnpm runs the root package's prepare hook during install, so keep the hook
# available in the dependency cache layer before installing workspace packages.
COPY scripts/configureGitHooks.mjs ./scripts/configureGitHooks.mjs
COPY scripts/prepareOfflineBuildDependencies.mjs ./scripts/prepareOfflineBuildDependencies.mjs
COPY .build-deps /opt/fab-build-deps

# @neondatabase/serverless is required at load time by drizzle-orm/neon-serverless, which the
# bundled Elasticsearch sync CLI imports through the shared server DB factory even when
# DATABASE_DRIVER=node selects the pg driver; without it the sync container crash-loops.
RUN --mount=type=cache,id=fab-v218-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=fab-v218-pnpm-store,target=/pnpm/store,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        export SENTRYCLI_CDNURL="https://npmmirror.com/mirrors/sentry-cli"; \
        export FFMPEG_BINARIES_URL="https://cdn.npmmirror.com/binaries/ffmpeg-static"; \
        npm config set registry "https://registry.npmmirror.com/"; \
        echo 'canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas' >> .npmrc; \
    fi && \
    export COREPACK_NPM_REGISTRY=$(npm config get registry | sed 's/\/$//') && \
    npm i -g corepack@latest && \
    corepack enable && \
    node scripts/prepareOfflineBuildDependencies.mjs && \
    pnpm i --store-dir /pnpm/store --prefer-offline && \
    mkdir -p /deps && \
    cd /deps && \
    node -e 'require("fs").writeFileSync("package.json", JSON.stringify({name:"deps",private:true,packageManager:require("/app/package.json").packageManager}))' && \
    pnpm add --store-dir /pnpm/store --prefer-offline pg drizzle-orm @neondatabase/serverless

COPY . .

# Keep the module-app SDK available before the main workspace build.
RUN --mount=type=cache,id=fab-v218-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=fab-v218-pnpm-store,target=/pnpm/store,sharing=locked \
    set -e && \
    if [ "${USE_CN_MIRROR:-false}" = "true" ]; then \
        export COREPACK_NPM_REGISTRY="https://registry.npmmirror.com"; \
        export FFMPEG_BINARIES_URL="https://cdn.npmmirror.com/binaries/ffmpeg-static"; \
    fi && \
    pnpm config set store-dir /pnpm/store && \
    node scripts/prepareOfflineBuildDependencies.mjs && \
    pnpm --filter @lobechat/module-app-sdk build

# Build the self-contained Fab CLI bundle once. The harness image below reuses
# this artifact; it does not copy workspace node_modules into production.
RUN --mount=type=cache,id=fab-v218-corepack,target=/root/.cache/node/corepack,sharing=locked \
    --mount=type=cache,id=fab-v218-pnpm-store,target=/pnpm/store,sharing=locked \
    set -e && \
    pnpm config set store-dir /pnpm/store && \
    pnpm --filter @ct-claw/fab-cli exec node scripts/ensureWorkspaceLinks.ts && \
    pnpm --filter @ct-claw/fab-cli exec tsdown

# Prebuild: env checks (checkDeprecatedAuth, checkRequiredEnvVars, printEnvInfo) then remove desktop-only code
RUN KEY_VAULTS_SECRET="dXNlLWZvci1idWlsZC1rZXktMzItYnl0ZXMtMDAwMDA=" \
    AUTH_SECRET="use-for-build-auth-secret-32-chars" \
    pnpm exec tsx scripts/dockerPrebuild.mts
RUN rm -rf src/app/desktop "src/app/(backend)/trpc/desktop"

# run build standalone for docker version
RUN --mount=type=cache,id=fab-v218-next-cache,target=/app/.next/cache,sharing=locked \
    KEY_VAULTS_SECRET="dXNlLWZvci1idWlsZC1rZXktMzItYnl0ZXMtMDAwMDA=" \
    AUTH_SECRET="use-for-build-auth-secret-32-chars" \
    pnpm run build:docker
RUN pnpm exec esbuild scripts/elasticsearchReindex/index.ts --bundle --platform=node --format=cjs --outfile=/app/fts-search-elasticsearch-reindex.cjs --external:pg --external:drizzle-orm '--external:drizzle-orm/*'
RUN pnpm exec esbuild scripts/elasticsearchSync/cli.ts --bundle --platform=node --format=cjs --outfile=/app/fts-search-elasticsearch-sync.cjs --external:pg --external:drizzle-orm '--external:drizzle-orm/*'
RUN pnpm exec esbuild scripts/elasticsearchCleanupIneligibleMessages/cli.ts --bundle --platform=node --format=cjs --outfile=/app/fts-search-ineligible-message-cleanup.cjs --external:pg --external:drizzle-orm '--external:drizzle-orm/*'
RUN pnpm exec esbuild scripts/pgSearchCleanup/index.ts --bundle --platform=node --format=cjs --outfile=/app/fts-search-pg-search-cleanup.cjs --external:pg

# Next standalone tracing can retain only the CommonJS helper files even when Next itself loads
# an ESM helper at startup. Materialize the complete helper packages and fail the build if the
# exact runtime import still cannot be resolved through Next's pnpm link.
RUN set -e && \
    standalone_store="/app/.next/standalone/node_modules/.pnpm" && \
    mkdir -p "$standalone_store" && \
    cp -a /app/node_modules/.pnpm/@swc+helpers@* "$standalone_store"/ && \
    test -n "$(find -L "$standalone_store" \
      -path '*/next@*/node_modules/@swc/helpers/esm/_interop_require_default.js' \
      -print -quit)"

## Application image, copy all the files for production
FROM busybox:latest AS app

COPY --from=base /distroless/ /

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder /app/.next/standalone /app/
COPY --from=builder /app/.next/static /app/.next/static
# Copy SPA assets (Vite build output)
COPY --from=builder /app/public/_spa /app/public/_spa
COPY --from=builder /app/public/_spa-auth /app/public/_spa-auth
COPY --from=builder /app/public/_spa-share /app/public/_spa-share
COPY --from=builder /app/public/_spa-workbench /app/public/_spa-workbench
# Copy database migrations
COPY --from=builder /app/packages/database/migrations /app/migrations
COPY --from=builder /app/scripts/migrateServerDB/docker.cjs /app/docker.cjs
COPY --from=builder /app/scripts/migrateServerDB/errorHint.js /app/errorHint.js
COPY --from=builder /app/fts-search-elasticsearch-reindex.cjs /app/fts-search-elasticsearch-reindex.cjs
COPY --from=builder /app/fts-search-elasticsearch-sync.cjs /app/fts-search-elasticsearch-sync.cjs
COPY --from=builder /app/fts-search-ineligible-message-cleanup.cjs /app/fts-search-ineligible-message-cleanup.cjs
COPY --from=builder /app/fts-search-pg-search-cleanup.cjs /app/fts-search-pg-search-cleanup.cjs

# copy dependencies
COPY --from=builder /deps/node_modules/.pnpm /app/node_modules/.pnpm
COPY --from=builder /deps/node_modules/pg /app/node_modules/pg
COPY --from=builder /deps/node_modules/drizzle-orm /app/node_modules/drizzle-orm
COPY --from=builder /deps/node_modules/@neondatabase /app/node_modules/@neondatabase

# Guard the final merged runtime tree as the dependency copy above may share pnpm package paths.
RUN test -n "$(find -L /app/node_modules/.pnpm \
      -path '*/next@*/node_modules/@swc/helpers/esm/_interop_require_default.js' \
      -print -quit)"

# Copy server launcher and shared scripts
COPY --from=builder /app/scripts/serverLauncher/startServer.js /app/startServer.js
COPY --from=builder /app/scripts/_shared /app/scripts/_shared

# /app/.elasticsearch-reindex is the default checkpoint directory of the Elasticsearch reindex
# command. Creating it here lets a Docker named volume mounted on it inherit nextjs ownership so
# the one-off Compose service can write checkpoints without running as root.
RUN set -e && \
    addgroup -S -g 1001 nodejs && \
    adduser -D -G nodejs -H -S -h /app -u 1001 nextjs && \
    mkdir -p /app/.elasticsearch-reindex && \
    chown -R nextjs:nodejs /app /etc/proxychains4.conf

## Trusted heterogeneous-agent harness. Runtime packages are official pinned
## releases; Fab contributes only the operation/tenant authorization adapter.
FROM nousresearch/hermes-agent:v2026.8.31 AS harness

ARG USE_CN_MIRROR="true"
ARG COMHUB_COMMIT_SHA=""
ARG COMHUB_IMAGE_TAG=""

RUN set -e && \
    if [ "${USE_CN_MIRROR}" = "true" ]; then npm config set registry https://registry.npmmirror.com/; fi && \
    npm install --global \
      @openai/codex@0.157.1 \
      @deepseek-ai/dsh@0.1.7-rc.2 \
      openclaw@2026.8.2 && \
    ln -sf /opt/hermes/.venv/bin/hermes /usr/local/bin/hermes

COPY --from=builder /app/apps/cli/dist/index.js /opt/fab-harness/index.js
COPY --from=builder /app/apps/cli/package.json /opt/package.json

LABEL org.opencontainers.image.revision="${COMHUB_COMMIT_SHA}"

ENV NODE_ENV="production" \
    HOME="/var/lib/fab-harness" \
    FAB_HARNESS_DATA_ROOT="/var/lib/fab-harness" \
    HERMES_HOME="/var/lib/fab-harness/hermes" \
    HERMES_WRITE_SAFE_ROOT="/var/lib/fab-harness" \
    COMHUB_COMMIT_SHA="${COMHUB_COMMIT_SHA}" \
    COMHUB_IMAGE_TAG="${COMHUB_IMAGE_TAG}"

RUN useradd --system --uid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin fab-harness && \
    mkdir -p /var/lib/fab-harness && \
    chown fab-harness:fab-harness /var/lib/fab-harness && \
    chmod 700 /var/lib/fab-harness

USER fab-harness

ENTRYPOINT ["node", "/opt/fab-harness/index.js", "harness"]
CMD ["--help"]

## Production image, copy all the files and run next
FROM scratch AS production

## Build metadata: bake common target now maps bake variable COMMIT_SHA to
## COMHUB_COMMIT_SHA (r1 root cause: bake emitted an extra COMMIT_SHA arg that
## no ARG consumed, so COMHUB_COMMIT_SHA stayed at its "unknown" default).
## This alias keeps a direct `docker build --build-arg COMMIT_SHA=...` path
## resolvable as well (fix 2026-10-19).
ARG COMMIT_SHA=""
ARG COMHUB_COMMIT_SHA=""
ARG COMHUB_BUILD_BRANCH=""
ARG COMHUB_BUILD_AT=""
ARG COMHUB_IMAGE_TAG=""

LABEL org.opencontainers.image.revision="${COMHUB_COMMIT_SHA}"
ARG COMHUB_IMAGE_REF=""

# Copy all the files from app, set the correct permission for prerender cache
COPY --from=app / /

ENV NODE_ENV="production" \
    NODE_OPTIONS="--dns-result-order=ipv4first --use-openssl-ca" \
    NODE_EXTRA_CA_CERTS="" \
    NODE_TLS_REJECT_UNAUTHORIZED="" \
    SSL_CERT_FILE="/etc/ssl/certs/ca-certificates.crt"

# Make the middleware rewrite through local as default
# refs: https://github.com/lobehub/lobehub/issues/5876
ENV MIDDLEWARE_REWRITE_THROUGH_LOCAL="1"

# set hostname to localhost
ENV HOSTNAME="0.0.0.0" \
    PORT="3210"

# Safe deployment metadata exposed by /api/version for post-deploy verification
ENV COMHUB_COMMIT_SHA="${COMHUB_COMMIT_SHA}" \
    COMHUB_BUILD_BRANCH="${COMHUB_BUILD_BRANCH}" \
    COMHUB_BUILD_AT="${COMHUB_BUILD_AT}" \
    COMHUB_IMAGE_TAG="${COMHUB_IMAGE_TAG}" \
    COMHUB_IMAGE_REF="${COMHUB_IMAGE_REF}"

# General Variables
ENV APP_URL="" \
    DEFAULT_AGENT_CONFIG="" \
    SYSTEM_AGENT="" \
    FEATURE_FLAGS="" \
    PROXY_URL=""

# Database
ENV DATABASE_DRIVER="node" \
    DATABASE_URL=""

# Redis
ENV REDIS_URL="" \
    REDIS_PREFIX="" \
    REDIS_TLS=""

# Email
ENV EMAIL_SERVICE_PROVIDER="" \
    SMTP_HOST="" \
    SMTP_PORT="" \
    SMTP_SECURE="" \
    SMTP_USER="" \
    SMTP_FROM="" \
    RESEND_FROM=""

# S3
ENV NEXT_PUBLIC_S3_DOMAIN="" \
    S3_PUBLIC_DOMAIN="" \
    S3_BUCKET="" \
    S3_ENDPOINT="" \
    S3_ENABLE_PATH_STYLE="" \
    S3_SET_ACL=""

# Cloud Sandbox
ENV SANDBOX_PROVIDER="" \
    ONLYBOXES_BASE_URL="" \
    ONLYBOXES_JIT_ISSUER="" \
    ONLYBOXES_JIT_TTL_SEC="" \
    ONLYBOXES_LEASE_TTL_SEC=""

# Model Variables
ENV \
    # AI21
    AI21_MODEL_LIST="" \
    # Ai360
    AI360_MODEL_LIST="" \
    # AiHubMix
    AIHUBMIX_MODEL_LIST="" AIHUBMIX_PROXY_URL="" \
    # Anthropic
    ANTHROPIC_CLIENT_TIMEOUT="" ANTHROPIC_MODEL_LIST="" ANTHROPIC_PROXY_URL="" \
    # Amazon Bedrock
    ENABLED_AWS_BEDROCK="" AWS_REGION="" AWS_BEDROCK_MODEL_LIST="" \
    # Azure OpenAI
    AZURE_API_VERSION="" AZURE_ENDPOINT="" AZURE_MODEL_LIST="" \
    # Baichuan
    BAICHUAN_MODEL_LIST="" \
    # Cloudflare
    CLOUDFLARE_BASE_URL_OR_ACCOUNT_ID="" CLOUDFLARE_MODEL_LIST="" \
    # Cohere
    COHERE_MODEL_LIST="" COHERE_PROXY_URL="" \
    # ComfyUI
    ENABLED_COMFYUI="" COMFYUI_BASE_URL="" \
    COMFYUI_USERNAME="" COMFYUI_CUSTOM_HEADERS="" \
    # DeepSeek
    DEEPSEEK_MODEL_LIST="" \
    # Fireworks AI
    FIREWORKSAI_MODEL_LIST="" \
    # Gitee AI
    GITEE_AI_MODEL_LIST="" \
    # GitHub
    GITHUB_MODEL_LIST="" \
    # Google
    GOOGLE_MODEL_LIST="" GOOGLE_PROXY_URL="" \
    # Vertex AI
    VERTEXAI_PROJECT="" VERTEXAI_LOCATION="" VERTEXAI_MODEL_LIST="" \
    # Groq
    GROQ_MODEL_LIST="" GROQ_PROXY_URL="" \
    # Higress
    HIGRESS_MODEL_LIST="" HIGRESS_PROXY_URL="" \
    # HuggingFace
    HUGGINGFACE_MODEL_LIST="" HUGGINGFACE_PROXY_URL="" \
    # Hunyuan
    HUNYUAN_MODEL_LIST="" \
    # InternLM
    INTERNLM_MODEL_LIST="" \
    # Jina
    JINA_MODEL_LIST="" JINA_PROXY_URL="" \
    # Minimax
    MINIMAX_MODEL_LIST="" \
    # Mistral
    MISTRAL_MODEL_LIST="" \
    # ModelScope
    MODELSCOPE_MODEL_LIST="" MODELSCOPE_PROXY_URL="" \
    # Moonshot
    MOONSHOT_MODEL_LIST="" MOONSHOT_PROXY_URL="" \
    # Nebius
    NEBIUS_MODEL_LIST="" NEBIUS_PROXY_URL="" \
    # NewAPI
    NEWAPI_PROXY_URL="" \
    # Novita
    NOVITA_MODEL_LIST="" \
    # Nvidia NIM
    NVIDIA_MODEL_LIST="" NVIDIA_PROXY_URL="" \
    # Ollama
    ENABLED_OLLAMA="" OLLAMA_MODEL_LIST="" OLLAMA_PROXY_URL="" \
    # OpenAI
    ENABLED_OPENAI="" OPENAI_MODEL_LIST="" OPENAI_PROXY_URL="" \
    # OpenRouter
    OPENROUTER_MODEL_LIST="" \
    # Perplexity
    PERPLEXITY_MODEL_LIST="" PERPLEXITY_PROXY_URL="" \
    # PPIO
    PPIO_MODEL_LIST="" \
    # Qiniu
    QINIU_MODEL_LIST="" QINIU_PROXY_URL="" \
    # Qwen
    QWEN_MODEL_LIST="" QWEN_PROXY_URL="" \
    # SambaNova
    SAMBANOVA_MODEL_LIST="" \
    # Meta
    META_MODEL_LIST="" META_PROXY_URL="" \
    # Search1API
    SEARCH1API_MODEL_LIST="" \
    # SenseNova
    SENSENOVA_MODEL_LIST="" \
    # SiliconCloud
    SILICONCLOUD_MODEL_LIST="" SILICONCLOUD_PROXY_URL="" \
    # Spark
    SPARK_MODEL_LIST="" SPARK_PROXY_URL="" SPARK_SEARCH_MODE="" \
    # Stepfun
    STEPFUN_MODEL_LIST="" \
    # Taichu
    TAICHU_MODEL_LIST="" \
    # TogetherAI
    TOGETHERAI_MODEL_LIST="" \
    # Unsloth
    UNSLOTH_MODEL_LIST="" UNSLOTH_PROXY_URL="" \
    # Upstage
    UPSTAGE_MODEL_LIST="" \
    # v0 (Vercel)
    V0_MODEL_LIST="" \
    # vLLM
    VLLM_MODEL_LIST="" VLLM_PROXY_URL="" \
    # Wenxin
    WENXIN_MODEL_LIST="" \
    # xAI
    XAI_MODEL_LIST="" XAI_PROXY_URL="" \
    # Xinference
    XINFERENCE_MODEL_LIST="" XINFERENCE_PROXY_URL="" \
    # 01.AI
    ZEROONE_MODEL_LIST="" \
    # Zhipu
    ZHIPU_MODEL_LIST="" \
    # Tencent Cloud
    TENCENT_CLOUD_MODEL_LIST="" \
    # Infini-AI
    INFINIAI_MODEL_LIST="" \
    # 302.AI
    AI302_MODEL_LIST="" \
    # FAL
    ENABLED_FAL="" FAL_MODEL_LIST="" \
    # BFL
    BFL_MODEL_LIST="" \
    # Vercel AI Gateway
    VERCELAIGATEWAY_MODEL_LIST="" \
    # Cerebras
    CEREBRAS_MODEL_LIST=""

USER nextjs

EXPOSE 3210/tcp

ENTRYPOINT ["/bin/node"]

CMD ["/app/startServer.js"]
