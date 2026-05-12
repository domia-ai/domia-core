#!/usr/bin/env bash
set -uo pipefail

PORTS=(3000 3001 5052 5053)
PATTERNS=(
  "domia-core.*ts-node.*src/index"
  "nodemon.*src/index"
  "ts-node.*src/cli/dev"
  "dotenvx.*src/index"
)

killed_any=0

echo "🛑 Stopping DOMIA processes..."

for pattern in "${PATTERNS[@]}"; do
  pids=$(pgrep -f "$pattern" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  - pattern '$pattern': killing PIDs $pids"
    echo "$pids" | xargs -r kill -9 2>/dev/null || true
    killed_any=1
  fi
done

for port in "${PORTS[@]}"; do
  pids=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "  - port $port: killing PIDs $pids"
    echo "$pids" | xargs -r kill -9 2>/dev/null || true
    killed_any=1
  fi
done

sleep 1

remaining=""
for port in "${PORTS[@]}"; do
  pid=$(lsof -ti ":$port" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    remaining="$remaining $port($pid)"
  fi
done

if [ -n "$remaining" ]; then
  echo "⚠️  Ports still in use:$remaining"
  exit 1
fi

if [ $killed_any -eq 0 ]; then
  echo "✅ Nothing to stop"
else
  echo "✅ All DOMIA processes stopped, ports 3000/3001/5052/5053 free"
fi
