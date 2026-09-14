#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OVERRIDE_FILE="${LLM_SERVER_OVERRIDES:-$ROOT/config/llm-server.env}"

if [ -f "$OVERRIDE_FILE" ]; then
	set -a
	# shellcheck disable=SC1090
	. "$OVERRIDE_FILE"
	set +a
fi
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$HOME/src/llama.cpp/build/bin/llama-server}"
LLM_GGUF="${LLM_GGUF:-$ROOT/data/models/gguf/llama-3.2-3b-instruct-q4_k_m.gguf}"
LLM_HOST="${LLM_HOST:-0.0.0.0}"
LLM_PORT="${LLM_PORT:-11435}"
LLM_CTX="${LLM_CTX:-4096}"
LLM_CHAT_TEMPLATE="${LLM_CHAT_TEMPLATE:-}"
LLM_EXTRA_FLAGS="${LLM_EXTRA_FLAGS:-}"
LLM_NO_WARMUP="${LLM_NO_WARMUP:-0}"
LLM_CACHE_RAM_MB="${LLM_CACHE_RAM_MB:-256}"
LLM_SPEC_TYPE="${LLM_SPEC_TYPE:-}"

from_root() {
	case "$1" in
		"" | /*) printf '%s' "$1" ;;
		*) printf '%s/%s' "$ROOT" "$1" ;;
	esac
}
LLM_GGUF="$(from_root "$LLM_GGUF")"
LLM_CHAT_TEMPLATE="$(from_root "$LLM_CHAT_TEMPLATE")"

args=(-m "$LLM_GGUF" --host "$LLM_HOST" --port "$LLM_PORT" -ngl 99 -c "$LLM_CTX")
[ -n "$LLM_CACHE_RAM_MB" ] && args+=(--cache-ram "$LLM_CACHE_RAM_MB")
[ -n "$LLM_SPEC_TYPE" ] && args+=(--spec-type "$LLM_SPEC_TYPE")
if [ -n "$LLM_CHAT_TEMPLATE" ]; then
	[ -f "$LLM_CHAT_TEMPLATE" ] || { echo "❌ LLM_CHAT_TEMPLATE not found: $LLM_CHAT_TEMPLATE" >&2; exit 1; }
	args+=(--chat-template-file "$LLM_CHAT_TEMPLATE")
fi
[ "$LLM_NO_WARMUP" = "1" ] && args+=(--no-warmup)

# shellcheck disable=SC2206
args+=($LLM_EXTRA_FLAGS)

exec "$LLAMA_SERVER_BIN" "${args[@]}"
