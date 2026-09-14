#!/usr/bin/env bash
set -euo pipefail

NEMO_VERSION="${NEMO_VERSION:-0.1.0}"
NEMO_DIR="${NEMO_DIR:-$HOME/nemo-speech}"
NEMO_BIN="${NEMO_BIN:-$NEMO_DIR/nemo-speech/bin/nemo-speech}"
NEMO_PORT="${NEMO_PORT:-8600}"
NEMO_MODEL="${NEMO_MODEL:-nemotron-3.5}"

install_sox() {
  echo "🔧 Installing required system dependency: sox..."
  case "$(uname -s)" in
    Linux*)
      command -v apt-get >/dev/null 2>&1 || { echo "❌ apt-get not found — install 'sox' with your distro's package manager (e.g. dnf/pacman/zypper install sox)"; exit 1; }
      sudo apt-get update && sudo apt-get install -y sox ;;
    Darwin*)
      command -v brew >/dev/null 2>&1 || { echo "❌ Homebrew not found. Install from https://brew.sh"; exit 1; }
      brew install sox ;;
    *)
      echo "❌ Unsupported OS. Please install 'sox' manually."; exit 1 ;;
  esac
  echo "✅ Binary installation complete."
}

install_livekit() {
  case "$(uname -s)" in
    Darwin*)
      brew install livekit ;;
    Linux*)
      curl -sSL https://get.livekit.io | bash ;;
    *)
      echo "❌ Install livekit-server manually"; exit 1 ;;
  esac
}

install_ollama() {
  command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh
  ollama pull llama3.2:3b && ollama pull llama3.2:1b
  echo "✅ ollama ready (llama3.2:3b + reflection 1b)"
}

resolve_nemo_bin() {
  local found
  found=$(ls -d "$NEMO_DIR"/nemo-speech*/bin/nemo-speech 2>/dev/null | head -1)
  if [ -n "$found" ] && [ -x "$found" ]; then echo "$found"; else echo "$NEMO_BIN"; fi
}

install_nemo_speech() {
  NEMO_BIN=$(resolve_nemo_bin)
  if [ -x "$NEMO_BIN" ]; then
    echo "✅ nemo-speech already installed: $NEMO_BIN"
  else
    case "$(uname -s)-$(uname -m)" in
      Darwin-arm64) asset=macos-aarch64-metal ;;
      Linux-aarch64) asset=linux-aarch64-vulkan ;;
      Linux-x86_64) asset=linux-x86_64-cuda13 ;;
      *) echo "❌ unsupported platform"; exit 1 ;;
    esac
    mkdir -p "$NEMO_DIR"
    echo "🌐 Downloading nemo-speech-$NEMO_VERSION-$asset..."
    curl -fL --progress-bar "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v$NEMO_VERSION/nemo-speech-$NEMO_VERSION-$asset.tar.gz" | tar xz -C "$NEMO_DIR"
    NEMO_BIN=$(resolve_nemo_bin)
    [ -x "$NEMO_BIN" ] || { echo "❌ nemo-speech binary not found under $NEMO_DIR after extraction"; exit 1; }
  fi
  "$NEMO_BIN" model pull "$NEMO_MODEL"
  echo "✅ nemo-speech ready — set stt.engine=NEMO_SPEECH, stt.baseUrl=http://127.0.0.1:$NEMO_PORT/v1"
}

case "${1:-}" in
  deps) install_sox ;;
  livekit) install_livekit ;;
  ollama) install_ollama ;;
  nemo-speech) install_nemo_speech ;;
  *) echo "usage: bash scripts/install-deps.sh {deps|livekit|ollama|nemo-speech}" >&2; exit 2 ;;
esac
