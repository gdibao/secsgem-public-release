#!/usr/bin/env bash
set -euo pipefail

workspace="${GDIBAO_WORKSPACE:-/home/kaifa/ai.gdibao.com}"
root="$workspace/work/industry-official-site-search-v2/machine-run"
status_file="$root/status.json"
log_file="$root/runner.out"
runner="$workspace/gdibao-site/tools/run-official-site-search-workers.mjs"
unit="gdibao-official-site-search.service"

is_running() {
  systemctl --user is-active --quiet "$unit"
}

case "${1:-status}" in
  start)
    mkdir -p "$root"
    if is_running; then
      printf 'already running pid=%s\n' "$(systemctl --user show -p MainPID --value "$unit")"
      exit 0
    fi
    if [[ -e "$root/run.lock" ]]; then
      lock_pid="$(sed -n 's/.*"pid":\([0-9][0-9]*\).*/\1/p' "$root/run.lock")"
      if [[ -n "$lock_pid" ]] && kill -0 "$lock_pid" 2>/dev/null; then
        printf 'live lock requires review: %s pid=%s\n' "$root/run.lock" "$lock_pid" >&2
        exit 1
      fi
      unlink "$root/run.lock"
    fi
    : > "$log_file"
    systemd-run --user --unit="$unit" --collect --quiet \
      --property="WorkingDirectory=$workspace" \
      --property="StandardOutput=append:$log_file" \
      --property="StandardError=append:$log_file" \
      /usr/bin/node "$runner" \
      --output="$root" \
      --workers=8 \
      --search-concurrency=2 \
      --fetch-concurrency=12 \
      --search-delay=2200 \
      --domain-delay=750
    sleep 1
    if ! is_running; then
      printf 'runner failed to stay alive; inspect %s\n' "$log_file" >&2
      exit 1
    fi
    printf 'started pid=%s status=%s log=%s\n' "$(systemctl --user show -p MainPID --value "$unit")" "$status_file" "$log_file"
    ;;
  status)
    if is_running; then
      printf 'running pid=%s\n' "$(systemctl --user show -p MainPID --value "$unit")"
    else
      printf 'not running\n'
    fi
    [[ -f "$status_file" ]] && cat "$status_file"
    ;;
  stop)
    if ! is_running; then
      printf 'not running\n'
      exit 0
    fi
    pid="$(systemctl --user show -p MainPID --value "$unit")"
    systemctl --user stop "$unit"
    printf 'stop requested pid=%s\n' "$pid"
    ;;
  *)
    printf 'usage: %s {start|status|stop}\n' "$0" >&2
    exit 2
    ;;
esac
