#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS="3100 3101 5052 5053"
PATTERNS="ts-node.*src/index nodemon.*src/index ts-node.*src/cli/dev dotenvx.*src/index node.*build/index"

have_lsof=0
command -v lsof >/dev/null 2>&1 && have_lsof=1

echo "🛑 Stopping DOMIA processes rooted at $ROOT..."

in_repo() {
  local cmd
  cmd="$(ps -p "$1" -o command= 2>/dev/null || true)"
  case "$cmd" in
    *"$ROOT"*) return 0 ;;
    *) return 1 ;;
  esac
}

PIDS=""
add_pid() {
  case " $PIDS " in
    *" $1 "*) ;;
    *) PIDS="$PIDS $1" ;;
  esac
}

for pattern in $PATTERNS; do
  for pid in $(pgrep -f "$pattern" 2>/dev/null || true); do
    in_repo "$pid" && add_pid "$pid"
  done
done

if [ "$have_lsof" -eq 1 ]; then
  for port in $PORTS; do
    for pid in $(lsof -ti ":$port" 2>/dev/null || true); do
      in_repo "$pid" && add_pid "$pid"
    done
  done
fi

PIDS="$(echo "$PIDS" | xargs || true)"

if [ -z "$PIDS" ]; then
  echo "✅ Nothing to stop"
  exit 0
fi

echo "  - sending SIGTERM to: $PIDS"
# shellcheck disable=SC2086
kill -TERM $PIDS 2>/dev/null || true
sleep 3

REMAINING=""
for pid in $PIDS; do
  kill -0 "$pid" 2>/dev/null && REMAINING="$REMAINING $pid"
done
REMAINING="$(echo "$REMAINING" | xargs || true)"

if [ -n "$REMAINING" ]; then
  echo "  - SIGKILL to survivors: $REMAINING"
  # shellcheck disable=SC2086
  kill -KILL $REMAINING 2>/dev/null || true
fi

if [ "$have_lsof" -eq 1 ]; then
  sleep 1
  STUCK=""
  for port in $PORTS; do
    for pid in $(lsof -ti ":$port" 2>/dev/null || true); do
      in_repo "$pid" && STUCK="$STUCK $port($pid)"
    done
  done
  if [ -n "$STUCK" ]; then
    echo "⚠️  Ports still in use:$STUCK"
    exit 1
  fi
else
  echo "  (lsof not found — skipped port verification)"
fi

echo "✅ All DOMIA processes stopped"
