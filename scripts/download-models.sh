#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/models"
mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

download_and_extract() {
  local target_name=$1
  local url=$2
  local source_dir_name=$3
  local archive
  archive="$(basename "$url")"

  if [ -d "$target_name" ]; then
    echo "[$target_name] already present, skipping"
    return
  fi

  echo "[$target_name] downloading $url"
  curl -fSL -o "$archive" "$url"
  echo "[$target_name] extracting"
  tar -xf "$archive"
  rm -f "$archive"
  if [ "$source_dir_name" != "$target_name" ]; then
    mv "$source_dir_name" "$target_name"
  fi
  echo "[$target_name] done"
}

case "${1:-all}" in
  zipformer|all)
    download_and_extract "streaming-zipformer-en" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2" \
      "sherpa-onnx-streaming-zipformer-en-2023-06-26"
    ;;
esac

case "${1:-}" in
  whisper-tiny|whisper)
    download_and_extract "whisper-tiny.en" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2" \
      "sherpa-onnx-whisper-tiny.en"
    ;;
esac

case "${1:-}" in
  whisper-multilingual|whisper-ml)
    download_and_extract "whisper-base" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2" \
      "sherpa-onnx-whisper-base"
    ;;
esac

case "${1:-}" in
  moonshine)
    download_and_extract "moonshine-tiny-en-int8" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2" \
      "sherpa-onnx-moonshine-tiny-en-int8"
    ;;
esac

case "${1:-}" in
  parakeet|parakeet-tdt)
    download_and_extract "parakeet-tdt-06b-v2" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2" \
      "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
    ;;
esac

case "${1:-}" in
  parakeet-streaming|parakeet-unified)
    download_and_extract "parakeet-unified-560" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms.tar.bz2" \
      "sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms"
    ;;
esac

case "${1:-all}" in
  kokoro|all)
    download_and_extract "kokoro-en-v0_19" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2" \
      "kokoro-en-v0_19"
    ;;
esac

case "${1:-all}" in
  kokoro-v1|all)
    download_and_extract "kokoro-multi-lang-v1_0" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2" \
      "kokoro-multi-lang-v1_0"
    ;;
esac

case "${1:-all}" in
  vad|all)
    if [ ! -f "silero_vad.onnx" ]; then
      echo "[silero_vad] downloading"
      curl -fSL -o "silero_vad.onnx" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
      echo "[silero_vad] done"
    else
      echo "[silero_vad] already present, skipping"
    fi
    ;;
esac

case "${1:-all}" in
  kws|all)
    download_and_extract "kws-zipformer-gigaspeech-3.3M-2024-01-01" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2" \
      "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
    ;;
esac

case "${1:-all}" in
  embeddings|bge|all)
    if [ ! -d "bge-small-en-v1.5" ]; then
      echo "[bge-small-en-v1.5] downloading"
      base="https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main"
      mkdir -p "bge-small-en-v1.5/onnx"
      for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json vocab.txt; do
        curl -fSL -o "bge-small-en-v1.5/$f" "$base/$f"
      done
      curl -fSL -o "bge-small-en-v1.5/onnx/model_quantized.onnx" "$base/onnx/model_quantized.onnx"
      echo "[bge-small-en-v1.5] done"
    else
      echo "[bge-small-en-v1.5] already present, skipping"
    fi
    ;;
esac

case "${1:-}" in
  pocket)
    download_and_extract "sherpa-onnx-pocket-tts-int8-2026-01-26" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2" \
      "sherpa-onnx-pocket-tts-int8-2026-01-26"
    ;;
esac

case "${1:-}" in
  vits-es)
    download_and_extract "vits-piper-es_MX-claude-high" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_MX-claude-high.tar.bz2" \
      "vits-piper-es_MX-claude-high"
    ;;
esac

case "${1:-}" in
  embeddings-multilingual)
    if [ ! -d "paraphrase-multilingual-minilm-l12-v2" ]; then
      echo "[paraphrase-multilingual-minilm] downloading"
      base="https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main"
      mkdir -p "paraphrase-multilingual-minilm-l12-v2/onnx"
      for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
        curl -fSL -o "paraphrase-multilingual-minilm-l12-v2/$f" "$base/$f"
      done
      curl -fSL -o "paraphrase-multilingual-minilm-l12-v2/onnx/model_quantized.onnx" "$base/onnx/model_quantized.onnx"
      echo "[paraphrase-multilingual-minilm] done"
    else
      echo "[paraphrase-multilingual-minilm] already present, skipping"
    fi
    ;;
esac

echo ""
echo "Models directory: $MODELS_DIR"
ls -1 "$MODELS_DIR"
