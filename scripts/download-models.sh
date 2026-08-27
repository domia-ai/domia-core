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
  zipformer)
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

case "${1:-all}" in
  parakeet|parakeet-tdt|all|jetson)
    download_and_extract "parakeet-tdt-06b-v2" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2" \
      "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
    ;;
esac

case "${1:-}" in
  parakeet-v3|espanol|multilingual)
    download_and_extract "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" \
      "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
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
  kokoro)
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
  vad|all|jetson)
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
  smart-turn|turn-detector|all|jetson)
    if [ ! -f "smart-turn/smart-turn-v3.2-cpu.onnx" ]; then
      echo "[smart-turn-v3.2-cpu] downloading"
      mkdir -p "smart-turn"
      curl -fSL -o "smart-turn/smart-turn-v3.2-cpu.onnx" \
        "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx"
      echo "[smart-turn-v3.2-cpu] done"
    else
      echo "[smart-turn-v3.2-cpu] already present, skipping"
    fi
    ;;
esac

case "${1:-all}" in
  kws|all|jetson)
    download_and_extract "kws-zipformer-gigaspeech-3.3M-2024-01-01" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2" \
      "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
    ;;
esac

case "${1:-all}" in
  embeddings|bge|all|jetson)
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
  piper-en|jetson)
    download_and_extract "vits-piper-en_US-libritts_r-medium" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2" \
      "vits-piper-en_US-libritts_r-medium"
    ;;
esac

case "${1:-}" in
  piper-en)
    download_and_extract "vits-piper-en_US-lessac-medium" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2" \
      "vits-piper-en_US-lessac-medium"
    ;;
esac

case "${1:-}" in
  kitten)
    download_and_extract "kitten-nano-en-v0_1-fp16" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2" \
      "kitten-nano-en-v0_1-fp16"
    ;;
esac

case "${1:-}" in
  matcha)
    download_and_extract "matcha-icefall-en_US-ljspeech" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-en_US-ljspeech.tar.bz2" \
      "matcha-icefall-en_US-ljspeech"
    if [ ! -f "$MODELS_DIR/vocos-22khz-univ.onnx" ]; then
      echo "[vocos vocoder] downloading"
      curl -fL --progress-bar \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx" \
        -o "$MODELS_DIR/vocos-22khz-univ.onnx"
    else
      echo "[vocos vocoder] already present, skipping"
    fi
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

case "${1:-}" in
  qwen3-asr)
    mkdir -p gguf
    if [ ! -f "gguf/qwen3-asr-0.6b-q8.gguf" ]; then
      echo "[qwen3-asr] downloading model"
      curl -fSL -o "gguf/qwen3-asr-0.6b-q8.gguf" \
        "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/main/Qwen3-ASR-0.6B-Q8_0.gguf"
    else
      echo "[qwen3-asr] model present, skipping"
    fi
    if [ ! -f "gguf/mmproj-qwen3-asr-0.6b-q8.gguf" ]; then
      echo "[qwen3-asr] downloading mmproj"
      curl -fSL -o "gguf/mmproj-qwen3-asr-0.6b-q8.gguf" \
        "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/main/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf"
    else
      echo "[qwen3-asr] mmproj present, skipping"
    fi
    ;;
esac

case "${1:-all}" in
  nemotron-streaming|all|jetson)
    download_and_extract "nemotron-3.5-streaming-560" \
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2" \
      "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11"
    ;;
esac

echo ""
echo "Models directory: $MODELS_DIR"
ls -1 "$MODELS_DIR"
