# Domia on Jetson (Orin-class hub)

How to run Domia as a dedicated always-on hub on an NVIDIA Jetson Orin Nano 8GB. Everything below was validated on real hardware (JetPack 7.x / L4T R39, CUDA 13.2) and is reproducible through the `make jetson-*` targets. Numbers cited are from labeled benchmark runs in `evals/bench-results/`.

## TL;DR

```bash
# 1. Build prerequisites (one-time):
#    - nvidia-jetpack ships nvcc, the CUDA compiler needed to BUILD llama.cpp
#      (runtime CUDA libs are already on every Jetson image)
#    - cmake drives the build
sudo apt install -y nvidia-jetpack cmake

# 2. One command: doctor → build llama.cpp (CUDA, sm_87) → stage the 3B GGUF
#    (reuses your Ollama blob if present) → install llama-server as systemd
make jetson-setup

# 3. Download the local models the Jetson template needs (idempotent).
#    Fetches STT (parakeet), TTS (piper libritts_r), Silero VAD, KWS, embeddings
#    and the smart-turn turn-detector — the template enables acoustic
#    endpointing, which is a no-op unless smart-turn-v3.1-cpu.onnx is present.
npm run setup:models:jetson

# 4. Give your Domia the Jetson role (LLM via OPENAI_COMPATIBLE → :11435/v1)
npm run db:reset && npm run build && npm start   # if first boot on this machine
npm run dev-cli -- config import templates/jetson.json

# 5. Run Domia under systemd (survives reboots, crashes and OOM kills)
make domia-service
```

`make jetson-doctor` re-checks everything at any time: CUDA toolkit, cmake, power mode, available memory, swap.

## Choosing the LLM server

Domia always talks to an OpenAI-compatible HTTP endpoint (`llm.engine = OPENAI_COMPATIBLE`), so the server is a config choice, not a code path:

| Path                                                  | Install               | baseUrl                     | Trade-off                                                                     |
| ----------------------------------------------------- | --------------------- | --------------------------- | ----------------------------------------------------------------------------- |
| **llama-server** (default in `templates/jetson.json`) | `make jetson-setup`   | `http://localhost:11435/v1` | ~2x faster per turn (measured: llm p50 841ms vs 1539ms), manual model staging |
| **Ollama**                                            | `make install-ollama` | `http://localhost:11434/v1` | Simplest model management, slower per turn                                    |

The llama.cpp targets are **not Jetson-specific** — `make llm-server` / `make llm-service` work on any OS (the build auto-detects Metal on macOS, CUDA when nvcc is present, CPU otherwise). `jetson-setup` is just the Jetson bundle: `jetson-doctor` + `llm-service`.

Run **one LLM server at a time** — on 8GB unified memory two resident models thrash each other.

## Jetson-specific tuning (already encoded in `templates/jetson.json`)

- **Power mode**: use MAXN_SUPER (`sudo nvpmodel -m 2`) — the doctor checks this.
- **Headless**: `sudo systemctl set-default multi-user.target`. The desktop costs ~1GB of unified memory — enough to push model layers off the GPU.
- **One resident model**: the template nulls `reflectionModelName` so the reflection pass never loads a second model (8GB cannot hold two — the reload thrash costs 20-30s per turn).
- **Swap**: add an 8GB swapfile (see doctor output). Memory spikes otherwise OOM-kill services.
- **TTS**: VITS (piper `libritts_r-medium`) on CPU with 4 threads and per-sentence streaming on. `pacerEnabled` must stay **off** on this hardware (its batches outrun the 5s runway and cut long replies).
- **Services**: domia (`make domia-service`) and llama-server (`make llm-service`) both run under systemd (`Restart=always`) — the appliance survives reboots, crashes and OOM kills.

## Tuning the llama-server process

Server-side flags belong to the provider layer (the server process), not to Domia's DB — Domia is a client of an OpenAI-compatible endpoint and per-identity DB config governs only what rides each request (`modelName`, `temperature`, `numPredict`, `baseUrl`). The makefile exposes the server knobs:

```bash
# regenerate the systemd unit with different flags (examples):
make llm-service LLM_CTX=8192                                  # bigger context (needs RAM)
make llm-service LLM_EXTRA_FLAGS="-ctk q8_0 -ctv q8_0"         # halve KV cache memory (larger models/contexts)
make llm-service LLM_GGUF=data/models/gguf/my-model.gguf       # different model file
```

Notes:

- **Flash attention** is already `auto` in current llama.cpp — it enables itself on CUDA/Metal; no flag needed.
- Keep Domia's `llm.contextWindow` (DB) ≤ the server's `LLM_CTX` — the server silently truncates beyond its own limit.
- `useCompactPrompt` measured **worse** on this setup (total p50 +906ms): llama-server's prefix cache already makes the rich persona prompt free after the first turn, and the compact variant loses the style guidance.

## Physical ceiling

At MAXN_SUPER the Orin Nano has 102 GB/s of memory bandwidth → a 3B Q4 model tops out around ~50 tok/s decode no matter the engine. `llama-server` delivers ~20 tok/s in-pipeline; treat bigger claims with suspicion.

## STT choice (validated, not assumed)

**Parakeet TDT 0.6b v2 int8** (the default) survived a 5-model tournament on this hardware (WER-gated, 16-utterance corpus — rerun it anytime with `npm run evals:stt <label>` against a node running the candidate STT config): whisper-tiny (+8pt WER), moonshine-tiny (+10pt), zipformer-2023 (+15pt) all fail the accuracy gate; parakeet-unified streaming decodes 4x slower than real-time on this CPU (unusable). 2026 research confirms it globally: 3.19% LibriSpeech test-other is unbeaten at this size on CPU — Moonshine v2 base (6.78%) and parakeet-v3 (3.59% en, multilingual) both regress English. Streaming STT on this CPU is a dead end today (no viable engine); revisit if sherpa ships parakeet-unified stateful streaming (upstream FR #3573) or a GPU toolchain for this JetPack.

Endpointing (measured over the WS satellite path with server VAD): the template ships `wakeWord.vadMinSilenceS: 0.4` + `vadEndOfSpeechMs: 150` = a **550ms** silence debounce (down from the 700ms default). Pure silence-VAD caps out there — pushing lower cuts anyone who pauses mid-sentence (pauses ≥600ms split utterances at any setting). To get past that floor the template also enables the **smart-turn v3.1 turn-detector** (`acousticEndpointingEnabled: true`, `acousticEndpointCompleteThreshold: 0.7`): when the VAD hits silence it asks the model whether the utterance is acoustically complete and _holds_ (keeps listening) if you're mid-sentence, so the debounce can stay aggressive without clipping natural pauses. Validated on real voice — it reliably held mid-sentence pauses ("Set a timer for… thirty seconds") that pure VAD split, with no measurable added latency on complete phrases. The gate runs on the CPU (~12ms/inference), holds are bounded by `MAX_UTTERANCE_BYTES`, and it works on any satellite protocol where the hub owns endpointing (ESPHome, native `?live=1`, LiveKit) — not device-endpointed ones (Wyoming).

**The smart-turn model is required by the template default.** `npm run setup:models:jetson` (or `npm run setup:models:smart-turn`) fetches `data/models/smart-turn/smart-turn-v3.1-cpu.onnx` from `pipecat-ai/smart-turn-v3`. Without it, `turnDetectorAvailable` returns false and acoustic endpointing silently stays dormant — you keep the raw 550ms VAD with no pause protection.

## Alternatives evaluated (and why they lost)

Benchmarked through the full Domia pipeline on this hardware (see `evals/bench-results/*.json`, each file embeds its config snapshot):

- **Ollama**: llm p50 1539ms → replaced by llama-server (841ms) — same llama.cpp underneath, less per-request overhead.
- **llama-server + n-gram speculative decoding**: p50 got 17% _worse_ — conversational replies rarely repeat the prompt, so drafts miss.
- **NVIDIA TensorRT-Edge-LLM** (the official Jetson runtime): its engine is genuinely faster per parameter (25 tok/s decode on a 4B), but its experimental OpenAI server has no prefix/KV caching (upstream issues #94/#74) — it re-prefills the whole persona prompt every turn and loses end-to-end (llm p50 1819ms). Worth re-benchmarking when those issues land.
- **MLC / vLLM containers**: no builds published for L4T R39 / CUDA 13 at evaluation time (2026-07).
