#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

LLM_GGUF_DIR="${LLM_GGUF_DIR:-$ROOT/data/models/gguf}"
LLM_GGUF="${LLM_GGUF:-$LLM_GGUF_DIR/llama-3.2-3b-instruct-q4_k_m.gguf}"
LLM_OLLAMA_TAG="${LLM_OLLAMA_TAG:-llama3.2/3b}"
LLM_GGUF_HF_URL="${LLM_GGUF_HF_URL:-https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf}"

mkdir -p "$LLM_GGUF_DIR"

if [ -f "$LLM_GGUF" ]; then
  echo "✅ GGUF already staged: $LLM_GGUF"
  exit 0
fi

blob="$(python3 -c "import json,glob,os; \
  roots=['/usr/share/ollama/.ollama/models', os.path.expanduser('~/.ollama/models')]; \
  p=[m for r in roots for m in glob.glob(r+'/manifests/**/$LLM_OLLAMA_TAG',recursive=True)]; \
  m=json.load(open(p[0])) if p else None; \
  root=p[0].split('/manifests/')[0] if p else ''; \
  print(next((root+'/blobs/'+l['digest'].replace(':','-') \
    for l in (m['layers'] if m else []) if l['mediaType'].endswith('.model')),''))" 2>/dev/null || true)"

if [ -n "$blob" ] && [ -f "$blob" ]; then
  echo "📦 Reusing Ollama blob ($blob)"
  cp "$blob" "$LLM_GGUF"
else
  echo "🌐 Downloading GGUF from Hugging Face..."
  curl -fL --retry 3 -C - --progress-bar "$LLM_GGUF_HF_URL" -o "$LLM_GGUF.part" && mv "$LLM_GGUF.part" "$LLM_GGUF"
fi

echo "✅ GGUF ready: $LLM_GGUF"
