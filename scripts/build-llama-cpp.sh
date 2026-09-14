#!/usr/bin/env bash
set -euo pipefail

LLM_SRC_DIR="${LLM_SRC_DIR:-$HOME/src}"
LLAMA_CPP_DIR="${LLAMA_CPP_DIR:-$LLM_SRC_DIR/llama.cpp}"
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-$LLAMA_CPP_DIR/build/bin/llama-server}"
LLM_BUILD_JOBS="${LLM_BUILD_JOBS:-3}"
FORCE="${FORCE:-}"

mkdir -p "$LLM_SRC_DIR"
[ -d "$LLAMA_CPP_DIR/.git" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA_CPP_DIR"

if [ -n "$FORCE" ]; then
  echo "🔄 updating llama.cpp to latest"
  git -C "$LLAMA_CPP_DIR" fetch --depth 1 origin &&
    git -C "$LLAMA_CPP_DIR" reset --hard FETCH_HEAD
fi

cd "$LLAMA_CPP_DIR"
if [ "$(uname -s)" = "Darwin" ]; then
  echo "🍎 macOS detected — building with Metal"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
elif [ -x /usr/local/cuda/bin/nvcc ]; then
  echo "🟩 NVIDIA CUDA detected — building with GGML_CUDA"
  PATH=/usr/local/cuda/bin:$PATH cmake -B build \
    -DGGML_CUDA=ON \
    -DCMAKE_CUDA_ARCHITECTURES=native \
    -DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc \
    -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
else
  echo "🧮 no GPU toolchain found — building CPU-only"
  cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF
fi
cmake --build build --target llama-server -j "$LLM_BUILD_JOBS"

echo "✅ built: $LLAMA_SERVER_BIN"
