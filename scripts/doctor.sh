#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

DOMIA_ENV="${DOMIA_ENV:-.env}"
LLM_PORT="${LLM_PORT:-11435}"
NEMO_PORT="${NEMO_PORT:-8600}"

check_services() {
  echo "🩺 Runtime services:"
  (command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 1883 >/dev/null 2>&1) && echo "✅ MQTT broker on :1883" || echo "ℹ️  no MQTT broker on 127.0.0.1:1883 (fine if your nodes point at a broker elsewhere; local one: make mosquitto)"
  curl -sf -m 2 "http://127.0.0.1:$LLM_PORT/health" >/dev/null 2>&1 && echo "✅ llama-server on :$LLM_PORT" || echo "❌ llama-server not answering on :$LLM_PORT → make llm-service   (or docker compose up -d ollama && switch llm.engine to OLLAMA)"
  curl -sf -m 2 "http://127.0.0.1:$NEMO_PORT/v1/models" >/dev/null 2>&1 && echo "✅ nemo-speech on :$NEMO_PORT" || echo "ℹ️  nemo-speech not answering on :$NEMO_PORT (only needed for the NEMO_SPEECH STT engine) → make nemo-service"
  [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && {
    echo "🔁 Survives a reboot (systemd enabled):"
    for u in domia llama-server; do
      st=$(systemctl is-enabled "$u" 2>/dev/null)
      [ -n "$st" ] || st="not-installed"
      printf "   %-13s %s\n" "$u" "$st"
    done
    st=$(systemctl --user is-enabled nemo-speech 2>/dev/null)
    [ -n "$st" ] || st="not-installed"
    printf "   %-13s %s (user unit, linger=%s)\n" nemo-speech "$st" "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)"
    echo "   (missing/disabled → make install-services)"
  } || true
}

check_doctor() {
  echo "🧪 Checking system-level binaries..."
  command -v sox >/dev/null 2>&1 && echo "✅ sox found" || { echo "❌ sox not found. Run: make install-deps"; exit 1; }
  command -v node >/dev/null 2>&1 && echo "✅ node found ($(node --version))" || { echo "❌ node not found"; exit 1; }
  command -v docker >/dev/null 2>&1 && echo "✅ docker found" || echo "ℹ️  docker not found (optional — only for the container path: make up / ollama / mosquitto)"
  docker compose version >/dev/null 2>&1 && echo "✅ docker compose found ($(docker compose version --short))" || echo "ℹ️  docker compose (v2) not found (optional — Docker Desktop bundles it; on Linux: sudo apt install docker-compose-v2)"
  check_posture
  echo "🎯 System checks passed."
}

check_posture() {
  echo "🔒 Posture ($DOMIA_ENV):"
  [ -f "$DOMIA_ENV" ] || { echo "ℹ️  $DOMIA_ENV not found — cp .env.example .env"; return 0; }
  v() { grep -E "^$1=" "$DOMIA_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'"; }
  cert=$(v DOMIA_TLS_CERT_FILE); key=$(v DOMIA_TLS_KEY_FILE); ca=$(v DOMIA_TLS_CA_FILE)
  if [ -n "$cert" ] && [ -n "$key" ]; then
    if [ -r "$cert" ] && [ -r "$key" ]; then
      exp=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)
      echo "✅ TLS on: HTTPS + gRPC TLS (cert $cert, expires ${exp:-?}; CA ${ca:-system trust})"
      [ -n "$ca" ] && [ ! -r "$ca" ] && echo "⚠️ DOMIA_TLS_CA_FILE=$ca is not readable"
      [ "$(v DOMIA_TLS_REQUIRE_CLIENT_CERT)" = "1" ] && echo "✅ mTLS: peers must present a client cert" || echo "ℹ️  client certs not required (DOMIA_TLS_REQUIRE_CLIENT_CERT=1 to enforce)"
    else echo "❌ TLS configured but cert/key unreadable ($cert / $key) — the node will refuse to boot"; fi
  else echo "ℹ️  TLS off — plaintext HTTP + gRPC on the LAN (make dev-certs, then set DOMIA_TLS_* in $DOMIA_ENV)"; fi
  secret=$(v DOMIA_MESH_SECRET); next=$(v DOMIA_MESH_SECRET_NEXT)
  case "$secret" in ""|*change-me*) echo "⚠️ DOMIA_MESH_SECRET is unset or the example default — set a long random secret on every node" ;;
    *) [ ${#secret} -ge 32 ] && echo "✅ mesh secret set (${#secret} chars)" || echo "⚠️ mesh secret is short (${#secret} chars) — 32+ recommended" ;; esac
  [ -n "$next" ] && echo "🔄 mesh secret rotation in progress (DOMIA_MESH_SECRET_NEXT set) — POST /mesh/rotate shows the grace window" || true
  if grep -rqs '^acl_file ' config/mqtt/conf.d config/mqtt/mosquitto.conf 2>/dev/null; then echo "✅ MQTT ACLs enabled (config/mqtt/acl.txt)"
  else echo "ℹ️  MQTT ACLs off — every broker user may publish any topic (make mosquitto-acl to opt in)"; fi
  grep -q '^allow_anonymous false' config/mqtt/mosquitto.conf 2>/dev/null && echo "✅ MQTT anonymous access disabled" || echo "⚠️ MQTT allows anonymous clients"
  otel=$(v DOMIA_OTEL_EXPORTER_URL)
  [ -n "$otel" ] && echo "✅ OpenTelemetry traces → $otel" || echo "ℹ️  OpenTelemetry off (DOMIA_OTEL_EXPORTER_URL unset — nothing loaded)"
}

check_jetson() {
  echo "🔬 Checking Jetson prerequisites..."
  [ -x /usr/local/cuda/bin/nvcc ] && echo "✅ CUDA toolkit ($(/usr/local/cuda/bin/nvcc --version | grep -oE 'release [0-9.]+'))" || { echo "❌ CUDA toolkit missing (needed to compile llama.cpp). Run: sudo apt install -y nvidia-jetpack"; exit 1; }
  command -v cmake >/dev/null 2>&1 && echo "✅ cmake found" || { echo "❌ cmake not found. Run: sudo apt install -y cmake"; exit 1; }
  command -v git >/dev/null 2>&1 && echo "✅ git found" || { echo "❌ git not found"; exit 1; }
  mode=$(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs)
  if [ "$mode" = "MAXN_SUPER" ] || [ "$mode" = "MAXN" ]; then echo "✅ power mode: $mode"
  else echo "⚠️ power mode: ${mode:-unknown} — for best LLM speed run: sudo nvpmodel -m 2 (MAXN_SUPER)"; fi
  avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  if [ "$avail" -ge 1024 ]; then echo "✅ memory available: ${avail}MB"
  else echo "⚠️ only ${avail}MB available — close heavy processes before building/serving"; fi
  if swapon --show 2>/dev/null | grep -q .; then echo "✅ swap active"
  else echo "⚠️ no swap — recommended on 8GB (memory spikes can OOM-kill services):"
    echo "   sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"; fi
  echo "🎯 Jetson checks passed."
}

case "${1:-}" in
  services) check_services ;;
  doctor) check_doctor ;;
  posture) check_posture ;;
  jetson) check_jetson ;;
  *) echo "usage: bash scripts/doctor.sh {services|doctor|posture|jetson}" >&2; exit 2 ;;
esac
