#!/usr/bin/env bash
set -euo pipefail

# Run only in a dedicated checkout of an immutable release tag.
root="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$root"
version="${1:-}"
if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+-chituo\.[0-9]+$ ]]; then
  printf '%s\n' 'Usage: bash apps/desktop/scripts/packageChituoMac.sh <version-chituo.N>' >&2
  exit 1
fi
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'A real macOS build host is required; no files were changed.' >&2
  exit 1
fi
test -z "$(git status --porcelain --untracked-files=no)"
test "$(git rev-parse HEAD)" = "$(git rev-list -n 1 "v$version")"
test "$(node --version)" = v24.18.0
test "$(pnpm --version)" = 10.33.0
test ! -e .env
test ! -e apps/desktop/.env
test "$(shasum -a 256 apps/desktop/branding/chituo/logo.png | awk '{print $1}')" = \
  527f73df2df1515be0f9b5b13cb87ec2dfef333fc7b1e44eedb2c2899461a44d
if [ -d apps/desktop/release ] && [ -n "$(ls -A apps/desktop/release)" ]; then
  printf '%s\n' 'Release directory is not empty; use a fresh checkout, do not overwrite artifacts.' >&2
  exit 1
fi

export NODE_OPTIONS=--max-old-space-size=16384
export DESKTOP_BUILD_PROFILE_PATH="$root/apps/desktop/branding/chituo/desktop-build-profile.json"
export OFFICIAL_CLOUD_SERVER=https://fab.secsgem.com.cn
export UPDATE_SERVER_URL=''
export UPDATE_CHANNEL=stable
export CSC_IDENTITY_AUTO_DISCOVERY=false
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
export npm_config_registry=https://registry.npmmirror.com
unset CSC_LINK CSC_KEY_PASSWORD

# Same dependency setup as the repository's desktop-build-setup action.
pnpm install --node-linker=hoisted
npm run install-isolated --prefix ./apps/desktop
pnpm workflow:set-desktop-version "$version" stable
VERSION="$version" node --input-type=module - <<'NODE'
import fs from 'node:fs';
const file = 'apps/cli/package.json';
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
pkg.version = process.env.VERSION;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
NODE
(
  cd apps/desktop
  node ../../node_modules/vitest/vitest.mjs run desktop-build-profile.test.ts --config vitest.config.mts
)
npm run package:mac --prefix ./apps/desktop -- --c.mac.notarize=false -c.mac.identity=null

arch="$(node -p 'process.arch')"
node apps/desktop/scripts/validatePackagedIdentity.mjs apps/desktop/release
extracted="$(mktemp -d "${TMPDIR:-/tmp}/chituo-mac-check.XXXXXX")"
trap 'rm -rf "$extracted"' EXIT
shopt -s nullglob
archives=(apps/desktop/release/*"-$arch.zip")
images=(apps/desktop/release/*"-$arch.dmg")
test "${#archives[@]}" -eq 1
test "${#images[@]}" -eq 1
test -s "${archives[0]}"
test -s "${images[0]}"
ditto -x -k "${archives[0]}" "$extracted"
node apps/desktop/scripts/validatePackagedIdentity.mjs "$extracted"
node apps/desktop/scripts/validatePackagedRuntime.mjs "$extracted" darwin "$arch"
(
  cd apps/desktop/release
  shasum -a 256 *"-$arch.dmg" *"-$arch.zip" > "SHA256SUMS-macos-$arch"
)
printf '%s\n' 'Unsigned artifacts validated locally; not uploaded or GUI/device-tested.'
