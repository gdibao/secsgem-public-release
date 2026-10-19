#!/usr/bin/env bash
set -euo pipefail

SRC=${SRC:-/mnt/e/code/comhub/lobehub}
TAG=${TAG:-$(date +%Y%m%d-%H%M%S)}
BUILD=${BUILD:-/mnt/e/code/comhub/comhub-wsl-build-${TAG}}
DIST=${DIST:-${SRC}/dist-deploy}
DEPS=${DEPS:-/mnt/e/code/comhub/comhub-wsl-deps-${TAG}}
PKGNAME="comhub-${TAG}-app"
PKGDIR="${DIST}/${PKGNAME}"
TAR="${DIST}/${PKGNAME}.tar.gz"

echo "== rsync source to ${BUILD} =="
mkdir -p "${BUILD}" "${DIST}"
rsync -a --delete \
  --exclude .git \
  --exclude node_modules \
  --exclude .next \
  --exclude /app \
  --exclude dist \
  --exclude dist-deploy \
  --exclude 'deploy-extract-*' \
  --exclude 'tmp-*' \
  --exclude .codex-run \
  "${SRC}/" "${BUILD}/"

cd "${BUILD}"

echo "== install dependencies =="
export HUSKY=0
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export ELECTRON_SKIP_BINARY_DOWNLOAD=1
export SENTRYCLI_CDNURL=https://npmmirror.com/mirrors/sentry-cli
npm config set registry https://registry.npmmirror.com/
printf 'canvas_binary_host_mirror=https://npmmirror.com/mirrors/canvas\n' >> .npmrc
pnpm install

echo "== install migration runtime deps =="
mkdir -p "${DEPS}"
cd "${DEPS}"
printf '{"name":"deps","version":"1.0.0","private":true}\n' > package.json
pnpm add pg drizzle-orm
cd "${BUILD}"

echo "== build standalone =="
export NODE_OPTIONS=--max-old-space-size=16384
export APP_URL=http://app.com
export DATABASE_DRIVER=node
export DATABASE_URL=postgres://postgres:password@localhost:5432/postgres
export KEY_VAULTS_SECRET=dXNlLWZvci1idWlsZC1rZXktMzItYnl0ZXMtMDAwMDA=
export AUTH_SECRET=use-for-build-auth-secret-32-chars
export DOCKER=true
pnpm exec tsx scripts/dockerPrebuild.mts
rm -rf src/app/desktop 'src/app/(backend)/trpc/desktop'
pnpm run build:docker

echo "== assemble package ${PKGDIR} =="
rm -rf "${PKGDIR}" "${TAR}"
mkdir -p "${PKGDIR}"
cp -a .next/standalone/. "${PKGDIR}/"
mkdir -p "${PKGDIR}/.next"
cp -a .next/static "${PKGDIR}/.next/static"
mkdir -p "${PKGDIR}/public"
cp -a public/_spa "${PKGDIR}/public/_spa"
mkdir -p "${PKGDIR}/migrations" "${PKGDIR}/scripts"
cp -a packages/database/migrations/. "${PKGDIR}/migrations/"
cp -a scripts/migrateServerDB/docker.cjs "${PKGDIR}/docker.cjs"
cp -a scripts/migrateServerDB/errorHint.js "${PKGDIR}/errorHint.js"
cp -a scripts/serverLauncher/startServer.js "${PKGDIR}/startServer.js"
cp -a scripts/_shared "${PKGDIR}/scripts/_shared"

mkdir -p "${PKGDIR}/node_modules/.pnpm"
cp -a "${DEPS}/node_modules/.pnpm/." "${PKGDIR}/node_modules/.pnpm/"
rm -rf "${PKGDIR}/node_modules/pg" "${PKGDIR}/node_modules/drizzle-orm"
cp -a "${DEPS}/node_modules/pg" "${PKGDIR}/node_modules/pg"
cp -a "${DEPS}/node_modules/drizzle-orm" "${PKGDIR}/node_modules/drizzle-orm"

echo "== verify package =="
test -s "${PKGDIR}/server.js"
grep -q 'spa/\[variants\]/\[\[\.\.\.path\]\]/route' "${PKGDIR}/.next/server/app-paths-manifest.json"
grep -q '\[variants\]/(auth)/signin/page' "${PKGDIR}/.next/server/app-paths-manifest.json"
grep -q '(backend)/api/version/route' "${PKGDIR}/.next/server/app-paths-manifest.json"
grep -q '(backend)/trpc/lambda/\[trpc\]/route' "${PKGDIR}/.next/server/app-paths-manifest.json"

cd "${DIST}"
tar --numeric-owner -czf "${TAR}" -C "${PKGNAME}" .
ls -lh "${TAR}"
echo "PACKAGE=${TAR}"
