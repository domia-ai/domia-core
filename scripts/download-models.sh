#!/usr/bin/env bash
set -euo pipefail

MODELS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/data/models"
mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

cleanup() { rm -rf "$MODELS_DIR"/.extract.* 2>/dev/null || true; }
trap cleanup EXIT

download_file() {
  local dest=$1 url=$2
  mkdir -p "$(dirname "$dest")"
  echo "[$(basename "$dest")] downloading"
  curl -fSL --retry 3 -C - -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
}

download_and_extract() {
  local target_name=$1 url=$2 source_dir_name=$3
  local archive tmp
  archive="$(basename "$url")"

  if [ -d "$target_name" ]; then
    echo "[$target_name] already present, skipping"
    return
  fi

  echo "[$target_name] downloading $url"
  curl -fSL --retry 3 -C - -o "$archive.part" "$url"
  mv "$archive.part" "$archive"

  echo "[$target_name] extracting"
  tmp="$(mktemp -d "$MODELS_DIR/.extract.XXXXXX")"
  tar -xf "$archive" -C "$tmp"
  rm -f "$archive"
  mv "$tmp/$source_dir_name" "$target_name"
  rm -rf "$tmp"
  echo "[$target_name] done"
}

fetch_bge() {
  if [ -d "bge-small-en-v1.5" ]; then
    echo "[bge-small-en-v1.5] already present, skipping"
    return
  fi
  local base="https://huggingface.co/Xenova/bge-small-en-v1.5/resolve/main"
  for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json vocab.txt; do
    download_file "bge-small-en-v1.5/$f" "$base/$f"
  done
  download_file "bge-small-en-v1.5/onnx/model_quantized.onnx" "$base/onnx/model_quantized.onnx"
  echo "[bge-small-en-v1.5] done"
}

fetch_embeddings_multilingual() {
  if [ -d "paraphrase-multilingual-minilm-l12-v2" ]; then
    echo "[paraphrase-multilingual-minilm] already present, skipping"
    return
  fi
  local base="https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main"
  for f in config.json tokenizer.json tokenizer_config.json special_tokens_map.json; do
    download_file "paraphrase-multilingual-minilm-l12-v2/$f" "$base/$f"
  done
  download_file "paraphrase-multilingual-minilm-l12-v2/onnx/model_quantized.onnx" "$base/onnx/model_quantized.onnx"
  echo "[paraphrase-multilingual-minilm] done"
}

fetch_one() {
  case "$1" in
    all)
      for m in parakeet kokoro-v1 vad smart-turn gtcrn kws embeddings nemotron-streaming; do
        fetch_one "$m"
      done
      ;;
    jetson)
      for m in parakeet vad smart-turn gtcrn kws embeddings piper-libritts nemotron-streaming; do
        fetch_one "$m"
      done
      ;;
    espanol)
      for m in parakeet-v3 vits-es embeddings-multilingual; do
        fetch_one "$m"
      done
      ;;
    zipformer)
      download_and_extract "streaming-zipformer-en" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2" \
        "sherpa-onnx-streaming-zipformer-en-2023-06-26"
      ;;
    whisper-tiny|whisper)
      download_and_extract "whisper-tiny.en" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.en.tar.bz2" \
        "sherpa-onnx-whisper-tiny.en"
      ;;
    whisper-multilingual|whisper-ml)
      download_and_extract "whisper-base" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2" \
        "sherpa-onnx-whisper-base"
      ;;
    moonshine)
      download_and_extract "moonshine-tiny-en-int8" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-moonshine-tiny-en-int8.tar.bz2" \
        "sherpa-onnx-moonshine-tiny-en-int8"
      ;;
    parakeet|parakeet-tdt)
      download_and_extract "parakeet-tdt-06b-v2" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2" \
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8"
      ;;
    parakeet-v3|multilingual)
      download_and_extract "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" \
        "sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
      ;;
    parakeet-streaming|parakeet-unified)
      download_and_extract "parakeet-unified-560" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms.tar.bz2" \
        "sherpa-onnx-nemo-parakeet-unified-en-0.6b-int8-streaming-560ms"
      ;;
    kokoro)
      download_and_extract "kokoro-en-v0_19" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-en-v0_19.tar.bz2" \
        "kokoro-en-v0_19"
      ;;
    kokoro-v1)
      download_and_extract "kokoro-multi-lang-v1_0" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2" \
        "kokoro-multi-lang-v1_0"
      ;;
    vad)
      [ -f "silero_vad.onnx" ] && echo "[silero_vad] already present, skipping" \
        || download_file "silero_vad.onnx" \
          "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
      ;;
    smart-turn|turn-detector)
      [ -f "smart-turn/smart-turn-v3.2-cpu.onnx" ] && echo "[smart-turn-v3.2-cpu] already present, skipping" \
        || download_file "smart-turn/smart-turn-v3.2-cpu.onnx" \
          "https://huggingface.co/pipecat-ai/smart-turn-v3/resolve/main/smart-turn-v3.2-cpu.onnx"
      ;;
    gtcrn|denoise)
      [ -f "gtcrn_simple.onnx" ] && echo "[gtcrn_simple] already present, skipping" \
        || download_file "gtcrn_simple.onnx" \
          "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx"
      ;;
    dpdfnet)
      [ -f "dpdfnet_baseline.onnx" ] && echo "[dpdfnet_baseline] already present, skipping" \
        || download_file "dpdfnet_baseline.onnx" \
          "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/dpdfnet_baseline.onnx"
      ;;
    kws)
      download_and_extract "kws-zipformer-gigaspeech-3.3M-2024-01-01" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2" \
        "sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
      ;;
    embeddings|bge)
      fetch_bge
      ;;
    embeddings-multilingual)
      fetch_embeddings_multilingual
      ;;
    pocket)
      download_and_extract "sherpa-onnx-pocket-tts-int8-2026-01-26" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-pocket-tts-int8-2026-01-26.tar.bz2" \
        "sherpa-onnx-pocket-tts-int8-2026-01-26"
      ;;
    piper-libritts)
      download_and_extract "vits-piper-en_US-libritts_r-medium" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-libritts_r-medium.tar.bz2" \
        "vits-piper-en_US-libritts_r-medium"
      ;;
    piper-en)
      fetch_one "piper-libritts"
      download_and_extract "vits-piper-en_US-lessac-medium" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-lessac-medium.tar.bz2" \
        "vits-piper-en_US-lessac-medium"
      ;;
    supertonic)
      download_and_extract "sherpa-onnx-supertonic-3-tts-int8-2026-05-11" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/sherpa-onnx-supertonic-3-tts-int8-2026-05-11.tar.bz2" \
        "sherpa-onnx-supertonic-3-tts-int8-2026-05-11"
      ;;
    kitten)
      download_and_extract "kitten-nano-en-v0_1-fp16" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kitten-nano-en-v0_1-fp16.tar.bz2" \
        "kitten-nano-en-v0_1-fp16"
      ;;
    matcha)
      download_and_extract "matcha-icefall-en_US-ljspeech" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/matcha-icefall-en_US-ljspeech.tar.bz2" \
        "matcha-icefall-en_US-ljspeech"
      [ -f "$MODELS_DIR/vocos-22khz-univ.onnx" ] && echo "[vocos vocoder] already present, skipping" \
        || download_file "$MODELS_DIR/vocos-22khz-univ.onnx" \
          "https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos-22khz-univ.onnx"
      ;;
    vits-es)
      download_and_extract "vits-piper-es_MX-claude-high" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-es_MX-claude-high.tar.bz2" \
        "vits-piper-es_MX-claude-high"
      ;;
    qwen3-asr)
      [ -f "gguf/qwen3-asr-0.6b-q8.gguf" ] && echo "[qwen3-asr] model present, skipping" \
        || download_file "gguf/qwen3-asr-0.6b-q8.gguf" \
          "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/main/Qwen3-ASR-0.6B-Q8_0.gguf"
      [ -f "gguf/mmproj-qwen3-asr-0.6b-q8.gguf" ] && echo "[qwen3-asr] mmproj present, skipping" \
        || download_file "gguf/mmproj-qwen3-asr-0.6b-q8.gguf" \
          "https://huggingface.co/ggml-org/Qwen3-ASR-0.6B-GGUF/resolve/main/mmproj-Qwen3-ASR-0.6B-Q8_0.gguf"
      ;;
    qwen3.5-4b)
      [ -f "gguf/qwen3.5-4b-q4_k_m.gguf" ] && echo "[qwen3.5-4b] already present, skipping" \
        || download_file "gguf/qwen3.5-4b-q4_k_m.gguf" \
          "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf"
      ;;
    lfm2.5-2.6b)
      [ -f "gguf/lfm2.5-2.6b-qad-q4_0.gguf" ] && echo "[lfm2.5-2.6b] already present, skipping" \
        || download_file "gguf/lfm2.5-2.6b-qad-q4_0.gguf" \
          "https://huggingface.co/LiquidAI/LFM2.5-2.6B-GGUF/resolve/main/LFM2.5-2.6B-QAD-Q4_0.gguf"
      ;;
    nemotron-streaming)
      download_and_extract "nemotron-3.5-streaming-560" \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11.tar.bz2" \
        "sherpa-onnx-nemotron-3.5-asr-streaming-0.6b-560ms-int8-2026-06-11"
      ;;
    *)
      echo "❌ unknown model '$1'" >&2
      exit 2
      ;;
  esac
}

if [ "$#" -eq 0 ]; then
  set -- all
fi
for name in "$@"; do
  fetch_one "$name"
done

echo ""
echo "Models directory: $MODELS_DIR"
ls -1 "$MODELS_DIR"
