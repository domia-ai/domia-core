#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

acl_on() {
  [ -f config/mqtt/acl.txt ] && echo "✅ config/mqtt/acl.txt exists (edit it: one 'user' block per node)" \
    || { cp config/mqtt/acl.example config/mqtt/acl.txt; echo "📝 seeded config/mqtt/acl.txt from acl.example — edit the user blocks (node usernames, identity keys, nodeIds)"; }
  mkdir -p config/mqtt/conf.d
  printf 'acl_file /mosquitto/config/acl.txt\n' > config/mqtt/conf.d/acl.conf
  grep -q "include_dir /mosquitto/config/conf.d" config/mqtt/mosquitto.conf \
    || printf '\ninclude_dir /mosquitto/config/conf.d\n' >> config/mqtt/mosquitto.conf
  echo "✅ ACLs enabled (conf.d/acl.conf + include_dir in mosquitto.conf)"
  docker run --rm -v "$(pwd)/config/mqtt:/mosquitto/config:ro" eclipse-mosquitto \
    mosquitto -c /mosquitto/config/mosquitto.conf --test-config >/dev/null 2>&1 \
    && echo "✅ broker config + ACL parse OK" || echo "⚠️ broker config test failed — run: docker run --rm -v \$(pwd)/config/mqtt:/mosquitto/config:ro eclipse-mosquitto mosquitto -c /mosquitto/config/mosquitto.conf --test-config"
  docker compose ps --status running mosquitto 2>/dev/null | grep -q mosquitto \
    && { docker compose restart mosquitto >/dev/null && echo "🔄 mosquitto restarted with ACLs"; } \
    || echo "ℹ️  broker not running — ACLs apply on next: make mosquitto"
}

acl_off() {
  rm -f config/mqtt/conf.d/acl.conf
  sed -i.bak '/include_dir \/mosquitto\/config\/conf.d/d' config/mqtt/mosquitto.conf && rm -f config/mqtt/mosquitto.conf.bak
  echo "✅ ACLs disabled (conf.d/acl.conf + include_dir removed; restart the broker to apply)"
}

case "${1:-}" in
  acl) acl_on ;;
  acl-off) acl_off ;;
  *) echo "usage: bash scripts/mosquitto.sh {acl|acl-off}" >&2; exit 2 ;;
esac
