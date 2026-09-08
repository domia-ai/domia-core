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
#    Fetches STT (nemotron streaming + parakeet fallback), TTS (piper),
#    Silero VAD, KWS, embeddings
#    and the smart-turn turn-detector — the template enables acoustic
#    endpointing, which is a no-op unless smart-turn-v3.2-cpu.onnx is present.
bash scripts/download-models.sh jetson

# 4. Give your Domia the Jetson role (LLM via OPENAI_COMPATIBLE → :11435/v1)
npm run db:reset && npm run build && npm start   # if first boot on this machine
npm run dev-cli -- config import templates/jetson.json

# 5. Run the whole hub under systemd (survives reboots, crashes and OOM kills):
#    llama-server + domia are system units (sudo once); nemo-speech is a USER unit
#    with linger (no sudo, starts at boot without a login)
make install-services LLM_CACHE_RAM_MB=0
#    Already have the system units? Add only the STT one, no sudo at all:
make nemo-service
#    Cache RAM off on a running llama-server WITHOUT sudo: the launcher reads
#    config/llm-server.env first, and systemd restarts the (user-owned) process
echo LLM_CACHE_RAM_MB=0 >> config/llm-server.env && pkill -x llama-server
#    optional: the native Ollama idles at ~27MB; disable it only if you want
#    (sudo systemctl disable --now ollama)
#    after a reboot, prove it: every port up, every unit enabled
make services
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

On **macOS** `make llm-service` installs a launchd user agent (`ai.domia.llm-server`, no sudo, survives login) using the same `scripts/llm-server.sh` launcher as the Linux unit; restart it with `launchctl kickstart -k gui/$(id -u)/ai.domia.llm-server`. The dev Mac runs llama-server by default for the same reason the hub does: Ollama's lenient tool-call parser hides failures that llama-server surfaces (one call per message on Llama 3.x, tool names outside the `tools` list, quoted tool results). To compare models on the exact production server, `scripts/llm-tournament.sh label=path.gguf ...` swaps the agent per candidate and runs `npm run evals -- tool-scenarios` against the live node (Ollama blobs can be used in place: see `make llm-gguf LLM_OLLAMA_TAG=qwen3.5/4b`).

## Jetson-specific tuning (already encoded in `templates/jetson.json`)

- **Power mode**: use MAXN_SUPER (`sudo nvpmodel -m 2`) — the doctor checks this.
- **Headless**: `sudo systemctl set-default multi-user.target`. The desktop costs ~1GB of unified memory — enough to push model layers off the GPU.
- **One resident model**: the template nulls `reflectionModelName` so the reflection pass never loads a second model (8GB cannot hold two — the reload thrash costs 20-30s per turn).
- **Swap**: add an 8GB swapfile (see doctor output). Memory spikes otherwise OOM-kill services.
- **TTS**: VITS (piper `libritts_r-medium`) on CPU with 4 threads and per-sentence streaming on. `pacerEnabled` must stay **off** on this hardware (its batches outrun the 5s runway and cut long replies).
- **Services**: `make install-services LLM_CACHE_RAM_MB=0` installs domia, llama-server **and nemo-speech** under systemd (`Restart=always`, domia ordered after the servers) — the appliance survives reboots, crashes and OOM kills. Install every server the config points at: the hub ran `stt.engine=NEMO_SPEECH` with nemo-speech started by hand, and one reboot silently killed all voice input (text `/chat` kept passing, the Voice PE showed a red ring) until the unit existed. `make services` prints which units are enabled.
- **Memory on 8 GB**: llama-server with the default cache RAM sits near 3.7 GB RSS; `LLM_CACHE_RAM_MB=0` (in `config/llm-server.env`, then `pkill -x llama-server` — no sudo, systemd restarts it) brought it to 2.9 GB. nemo-speech needs ~1–1.5 GB on top; measured after both: ~2 GB available. The native Ollama idles at ~27 MB, so disabling it is optional.

## Resetting a node without losing its state

Schema changes apply with `npm run db:reset` (no migrations), which wipes the node's DB — including the Home Assistant provider row, its token, the satellites and the mind. `evals/node-snapshot.ts` makes that a 30-second round trip:

```
# before the reset (any node, run against its loopback API)
EVAL_URL=http://127.0.0.1:3100 EVAL_DOMIA_KEY=DOMIA_JETSON npm run evals -- node-snapshot snapshot --dir evals/results/node-snapshot

npm run db:reset && kill $(systemctl show domia -p MainPID --value)   # Restart=always brings the new schema up

# after the node answers /health again — exports strip secrets, so the provider token is re-injected from the environment
DOMIA_PROVIDER_TOKEN=<home-assistant long-lived token> EVAL_URL=http://127.0.0.1:3100 EVAL_DOMIA_KEY=DOMIA_JETSON \
  npm run evals -- node-snapshot restore --dir evals/results/node-snapshot
```

`restore` posts the config bundle (all sections, skill providers with the token, delegations), re-creates the satellites (and their wake words) and imports the mind. Keep the token in an env file with mode 600 rather than on the command line.

## Hardening the hub

Once the Jetson serves rooms beyond the bench, follow `docs/DEPLOY.md`: `make dev-certs CERT_NODE=jetson` and the three `DOMIA_TLS_*` env lines turn on HTTPS + gRPC TLS (peers switch automatically), `DOMIA_MESH_SECRET_NEXT` rotates the mesh secret without downtime, `make mosquitto-acl` locks the broker topics per node, and `DOMIA_OTEL_EXPORTER_URL` exports one trace per turn (`domia.llm` carries the GenAI token attributes — useful next to the latency matrix). `make doctor` prints the posture of `DOMIA_ENV`.

## STT server (NeMo-Speech.cpp)

`templates/jetson.json` (the default) runs STT **in-process** (`stt.engine=STREAMING_TRANSDUCER`, see "STT choice" below); the NeMo-Speech server here is the **alternative external lane**, selected by `templates/jetson-nemo.json` (`stt.engine=NEMO_SPEECH`, `stt.baseUrl=http://127.0.0.1:8600/v1`). It uses NVIDIA's NeMo-Speech.cpp — a native prebuilt binary (no Docker, no Python): `make nemo-speech` downloads the platform tarball (Vulkan build on Orin — the cuda13 build segfaults on sm_87) and pulls the multilingual `nemotron-3.5` ASR model; `make nemo-service` installs it under systemd on :8600 (`--no-warmup` is mandatory on Orin — serve-mode warmup hits a GGML assert). The release tarball extracts to a versioned directory (`nemo-speech-<version>-linux-aarch64-vulkan/`); the makefile resolves it, so never assume `~/nemo-speech/nemo-speech/bin`. If the identity uses this lane, the unit is **required**, not optional — see Services above. Import `templates/jetson-nemo.json` (or set `stt.engine=NEMO_SPEECH` + `stt.baseUrl`) to switch the identity to it. On macOS use `make nemo-serve` (Metal build, foreground).

## Tuning the llama-server process

Server-side flags belong to the provider layer (the server process), not to Domia's DB — Domia is a client of an OpenAI-compatible endpoint and per-identity DB config governs only what rides each request (`modelName`, `temperature`, `numPredict`, `baseUrl`). The makefile exposes the server knobs:

```bash
# regenerate the systemd unit with different flags (examples):
make llm-service LLM_CTX=8192                                  # bigger context (needs RAM)
make llm-service LLM_EXTRA_FLAGS="-ctk q8_0 -ctv q8_0"         # halve KV cache memory (larger models/contexts)
make llm-service LLM_GGUF=data/models/gguf/my-model.gguf       # different model file
```

Notes:

- **Never pass `--cache-reuse` on Orin.** Tested 2026-07 (values 64/256, inspired by NVIDIA's reachy-mini-assistant which runs it with fp16 KV and `-np 1`): no measurable benefit — and the flag silently stayed in the installed unit. Diagnosed 2026-08: combined with `-np 2` + quantized KV (`-ctk/-ctv q8_0`) + flash attention, its chunk-shift reuse makes the per-turn divergent-tail prefill run at 15-70 tok/s instead of ~750 (llm ttft p50 2585ms vs 291ms all-layers-on). Removing the flag was the single biggest latency win of that investigation. If you regenerate the unit with `make llm-service`, keep `LLM_EXTRA_FLAGS` free of it.
- **Chat template quirk (Llama 3.x GGUFs).** The chat template embedded in Llama 3.x GGUFs JSON-quotes every tool result (`message.content | tojson`); on the Orin that single pair of quotes flips llama3.2:3b from answering ("The office lights are on.") to re-calling the same tool (verified 2026-09-01 with `/apply-template` + `/completion` at temperature 0, 2/2 each way). Domia handles it engine-agnostically (a repeated read forces a no-tools round; a reply that is tool-call JSON is suppressed), at the cost of one extra LLM round (~1.5s) on state queries. Domia ships no model-specific template: if you want the shorter path for a Llama 3.x model, export the GGUF's template (`GET /props` → `chat_template`), make the `tool`/`ipython` branch render string content raw, and point `LLM_CHAT_TEMPLATE=<your file>` at it when running `make llm-server` / `make llm-service`. Re-evaluate whenever the champion model changes.
- **Cap llama-server's host prompt cache on 8GB.** llama-server keeps evicted slot KV states in host RAM (`--cache-ram`, default 8192 MiB). On the Orin that cache grows until the box swaps: measured 2026-09-02 with `-np 2 -c 8192`, llama-server RSS 4.9GB, 6.4GB of the 8GB swapfile in use, 83MB free, and a plain chat turn stalled 21s between "selected slot" and "launch_slot" while the server made room for cache entries. Run the unit with `LLM_EXTRA_FLAGS="... --cache-ram 0"` (slot affinity already keeps the hot KV in the slot; the host copy buys nothing on one identity) and keep an eye on `free -m`: llama-server + nemo-speech + domia + HA in Docker is the whole budget.
- **Restarting without sudo.** Both units run as your user with `Restart=always`, so after `npm run build` (domia) or after changing llama-server settings a plain `kill $(systemctl show <unit> -p MainPID --value)` brings the new version up. Once the llama-server unit points at `scripts/llm-server.sh` (`make llm-service`, one sudo), every launcher variable (`LLM_GGUF`, `LLM_CTX`, `LLM_EXTRA_FLAGS`, `LLM_CACHE_RAM_MB`, `LLM_CHAT_TEMPLATE`) can be overridden from the gitignored `config/llm-server.env` — that is how model candidates are swapped on the hub for the tournament without touching the unit again. `sudo` is only needed when the unit file itself changes.
- **Flash attention** is already `auto` in current llama.cpp — it enables itself on CUDA/Metal; no flag needed.
- Keep Domia's `llm.contextWindow` (DB) ≤ the server's `LLM_CTX` — the server silently truncates beyond its own limit.
- `useCompactPrompt` measured **worse** on this setup (total p50 +906ms): llama-server's prefix cache already makes the rich persona prompt free after the first turn, and the compact variant loses the style guidance.

## Physical ceiling

At MAXN_SUPER the Orin Nano has 102 GB/s of memory bandwidth → a 3B Q4 model tops out around ~50 tok/s decode no matter the engine. `llama-server` delivers ~20 tok/s in-pipeline; treat bigger claims with suspicion.

## STT choice (validated, not assumed)

**Nemotron-3.5-ASR-streaming 0.6b int8 @560ms** (`STREAMING_TRANSDUCER` engine, the default) is a cache-aware streaming recognizer — it decodes DURING speech, so the transcript is ~ready at the endpoint instead of after it. Measured on this hardware (WER-gated, 16-utterance corpus — rerun with `npm run evals -- stt <label>`): **WER 10.3% via the /voice batch path, ~6.5% on the live satellite** (which supplies extra pre-roll), both **beating parakeet-tdt (11.5%)**. It replaced parakeet as the default on 2026-07 once (a) sherpa shipped stateful streaming for the nemotron/parakeet line (upstream PRs #3575/#3728, FR #3573 — the earlier "buffered" parakeet-unified was 4× slower than real-time and is NOT this model) and (b) we added a cache warm-up so it stops clipping onsets (see below).

**Streaming onset warm-up (required for any online engine).** Streaming recognizers start with a cold cache and no left-context, so the first word of a bare utterance gets clipped ("Turn on" → "On"). `transcribe()` in `stt-engine/utils/inference.ts` prepends `decodePaddingMs` (600ms) of leading silence for `entry.online` engines only — offline parakeet sees the whole utterance at once and is untouched. This makes the streaming engine robust on every path, not just the satellite (whose pre-speech roll already supplied context). Keyed on the engine class, not the model name.

**Fallback — Parakeet TDT 0.6b v2 int8** (offline/batch) stays downloaded and is the safe revert: set `stt.engine = PARAKEET`, `stt.modelPath = data/models/parakeet-tdt-06b-v2` (2 fields, no re-download). It survived the original 5-model tournament (whisper-tiny +8pt, moonshine-tiny +10pt, zipformer-2023 +15pt all failed the gate; 3.19% LibriSpeech test-other, unbeaten at its size on CPU) and is more robust (no onset dependence). Keep it if streaming ever misbehaves. The streaming default needs `poolWarmWorkers ≥ 2` + `maxConcurrentStreamingSessions ≥ 2` (a session pins a pool worker) — the template ships 2/3 and a 2s `sessionIdleTimeoutMs` so ambient noise doesn't strand workers.

Endpointing (measured over the WS satellite path with server VAD): the template ships `wakeWord.vadMinSilenceS: 0.3` + `vadEndOfSpeechMs: 150` = a **450ms** silence debounce (down from the 700ms default). Pure silence-VAD caps out there — pushing lower cuts anyone who pauses mid-sentence (pauses ≥600ms split utterances at any setting). To get past that floor the template also enables the **smart-turn v3.2 turn-detector** (`acousticEndpointingEnabled: true`, `acousticEndpointCompleteThreshold: 0.7`): when the VAD hits silence it asks the model whether the utterance is acoustically complete and _holds_ (keeps listening) if you're mid-sentence, so the debounce can stay aggressive without clipping natural pauses. Validated on real voice — it reliably held mid-sentence pauses ("Set a timer for… thirty seconds") that pure VAD split, with no measurable added latency on complete phrases. The gate runs on the CPU (~12ms/inference), holds are hard-capped at 2s after VAD silence (`ACOUSTIC_MAX_HOLD_MS` — an uncertain verdict fires with what it has instead of stranding the utterance), and it works on any satellite protocol where the hub owns endpointing (ESPHome, native `?live=1`, LiveKit) — not device-endpointed ones (Wyoming).

**The smart-turn model is required by the template default.** `bash scripts/download-models.sh jetson` (or `bash scripts/download-models.sh smart-turn`) fetches `data/models/smart-turn/smart-turn-v3.2-cpu.onnx` from `pipecat-ai/smart-turn-v3`. Without it, `turnDetectorAvailable` returns false and acoustic endpointing silently stays dormant — you keep the raw 550ms VAD with no pause protection.

### Optional: GPU ASR via llama.cpp (Qwen3-ASR)

The default STT is parakeet on CPU — on this 8GB box the whole GPU belongs to the LLM (measured: a resident ASR shaves LLM tok/s, and in-pipeline latency ties with CPU parakeet). But Domia ships an `OPENAI_COMPATIBLE` STT engine for boxes with GPU headroom (or a remote ASR server):

```bash
bash scripts/download-models.sh qwen3-asr   # fetch the GGUFs (~1GB)
make asr-service                 # install the ASR server as systemd (:11436)
# then point the identity at it:
#   stt.engine = OPENAI_COMPATIBLE, stt.baseUrl = http://127.0.0.1:11436/v1
```

Qwen3-ASR-0.6B halves the synthetic-corpus WER vs parakeet (5.9% vs 11.5%) but field A/B on real voice was a tie — keep parakeet unless it mishears names in daily use. Revert = set `stt.engine = PARAKEET` and stop `domia-asr`.

## Alternatives evaluated (and why they lost)

Benchmarked through the full Domia pipeline on this hardware (see `evals/bench-results/*.json`, each file embeds its config snapshot):

- **Ollama**: llm p50 1539ms → replaced by llama-server (841ms) — same llama.cpp underneath, less per-request overhead.
- **llama-server + n-gram speculative decoding**: p50 got 17% _worse_ — conversational replies rarely repeat the prompt, so drafts miss.
- **NVIDIA TensorRT-Edge-LLM** (the official Jetson runtime): its engine is genuinely faster per parameter (25 tok/s decode on a 4B), but its experimental OpenAI server has no prefix/KV caching (upstream issues #94/#74) — it re-prefills the whole persona prompt every turn and loses end-to-end (llm p50 1819ms). Worth re-benchmarking when those issues land.
- **MLC / vLLM containers**: no builds published for L4T R39 / CUDA 13 at evaluation time (2026-07).
