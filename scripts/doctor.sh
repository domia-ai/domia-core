#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 1

DOMIA_ENV="${DOMIA_ENV:-.env}"
LLM_PORT="${LLM_PORT:-11435}"
NEMO_PORT="${NEMO_PORT:-8600}"

env_value() { grep -E "^$1=" "$DOMIA_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d "\"'"; }

http_port() { local p; p=$(env_value HTTP_SERVER_PORT); echo "${p:-3100}"; }

unit_state() { local st; st=$("$@" 2>/dev/null); echo "${st:-not-installed}"; }

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
  cert=$(env_value DOMIA_TLS_CERT_FILE); key=$(env_value DOMIA_TLS_KEY_FILE); ca=$(env_value DOMIA_TLS_CA_FILE)
  if [ -n "$cert" ] && [ -n "$key" ]; then
    if [ -r "$cert" ] && [ -r "$key" ]; then
      exp=$(openssl x509 -enddate -noout -in "$cert" 2>/dev/null | cut -d= -f2)
      echo "✅ TLS on: HTTPS + gRPC TLS (cert $cert, expires ${exp:-?}; CA ${ca:-system trust})"
      [ -n "$ca" ] && [ ! -r "$ca" ] && echo "⚠️ DOMIA_TLS_CA_FILE=$ca is not readable"
      [ "$(env_value DOMIA_TLS_REQUIRE_CLIENT_CERT)" = "1" ] && echo "✅ mTLS: peers must present a client cert" || echo "ℹ️  client certs not required (DOMIA_TLS_REQUIRE_CLIENT_CERT=1 to enforce)"
    else echo "❌ TLS configured but cert/key unreadable ($cert / $key) — the node will refuse to boot"; fi
  else echo "ℹ️  TLS off — plaintext HTTP + gRPC on the LAN (make dev-certs, then set DOMIA_TLS_* in $DOMIA_ENV)"; fi
  secret=$(env_value DOMIA_MESH_SECRET); next=$(env_value DOMIA_MESH_SECRET_NEXT)
  case "$secret" in ""|*change-me*) echo "⚠️ DOMIA_MESH_SECRET is unset or the example default — set a long random secret on every node" ;;
    *) [ ${#secret} -ge 32 ] && echo "✅ mesh secret set (${#secret} chars)" || echo "⚠️ mesh secret is short (${#secret} chars) — 32+ recommended" ;; esac
  [ -n "$next" ] && echo "🔄 mesh secret rotation in progress (DOMIA_MESH_SECRET_NEXT set) — POST /mesh/rotate shows the grace window" || true
  if grep -rqs '^acl_file ' config/mqtt/conf.d config/mqtt/mosquitto.conf 2>/dev/null; then echo "✅ MQTT ACLs enabled (config/mqtt/acl.txt)"
  else echo "ℹ️  MQTT ACLs off — every broker user may publish any topic (make mosquitto-acl to opt in)"; fi
  grep -q '^allow_anonymous false' config/mqtt/mosquitto.conf 2>/dev/null && echo "✅ MQTT anonymous access disabled" || echo "⚠️ MQTT allows anonymous clients"
  otel=$(env_value DOMIA_OTEL_EXPORTER_URL)
  [ -n "$otel" ] && echo "✅ OpenTelemetry traces → $otel" || echo "ℹ️  OpenTelemetry off (DOMIA_OTEL_EXPORTER_URL unset — nothing loaded)"
}

jetson_gpu_mhz() { awk '{printf "%d", $1/1000000}' /sys/class/devfreq/17000000.gpu/cur_freq 2>/dev/null; }
jetson_gpu_max_mhz() { awk '{printf "%d", $1/1000000}' /sys/class/devfreq/17000000.gpu/max_freq 2>/dev/null; }
jetson_temp_c() { awk '{printf "%d", $1/1000}' "/sys/devices/virtual/thermal/$1/temp" 2>/dev/null; }
jetson_zone() { for z in /sys/devices/virtual/thermal/thermal_zone*; do [ "$(cat "$z/type" 2>/dev/null)" = "$1" ] && { basename "$z"; return; }; done; }
jetson_acr_failures() { journalctl -k -b 2>/dev/null | awk '/ACR bootstrap failed/{n++} END{print n+0}'; }
is_jetson() { [ -f /etc/nv_tegra_release ] || command -v nvpmodel >/dev/null 2>&1; }

check_jetson_runtime() {
  local mode gpu gpu_max tj gpu_t acr
  mode=$(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs)
  gpu=$(jetson_gpu_mhz); gpu_max=$(jetson_gpu_max_mhz)
  tj=$(jetson_temp_c "$(jetson_zone tj-thermal)"); gpu_t=$(jetson_temp_c "$(jetson_zone gpu-thermal)")
  acr=$(jetson_acr_failures)
  case "$mode" in MAXN*) echo "✅ power mode: $mode" ;; *) echo "⚠️ power mode: ${mode:-unknown} — for best LLM speed run: make jetson-power (nvpmodel + jetson_clocks)" ;; esac
  if [ -n "$gpu" ] && [ -n "$gpu_max" ]; then
    [ "$gpu" -ge $((gpu_max * 9 / 10)) ] && echo "✅ gpu clock: ${gpu}/${gpu_max} MHz" || echo "ℹ️  gpu clock: ${gpu}/${gpu_max} MHz (scaling with load — make jetson-power pins it)"
  fi
  if [ -n "$tj" ]; then
    if [ "$tj" -ge 85 ]; then echo "⚠️ thermal: tj ${tj}°C gpu ${gpu_t:-?}°C — throttling imminent (≥ 85°C), check the fan and airflow"
    else echo "✅ thermal: tj ${tj}°C gpu ${gpu_t:-?}°C"; fi
  fi
  if [ "$acr" -gt 0 ]; then echo "❌ GPU firmware: $acr 'ACR bootstrap failed' lines in this boot — every GPU consumer runs on CPU; only sudo reboot fixes it (docs/JETSON.md)"
  else echo "✅ GPU firmware: no ACR failures this boot"; fi
  if [ -r /sys/kernel/debug/nvmap/iovmm/clients ]; then
    echo "   gpu memory (NvMap): $(awk 'NR>1{s+=$NF} END{printf "%d MB", s/1048576}' /sys/kernel/debug/nvmap/iovmm/clients 2>/dev/null)"
  fi
}

check_jetson() {
  echo "🔬 Checking Jetson prerequisites..."
  [ -x /usr/local/cuda/bin/nvcc ] && echo "✅ CUDA toolkit ($(/usr/local/cuda/bin/nvcc --version | grep -oE 'release [0-9.]+'))" || { echo "❌ CUDA toolkit missing (needed to compile llama.cpp). Run: sudo apt install -y nvidia-jetpack"; exit 1; }
  command -v cmake >/dev/null 2>&1 && echo "✅ cmake found" || { echo "❌ cmake not found. Run: sudo apt install -y cmake"; exit 1; }
  command -v git >/dev/null 2>&1 && echo "✅ git found" || { echo "❌ git not found"; exit 1; }
  check_jetson_runtime
  avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  if [ "$avail" -ge 1024 ]; then echo "✅ memory available: ${avail}MB"
  else echo "⚠️ only ${avail}MB available — close heavy processes before building/serving"; fi
  if swapon --show=TYPE --noheadings 2>/dev/null | grep -qE 'file|partition'; then echo "✅ swap active ($(swapon --show=NAME,SIZE --noheadings | head -1 | xargs))"
  else
    swapon --show 2>/dev/null | grep -q . && echo "⚠️ only zram swap — compressed RAM cannot absorb a model spill; add a real swapfile:" || echo "⚠️ no swap — recommended on 8GB (memory spikes can OOM-kill services):"
    echo "   sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"; fi
  echo "🎯 Jetson checks passed."
}

log_file() {
  local f; f=$(env_value DOMIA_LOG_FILE)
  [ -n "$f" ] || { echo "❌ DOMIA_LOG_FILE is not set in $DOMIA_ENV" >&2; exit 1; }
  echo "$f"
}

render_log() {
  if command -v jq >/dev/null 2>&1; then
    jq -rR --unbuffered '(fromjson? | try ([.ts[11:19], (.level|.[0:4]), .ns, .msg, ((del(.ts,.level,.ns,.msg,.originDomiaKey,.traceId,.domiaId,.domiaKey,.interactionId) // {}) | tostring | .[0:160])] | @tsv)) // .'
  else
    cat
  fi
}

check_status() {
  local port key; port=$(http_port); key=$(env_value DOMIA_KEY)
  echo "🩺 Node $DOMIA_ENV (${key:-?}) on :$port"
  if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1; then
    for u in domia llama-server; do printf "   %-13s %s\n" "$u" "$(unit_state systemctl is-active "$u")"; done
    printf "   %-13s %s\n" nemo-speech "$(unit_state systemctl --user is-active nemo-speech)"
  fi
  is_jetson && check_jetson_runtime
  curl -sf -m 3 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && echo "✅ /health ok" || { echo "❌ /health not answering"; return; }
  command -v jq >/dev/null 2>&1 || { echo "ℹ️  jq not found — install it for the provider and satellite lines"; return; }
  [ -n "$key" ] || { echo "ℹ️  DOMIA_KEY not set in $DOMIA_ENV — skipping providers"; return; }
  curl -sf -m 5 "http://127.0.0.1:$port/skills?domiaKey=$key" 2>/dev/null | jq -r '.providers[]? | "   provider \(.name): \(if .connected then "connected" else "DISCONNECTED" end), \((.tools // []) | length) tools"'
  curl -sf -m 5 "http://127.0.0.1:$port/presence" 2>/dev/null | jq -r '.presence[]?.satellites[]? | "   satellite \(.satelliteId): \(if .connected then "connected" else "DISCONNECTED" end), wake \(.activeWakeWords // [] | join(",")), fw \(.firmwareVersion // "?")"'
}

follow_log() {
  local f pattern; f=$(log_file) || exit 1; pattern="${LOG_GREP:-STT_DONE|LLM_DONE:|TURN_COMPLETE|run open|run closed|announce|barge|paused, awaiting|false interruption|turn aborted|watchdog|silent|disconnected|connected to esphome|provider|\"level\":\"(warn|error)\"}"
  echo "📜 $f (filter: $pattern)" >&2
  tail -n 200 -F "$f" | grep --line-buffered -E "$pattern" | grep --line-buffered -v alreadyStreamed | render_log
}

follow_log_raw() { local f; f=$(log_file) || exit 1; tail -n 100 -F "$f" | render_log; }

restart_node() {
  local port pid; port=$(http_port)
  if [ "$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && systemctl is-active domia >/dev/null 2>&1; then
    pid=$(systemctl show domia -p MainPID --value)
    echo "🔁 killing domia main process $pid (systemd relaunches it)"
    kill "$pid"
  else
    echo "❌ no active domia systemd service here (dev nodes restart from their own terminal)" >&2; exit 1
  fi
  for _ in $(seq 1 60); do sleep 2; curl -sf -m 2 "http://127.0.0.1:$port/health" >/dev/null 2>&1 && { echo "✅ back on :$port"; return; }; done
  echo "❌ /health did not come back within 2 minutes — journalctl -u domia" >&2; exit 1
}

case "${1:-}" in
  services) check_services ;;
  doctor) check_doctor ;;
  posture) check_posture ;;
  jetson) check_jetson ;;
  status) check_status ;;
  logs) follow_log ;;
  logs-raw) follow_log_raw ;;
  restart) restart_node ;;
  *) echo "usage: bash scripts/doctor.sh {services|doctor|posture|jetson|status|logs|logs-raw|restart}" >&2; exit 2 ;;
esac
