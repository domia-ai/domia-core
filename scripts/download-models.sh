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
  whisper-tiny|whisper|all)
    download_and_extract "whisper-tiny.en" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2" \
      "sherpa-onnx-whisper-tiny.en"
    ;;
esac

case "${1:-all}" in
  moonshine|all)
    download_and_extract "moonshine-tiny-en-int8" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2" \
      "sherpa-onnx-moonshine-tiny-en-int8"
    ;;
esac

case "${1:-all}" in
  zipformer|all)
    download_and_extract "streaming-zipformer-en" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2" \
      "sherpa-onnx-streaming-zipformer-en-2023-06-26"
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

echo ""
echo "Models directory: $MODELS_DIR"
ls -1 "$MODELS_DIR"
