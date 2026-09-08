#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

usage() {
	echo "usage: scripts/llm-tournament.sh label=path/to/model.gguf [label=path ...]" >&2
	echo "  env: LLM_PORT (11435) LLM_CTX (8192) LLM_EXTRA_FLAGS EVAL_URL EVAL_DB EVAL_DOMIA_KEY RESTORE_GGUF (default: restore the backed-up launch unit, else makefile LLM_GGUF)" >&2
	exit 2
}

[ "$#" -ge 1 ] || usage
[ "$(uname -s)" = "Darwin" ] || { echo "❌ the tournament runner swaps the launchd agent; on Linux run the candidates by hand with make llm-server" >&2; exit 1; }

PORT="${LLM_PORT:-11435}"
LABEL_UNIT="ai.domia.llm-server"
PLIST="$HOME/Library/LaunchAgents/$LABEL_UNIT.plist"
PLIST_BACKUP=""
if [ -f "$PLIST" ]; then
	PLIST_BACKUP="$(mktemp)"
	cp "$PLIST" "$PLIST_BACKUP"
	echo "💾 backed up current launch unit → $PLIST_BACKUP"
fi

normalize_path() {
	local p="${1:-}"
	[ -n "$p" ] || { echo ""; return; }
	case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
	if command -v realpath >/dev/null 2>&1; then
		realpath -q "$p" 2>/dev/null || echo "$p"
	else
		echo "$p"
	fi
}

wait_health() {
	for _ in $(seq 1 90); do
		curl -s -m 2 "http://127.0.0.1:$PORT/health" | grep -q ok && return 0
		sleep 2
	done
	echo "❌ llama-server did not come up on :$PORT" >&2
	return 1
}

loaded_model() {
	curl -s -m 5 "http://127.0.0.1:$PORT/props" \
		| node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(String(JSON.parse(s).model_path||""))}catch{process.stdout.write("")}})' \
		2>/dev/null || true
}

swap() {
	make llm-service LLM_GGUF="$1" LLM_PORT="$PORT" LLM_CTX="${LLM_CTX:-8192}" LLM_EXTRA_FLAGS="${LLM_EXTRA_FLAGS:--np 2 -fa on -ctk q8_0 -ctv q8_0}" >/dev/null
	wait_health
	sleep 3
	local loaded want
	loaded="$(normalize_path "$(loaded_model)")"
	want="$(normalize_path "$1")"
	[ "$loaded" = "$want" ] || { echo "❌ llama-server is serving '$loaded', not '$want' — swap failed" >&2; return 1; }
}

failures=0
for pair in "$@"; do
	label="${pair%%=*}"
	gguf="${pair#*=}"
	[ -f "$gguf" ] || { echo "❌ missing gguf for $label: $gguf" >&2; failures=$((failures + 1)); continue; }
	echo "🏁 $label ← $gguf"
	swap "$gguf" || { failures=$((failures + 1)); continue; }
	set +e
	npm run evals -- tool-scenarios --label "$label" 2>&1 | grep -E "✅|❌|score miss|gates"
	status=${PIPESTATUS[0]}
	set -e
	if [ "$status" -ne 0 ]; then
		echo "⚠️  $label: eval exited $status" >&2
		failures=$((failures + 1))
	fi
done

if [ -n "${RESTORE_GGUF:-}" ]; then
	echo "🔁 restoring $RESTORE_GGUF"
	swap "$RESTORE_GGUF" || true
elif [ -n "$PLIST_BACKUP" ]; then
	echo "🔁 restoring previous llama-server launch unit"
	cp "$PLIST_BACKUP" "$PLIST"
	launchctl bootout "gui/$(id -u)/$LABEL_UNIT" 2>/dev/null || true
	launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null || true
	launchctl kickstart -k "gui/$(id -u)/$LABEL_UNIT" 2>/dev/null || true
	wait_health || true
else
	echo "🔁 restoring makefile default LLM_GGUF"
	make llm-service LLM_PORT="$PORT" LLM_CTX="${LLM_CTX:-8192}" LLM_EXTRA_FLAGS="${LLM_EXTRA_FLAGS:--np 2 -fa on -ctk q8_0 -ctv q8_0}" >/dev/null
	wait_health || true
fi
[ -n "$PLIST_BACKUP" ] && rm -f "$PLIST_BACKUP"

echo "📊 results: evals/bench-results/tool-scenarios-*.json"
[ "$failures" -eq 0 ] || { echo "❌ $failures tournament candidate(s) failed" >&2; exit 1; }
