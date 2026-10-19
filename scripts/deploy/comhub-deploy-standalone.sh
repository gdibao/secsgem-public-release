#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/www/wwwroot/comhub/app}
ROOT_DIR=${ROOT_DIR:-/www/wwwroot/comhub}
PKG=${1:-${PKG:-/tmp/comhub-latest-app.tar.gz}}
PORT=${PORT:-3210}
APP_HOST=${APP_HOST:-0.0.0.0}
NODE=${NODE:-/usr/local/bin/node}

TS=$(date +%Y%m%d-%H%M%S)
BACKUP=${ROOT_DIR}/app.backup-${TS}
ENV_BAK=/tmp/comhub-env-${TS}

echo "== verify package =="
test -s "$PKG"
ls -lh "$PKG"

echo "== stop old app if running =="
stop_pid() {
  local pid="$1"

  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  kill "$pid" 2>/dev/null || true
  for _ in $(seq 1 15); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" 2>/dev/null || true
  for _ in $(seq 1 5); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
}

stop_port_listeners() {
  local pids

  for _ in $(seq 1 5); do
    pids=$(ss -ltnp 2>/dev/null | awk -v port=":${PORT}" '$4 ~ port {print $0}' | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u || true)
    if [ -z "$pids" ]; then
      return 0
    fi

    for pid in $pids; do
      stop_pid "$pid"
    done
    sleep 1
  done
}

if [ -s "$APP_DIR/app.pid" ]; then
  stop_pid "$(cat "$APP_DIR/app.pid")"
fi

pkill -f "${APP_DIR}/.*server\\.js" 2>/dev/null || true
pkill -f "${APP_DIR}/.*startServer\\.js" 2>/dev/null || true

stop_port_listeners

sleep 1
if ss -ltnp | grep ":${PORT}"; then
  echo "ERROR: port ${PORT} is still in use after stopping old app" >&2
  exit 1
fi

echo "== backup env and current app =="
test -f "$APP_DIR/.env"
cp -a "$APP_DIR/.env" "$ENV_BAK"
mv "$APP_DIR" "$BACKUP"
mkdir -p "$APP_DIR"

echo "== extract new app =="
tar -xzf "$PKG" -C "$APP_DIR"
cp -a "$ENV_BAK" "$APP_DIR/.env"
chmod 600 "$APP_DIR/.env" || true

echo "== verify deployed manifest =="
grep -q "spa/\\[variants\\]/\\[\\[\\.\\.\\.path\\]\\]/route" "$APP_DIR/.next/server/app-paths-manifest.json"
grep -q "\\[variants\\]/(auth)/signin/page" "$APP_DIR/.next/server/app-paths-manifest.json"
grep -q "(backend)/api/version/route" "$APP_DIR/.next/server/app-paths-manifest.json"
ls -lh "$APP_DIR/server.js" "$APP_DIR/.env"

echo "== migrate database, no build =="
cd "$APP_DIR"
set -a
. ./.env
set +a
if [ -n "${DATABASE_DRIVER:-}" ] && [ -f docker.cjs ]; then
  "$NODE" docker.cjs
fi

echo "== start node standalone =="
PORT="$PORT" HOSTNAME="$APP_HOST" NODE_ENV=production nohup "$NODE" server.js > start.log 2>&1 &
echo $! > app.pid
sleep 5
LISTENER_LINE=$(ss -ltnp | grep ":${PORT}")
echo "$LISTENER_LINE"
LISTENER_PID=$(echo "$LISTENER_LINE" | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | head -1)
if [ -n "$LISTENER_PID" ]; then
  echo "$LISTENER_PID" > app.pid
fi
curl -I --max-time 15 "http://127.0.0.1:${PORT}/" | head -20
curl --max-time 15 "http://127.0.0.1:${PORT}/api/version" | head -c 500 || true
echo "bind_host=$APP_HOST"

echo ""
echo "== done =="
echo "backup=$BACKUP"
