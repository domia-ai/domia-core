#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UNIT="${1:-}"
MODE="${2:-}"

usage() {
  echo "usage: bash scripts/install-service.sh {domia|nemo|llm|asr} [--user]" >&2
  exit 2
}

render_template() {
  local tpl="$1"
  shift
  local out name value pair
  out="$(cat "$tpl")"
  shopt -u patsub_replacement 2>/dev/null || true
  for pair in "$@"; do
    name="${pair%%=*}"
    value="${pair#*=}"
    out="${out//\$\{$name\}/$value}"
  done
  printf '%s\n' "$out"
}

install_domia() {
  [ "$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make run"; exit 1; }
  [ -f "$WORKDIR/build/index.js" ] || { echo "❌ no build found — run: make setup"; exit 1; }
  render_template "$ROOT/config/systemd/domia.service.tpl" \
    "SERVICE_USER=$(id -un)" \
    "WORKDIR=$WORKDIR" \
    "NODE_BIN_DIR=$(dirname "$(command -v node)")" \
    "DOMIA_ENV=$DOMIA_ENV" > /tmp/domia.service
  sudo cp /tmp/domia.service /etc/systemd/system/domia.service
  sudo systemctl daemon-reload && sudo systemctl enable --now domia
  echo "✅ domia service installed (env: $DOMIA_ENV). Logs: journalctl -fu domia"
}

install_nemo() {
  [ "$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make nemo-serve"; exit 1; }
  local model
  model="$(find "$HOME/.cache/nemo-speech" -name "*.gguf" 2>/dev/null | grep -m1 asr || find "$HOME/.cache/nemo-speech" -name "*.gguf" | head -1 || true)"
  [ -n "$model" ] || { echo "❌ no ASR model found — run: make nemo-speech NEMO_MODEL=$NEMO_MODEL"; exit 1; }
  mkdir -p "$HOME/.config/systemd/user"
  render_template "$ROOT/config/systemd/nemo-speech.service.tpl" \
    "NEMO_BIN=$NEMO_BIN" \
    "NEMO_MODEL_PATH=$model" \
    "NEMO_PORT=$NEMO_PORT" \
    "NEMO_EXTRA_FLAGS=$NEMO_EXTRA_FLAGS" > "$HOME/.config/systemd/user/nemo-speech.service"
  systemctl --user daemon-reload && systemctl --user enable --now nemo-speech
  loginctl enable-linger "$(id -un)" 2>/dev/null || true
  if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" = "yes" ]; then
    echo "✅ nemo-speech user service installed on :$NEMO_PORT, starts at boot (linger on). Logs: journalctl --user -fu nemo-speech"
  else
    echo "⚠️ nemo-speech user service installed on :$NEMO_PORT but linger is OFF — it will only start after you log in. Enable once with: sudo loginctl enable-linger $(id -un)"
  fi
}

install_llm() {
  case "$(uname -s)" in
    Darwin | Linux) ;;
    *) echo "❌ unsupported OS — use: make llm-server"; exit 1 ;;
  esac
  if [ "$(uname -s)" = "Darwin" ]; then
    mkdir -p "$HOME/Library/LaunchAgents" "$CURDIR/log"
    launchctl bootout "gui/$(id -u)/$LLM_LAUNCHD_LABEL" 2>/dev/null || true
    for _ in $(seq 1 30); do
      launchctl print "gui/$(id -u)/$LLM_LAUNCHD_LABEL" >/dev/null 2>&1 || break
      sleep 1
    done
    render_template "$ROOT/config/launchd/ai.domia.llm-server.plist.tpl" \
      "LLM_LAUNCHD_LABEL=$LLM_LAUNCHD_LABEL" \
      "LLM_LAUNCHER=$LLM_LAUNCHER" \
      "LLAMA_SERVER_BIN=$LLAMA_SERVER_BIN" \
      "LLM_GGUF=$LLM_GGUF" \
      "LLM_PORT=$LLM_PORT" \
      "LLM_CTX=$LLM_CTX" \
      "LLM_CHAT_TEMPLATE=$LLM_CHAT_TEMPLATE" \
      "LLM_EXTRA_FLAGS=$LLM_EXTRA_FLAGS" \
      "LLM_CACHE_RAM_MB=$LLM_CACHE_RAM_MB" \
      "LLM_SPEC_TYPE=$LLM_SPEC_TYPE" \
      "CURDIR=$CURDIR" > "$LLM_LAUNCHD_PLIST"
    launchctl bootstrap "gui/$(id -u)" "$LLM_LAUNCHD_PLIST"
    echo "✅ llama-server launchd agent installed (port $LLM_PORT). Logs: tail -f log/llama-server.log · restart: launchctl kickstart -k gui/$(id -u)/$LLM_LAUNCHD_LABEL · remove: launchctl bootout gui/$(id -u)/$LLM_LAUNCHD_LABEL"
  else
    render_template "$ROOT/config/systemd/llama-server.service.tpl" \
      "SERVICE_USER=$(id -un)" \
      "LLAMA_SERVER_BIN=$LLAMA_SERVER_BIN" \
      "LLM_GGUF=$LLM_GGUF" \
      "LLM_PORT=$LLM_PORT" \
      "LLM_CTX=$LLM_CTX" \
      "LLM_CHAT_TEMPLATE=$LLM_CHAT_TEMPLATE" \
      "LLM_EXTRA_FLAGS=$LLM_EXTRA_FLAGS" \
      "LLM_CACHE_RAM_MB=$LLM_CACHE_RAM_MB" \
      "LLM_SPEC_TYPE=$LLM_SPEC_TYPE" \
      "LLM_LAUNCHER=$LLM_LAUNCHER" > /tmp/llama-server.service
    sudo cp /tmp/llama-server.service /etc/systemd/system/llama-server.service
    sudo systemctl daemon-reload && sudo systemctl enable --now llama-server
    echo "✅ llama-server service installed (port $LLM_PORT). Logs: journalctl -fu llama-server"
  fi
}

install_asr() {
  render_template "$ROOT/config/systemd/domia-asr.service.tpl" \
    "SERVICE_USER=$(id -un)" \
    "LLAMA_SERVER_BIN=$LLAMA_SERVER_BIN" \
    "ASR_GGUF=$ASR_GGUF" \
    "ASR_MMPROJ=$ASR_MMPROJ" \
    "ASR_PORT=$ASR_PORT" > /tmp/domia-asr.service
  sudo cp /tmp/domia-asr.service /etc/systemd/system/domia-asr.service
  sudo systemctl daemon-reload && sudo systemctl enable --now domia-asr
  echo "✅ domia-asr service on :$ASR_PORT. Logs: journalctl -fu domia-asr"
}

WORKDIR="${WORKDIR:-$ROOT}"
CURDIR="${CURDIR:-$ROOT}"
DOMIA_ENV="${DOMIA_ENV:-.env}"

NEMO_DIR="${NEMO_DIR:-$HOME/nemo-speech}"
NEMO_BIN="${NEMO_BIN:-$NEMO_DIR/nemo-speech/bin/nemo-speech}"
NEMO_PORT="${NEMO_PORT:-8600}"
NEMO_MODEL="${NEMO_MODEL:-nemotron-3.5}"
NEMO_EXTRA_FLAGS="${NEMO_EXTRA_FLAGS:-}"

LLM_LAUNCHD_LABEL="${LLM_LAUNCHD_LABEL:-ai.domia.llm-server}"
LLM_LAUNCHD_PLIST="${LLM_LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$LLM_LAUNCHD_LABEL.plist}"
LLM_LAUNCHER="${LLM_LAUNCHER:-$ROOT/scripts/llm-server.sh}"
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$HOME/src/llama.cpp/build/bin/llama-server}"
LLM_GGUF="${LLM_GGUF:-$ROOT/data/models/gguf/llama-3.2-3b-instruct-q4_k_m.gguf}"
LLM_PORT="${LLM_PORT:-11435}"
LLM_CTX="${LLM_CTX:-4096}"
LLM_CHAT_TEMPLATE="${LLM_CHAT_TEMPLATE:-}"
LLM_EXTRA_FLAGS="${LLM_EXTRA_FLAGS:-}"
LLM_CACHE_RAM_MB="${LLM_CACHE_RAM_MB:-256}"
LLM_SPEC_TYPE="${LLM_SPEC_TYPE:-}"

ASR_GGUF="${ASR_GGUF:-$ROOT/data/models/gguf/qwen3-asr-0.6b-q8.gguf}"
ASR_MMPROJ="${ASR_MMPROJ:-$ROOT/data/models/gguf/mmproj-qwen3-asr-0.6b-q8.gguf}"
ASR_PORT="${ASR_PORT:-11436}"

[ "${BASH_SOURCE[0]}" = "$0" ] || return 0

case "$UNIT" in
  domia) install_domia ;;
  nemo)
    [ "$MODE" = "--user" ] || { echo "❌ nemo installs as a systemd USER unit — pass --user" >&2; exit 2; }
    install_nemo
    ;;
  llm) install_llm ;;
  asr) install_asr ;;
  *) usage ;;
esac
