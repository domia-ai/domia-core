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
make install-services
#    Already have the system units? Add only the STT one, no sudo at all:
make nemo-service
#    Hub tuning WITHOUT sudo: the launcher reads config/llm-server.env first and
#    systemd restarts the (user-owned) process. jetson.json presumes two server
#    slots (slotAffinityEnabled + llmConcurrency 2), so give llama-server -np 2
#    and a context to match (LLM_CTX is the total shared by all slots;
#    every knob is listed in config/llm-server.env.example):
printf 'LLM_CTX=8192\nLLM_EXTRA_FLAGS="-np 2 -ctk q8_0 -ctv q8_0"\n' > config/llm-server.env && pkill -x llama-server
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
- **Services**: `make install-services` installs domia, llama-server **and nemo-speech** under systemd (`Restart=always`, domia ordered after llama-server; nemo-speech is a user unit, which the system manager cannot order against) — the appliance survives reboots, crashes and OOM kills. Install every server the config points at: the hub ran `stt.engine=NEMO_SPEECH` with nemo-speech started by hand, and one reboot silently killed all voice input (text `/chat` kept passing, the Voice PE showed a red ring) until the unit existed. `make services` prints which units are enabled.
- **Memory on 8 GB**: llama-server with the default cache RAM sits near 3.7 GB RSS; `--cache-ram 0` brought it to 2.9 GB, and the launcher/makefile default `LLM_CACHE_RAM_MB=256` keeps it near 3.4 GB without the re-prefill cost (see "llama-server memory on an 8 GB box" below); the per-box flags the hub needs (`-np 2`, q8 KV, `LLM_CTX=8192`) go in `config/llm-server.env` as in the quick start, and a plain `pkill -x llama-server` applies them without sudo. nemo-speech needs ~1–1.5 GB on top; measured after both: ~2 GB available. The native Ollama idles at ~27 MB, so disabling it is optional.

## Resetting a node without losing its state

Schema changes apply with `npm run db:reset` (no migrations), which wipes the node's DB — config, providers, satellites **and the mind** (facts, evidence, episodes, knowledge, user model, emotion history). `node-snapshot` only carries config + satellites + the v1 persona; `mind-dump` carries the rest, strictly (it remaps rows to the identity the fresh boot re-seeds, refuses to write on any content conflict, and verifies every row after writing). The order is mandatory and **always offline** — never delete a DB while the runtime can still write it:

```
# 1. snapshots (node up, loopback)
EVAL_URL=http://127.0.0.1:3100 EVAL_DOMIA_KEY=DOMIA_JETSON EVAL_DB=data/db/jetson.db \
  npm run evals -- mind-dump dump --out data/snapshots/DOMIA_JETSON-$(date -u +%Y%m%dT%H%M%SZ).json
EVAL_DB=data/db/jetson.db npm run evals -- mind-dump verify data/snapshots/<that file>      # must pass, else STOP
EVAL_URL=http://127.0.0.1:3100 EVAL_DOMIA_KEY=DOMIA_JETSON npm run evals -- node-snapshot snapshot --dir evals/results/node-snapshot

# 2. stop the node and WAIT until the process is gone (Restart=always must not race the reset)
sudo systemctl stop domia            # dev Mac: pkill -f "nodemon --watch src"
while pgrep -f "[n]ode (\./)?build/index\.js" >/dev/null; do sleep 1; done

# 3. reset offline, rebuild if the source changed, start
npm run db:reset && npm run build && sudo systemctl start domia
until curl -sf http://127.0.0.1:3100/health >/dev/null; do sleep 2; done

# 4. restore the mind FIRST (remaps + verifies, exits 1 on any miss), then node + config + satellites
#    (secrets come from the environment, never from files in docs)
EVAL_DB=data/db/jetson.db npm run evals -- mind-dump restore data/snapshots/<that file>
DOMIA_PROVIDER_TOKEN_HOME_ASSISTANT=<home-assistant long-lived token> DOMIA_PROVIDER_TOKEN_MUSIC_ASSISTANT=<music assistant token> \
  EVAL_URL=http://127.0.0.1:3100 EVAL_DOMIA_KEY=DOMIA_JETSON \
  npm run evals -- node-snapshot restore --dir evals/results/node-snapshot
```

**Restore order matters (learned 2026-09-09):** run `mind-dump restore` BEFORE `node-snapshot restore`. The strict mind dump carries raw `skill_provider` rows (including the provider's `auth`), so restoring it after the config restore overwrites the provider with the dumped token — when the provider now points at a different Home Assistant (the house instead of a lab instance) that means 401s and withheld tools. With config restored last, the bundle (plus the per-provider `DOMIA_PROVIDER_TOKEN_<NAME>` variables from the environment — name upper-cased, non-alphanumerics → `_`; `DOMIA_PROVIDER_TOKEN` is the fallback for any provider without its own) wins; satellites keep the encryption key the dump restored because the satellite upsert leaves out any secret the request body omits.

**Take the config snapshot BEFORE the new code runs (learned 2026-09-10):** `node-snapshot snapshot` calls `GET /config` on the running node; once the code expects columns the DB does not have yet, that call fails and the restore silently falls back to the previous snapshot file. Order per node: dump + verify + `node-snapshot snapshot` on the OLD code, then build/pull the new code, then freeze → reset → kill → restore.

**Stopping the service without sudo for the reset:** `domia` is a system unit with `Restart=always`, so freeze it, reset, then kill it: `kill -STOP $(systemctl show domia -p MainPID --value)`, `npm run db:reset`, `kill -KILL <pid>` — systemd brings the fresh DB up on the new build within a few seconds, and the frozen process can never write to the deleted file.

The dump carries the rows of every identity the node **hosts** (`is_hosted = 1`: the principal and co-tenants created with `POST /identities`); `fact_evidence` rows are kept only when their fact is in the dump, and `verify`/`restore` fail loudly on a dump whose evidence points at a missing fact. Peers discovered over MQTT are **not** dumped — the fresh node rediscovers them. `restore` refuses to write while any dumped identity is missing from the fresh DB: recreate hosted co-tenants first (`POST /identities`), or pass `--defer-missing` to restore the others now — the missing identities' rows are skipped, reported, and stay in the file; re-run the same `restore` once they exist (matched rows are idempotent). `skill_provider` and `satellite_config` are matched by natural key (`domia_id + name` / `domia_id + satellite_id`) and updated in place rather than duplicated; `node-snapshot restore`, run right after, then lays the config bundle (and its environment-supplied tokens) over them.

```bash
EVAL_DB=data/db/jetson.db npm run evals -- mind-dump counts

# 5. health gate: one real turn
curl -s -X POST -H 'content-type: application/json' -d '{"text":"What time is it?"}' 'http://127.0.0.1:3100/chat?domiaKey=DOMIA_JETSON'
```

Two gotchas: a file copy of the DB must checkpoint the WAL first (`sqlite3 data/db/jetson.db ".backup copy.db"`, never `cp` alone), and any raw `sqlite3` delete runs on a connection without `PRAGMA foreign_keys = ON`, so it can leave orphans the app never creates — prefer the API or `mind-dump`. Chapter S replaces this bridge with a versioned export and `db:reset --preserve-mind`.

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

Re-rendering the unit does not restart an already-running server (`enable --now` is a no-op on an active unit): `pkill -x llama-server` afterwards. Per-box flags that must survive every re-render live in `config/llm-server.env` (gitignored, read first by the launcher); on the Orin that file carries the two-slot tuning shown in the quick start.

Notes:

- **Never pass `--cache-reuse` on Orin.** Tested 2026-07 (values 64/256, inspired by NVIDIA's reachy-mini-assistant which runs it with fp16 KV and `-np 1`): no measurable benefit — and the flag silently stayed in the installed unit. Diagnosed 2026-08: combined with `-np 2` + quantized KV (`-ctk/-ctv q8_0`) + flash attention, its chunk-shift reuse makes the per-turn divergent-tail prefill run at 15-70 tok/s instead of ~750 (llm ttft p50 2585ms vs 291ms all-layers-on). Removing the flag was the single biggest latency win of that investigation. If you regenerate the unit with `make llm-service`, keep `LLM_EXTRA_FLAGS` free of it.
- **Chat template quirk (Llama 3.x GGUFs).** The chat template embedded in Llama 3.x GGUFs JSON-quotes every tool result (`message.content | tojson`); on the Orin that single pair of quotes flips llama3.2:3b from answering ("The office lights are on.") to re-calling the same tool (verified 2026-09-01 with `/apply-template` + `/completion` at temperature 0, 2/2 each way). Domia handles it engine-agnostically (a repeated read forces a no-tools round; a reply that is tool-call JSON is suppressed), at the cost of one extra LLM round (~1.5s) on state queries. Domia ships no model-specific template: if you want the shorter path for a Llama 3.x model, export the GGUF's template (`GET /props` → `chat_template`), make the `tool`/`ipython` branch render string content raw, and point `LLM_CHAT_TEMPLATE=<your file>` at it when running `make llm-server` / `make llm-service`. Re-evaluate whenever the champion model changes.
- **Cap llama-server's host prompt cache on 8GB — cap it, don't kill it.** llama-server keeps evicted slot KV states in host RAM (`--cache-ram`, default 8192 MiB). On the Orin that cache grows until the box swaps: measured 2026-09-02 with `-np 2 -c 8192`, llama-server RSS 4.9GB, 6.4GB of the 8GB swapfile in use, 83MB free, and a plain chat turn stalled 21s between "selected slot" and "launch_slot" while the server made room for cache entries. Set a bound (`LLM_CACHE_RAM_MB=256`, the launcher default) rather than `0`: slot affinity keeps one lane's KV in its slot, but the agent-finalize lane shares that slot and evicts it, so with the cache off every tool turn and the turn after it re-prefill from scratch (llm_ttft p95 965 → 1550). Keep an eye on `free -m`: llama-server + nemo-speech + domia + HA in Docker is the whole budget.
- **Restarting without sudo.** Both units run as your user with `Restart=always`, so after `npm run build` (domia) or after changing llama-server settings a plain `kill $(systemctl show <unit> -p MainPID --value)` brings the new version up. Once the llama-server unit points at `scripts/llm-server.sh` (`make llm-service`, one sudo), every launcher variable (`LLM_GGUF`, `LLM_CTX`, `LLM_EXTRA_FLAGS`, `LLM_CACHE_RAM_MB`, `LLM_CHAT_TEMPLATE`) can be overridden from the gitignored `config/llm-server.env` — that is how model candidates are swapped on the hub for the tournament without touching the unit again. `sudo` is only needed when the unit file itself changes.
- **Flash attention** is already `auto` in current llama.cpp — it enables itself on CUDA/Metal; no flag needed.
- Keep Domia's `llm.contextWindow` (DB) ≤ the server's `LLM_CTX` — the server silently truncates beyond its own limit.
- `useCompactPrompt` measured **worse** on this setup (total p50 +906ms): llama-server's prefix cache already makes the rich persona prompt free after the first turn, and the compact variant loses the style guidance.

## Physical ceiling

At MAXN_SUPER the Orin Nano has 102 GB/s of memory bandwidth → a 3B Q4 model tops out around ~50 tok/s decode no matter the engine. `llama-server` delivers ~20 tok/s in-pipeline; treat bigger claims with suspicion.

## STT choice (validated, not assumed)

**Nemotron-3.5-ASR-streaming 0.6b int8 @560ms** (`STREAMING_TRANSDUCER` engine, the default) is a cache-aware streaming recognizer — it decodes DURING speech, so the transcript is ~ready at the endpoint instead of after it. Measured on this hardware (WER-gated, 16-utterance corpus — rerun with `npm run evals -- stt <label>`): **WER 10.3% via the /voice batch path, ~6.5% on the live satellite** (which supplies extra pre-roll), both **beating parakeet-tdt (11.5%)**. It replaced parakeet as the default on 2026-07 once (a) sherpa shipped stateful streaming for the nemotron/parakeet line (upstream PRs #3575/#3728, FR #3573 — the earlier "buffered" parakeet-unified was 4× slower than real-time and is NOT this model) and (b) we added a cache warm-up so it stops clipping onsets (see below).

**Multilingual lane — `NEMOTRON_STREAMING`.** The same model files also back a dedicated family that pins the decode language per stream (`stream.setOption("language", …)`, sherpa ≥1.13.7): set `stt.engine = NEMOTRON_STREAMING`, `stt.modelPath = data/models/nemotron-3.5-streaming-560`, `stt.language = en|es|…` or `auto`. `STREAMING_TRANSDUCER` on the same files ignores `stt.language` and always auto-detects; `NEMOTRON_STREAMING` with `stt.language = auto` reproduces it exactly. Measured on the Mac dev box (in-process batch decode, sherpa 1.13.8):

| corpus                             | PARAKEET | STREAMING_TRANSDUCER | NEMOTRON_STREAMING `auto` | NEMOTRON_STREAMING pinned |
| ---------------------------------- | -------- | -------------------- | ------------------------- | ------------------------- |
| EN (16 utts, `evals/fixtures/stt`) | 10.3%    | 7.1%                 | 7.1%                      | 8.2% (`en`)               |
| ES (9 utts, `golden-es`)           | —        | 3.8%                 | 3.8%                      | **1.3%** (`es`)           |

**Pin for Spanish, leave English on `auto`.** Pinning `es` cuts Spanish WER by two thirds; pinning `en` costs ~1pt versus letting the model detect. Decode cost is unchanged (p50 ~307ms EN / ~355ms ES per utterance either way, versus ~89ms for offline parakeet). Everything else (partials, endpointing rules, pooling, onset warm-up) behaves identically. Fetch the model with `npm run setup:models:nemotron`.

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

## llama-server memory on an 8 GB box: cap `--cache-ram`, don't disable it (2026-09-11)

llama-server's host prompt cache is unbounded at its stock 8192 MiB allowance; on the Orin it reached 4.8 GB RSS after five days and pushed 6.4 GB into swap (satellite STT went empty or garbled, latencies doubled). The first fix was `--cache-ram 0`, which disables the cache outright — and that costs latency: with `-np 2` the chat lane and the agent-finalize lane share a slot, their rendered prompts diverge ~25 tokens in, and with nothing to save or restore every lane switch re-prefills the whole prompt. Measured on the bench (`satellite-bench`, 4 runs, llama3.2:3b):

| `--cache-ram`      | llm_ttft p50 / p95 | llm_fresh p50 / p95 | llama-server RSS | available |
| ------------------ | ------------------ | ------------------- | ---------------- | --------- |
| default (uncapped) | 439 / 965          | 324 / 753           | grows to 4.8 GB  | swaps     |
| 0 (disabled)       | 468 / **1550**     | 342 / **1224**      | 3.30 GB          | 2.9 GB    |
| 256 MiB            | 437 / **961**      | 321 / **753**       | 3.40 GB          | 1.6 GB    |
| 512 MiB            | 435 / 964          | 317 / 753           | 3.69 GB          | 1.3 GB    |

A bounded cap gets the full latency back for ~100 MB: `make llm-server` / `make llm-service` pass `--cache-ram 256` by default (`LLM_CACHE_RAM_MB ?= 256` in the makefile; per-node overrides live in `config/llm-server.env`, read by the launcher, git-ignored). `0` disables the cache, `-1` uncaps it — neither is what you want on 8 GB. `--cache-idle-slots` is silently disabled whenever `--cache-ram` is 0; the startup line `--cache-idle-slots requires --cache-ram, disabling` is the tell that the box is paying the re-prefill tax. A unit installed before 2026-09-10 was written by hand and lacks the flag: re-render it once with `make llm-service` (asks for sudo). Recovery without sudo: `kill` the process; the unit's `Restart=always` brings it back fresh.

## When the whole hub turns slow at once: the GPU may have failed to power on (2026-09-13)

After an unclean restart the Orin's GPU can come back without its firmware: the kernel loops on `nvgpu: ... ACR bootstrap failed` / `invalid mem acr_falcon2_sysmem_desc` (100k+ lines in `journalctl -k -b`), `/sys/devices/platform/bus@0/17000000.gpu/power/runtime_status` stays `suspended`, and every GPU consumer degrades silently: llama-server keeps answering `/health` but runs on CPU (prefill ~30 tok/s instead of ~800, turns 15 s, `LLM/SLOT_WAIT_TIMEOUT`), and NeMo-Speech crash-loops with `use_gpu=true but no matching GPU device found`. Nothing in Domia is wrong in that state and no service restart helps; the only fix is `sudo reboot`. Check with:

```bash
journalctl -k -b | grep -c "ACR bootstrap failed"     # must be 0
curl -s localhost:11435/completion -d '{"prompt":"word word word ...","n_predict":8}' | jq .timings.prompt_per_second
```

## The hub at the house (2026-09-09)

The Jetson now lives on the home LAN as `jetson.local` (DHCP; 192.168.0.107 at the time of writing — prefer the mDNS name in configs). Home Assistant runs on its own hardware as `homeassistant.local` (DHCP; it has already changed address once — never pin its IP in configs), so the Jetson's `homeassistant` container is stopped with `--restart=no` (its `~/ha-config` is kept, nothing deleted) and the hub's provider points at `http://homeassistant.local:8123/api/mcp`; the token is re-injected from `DOMIA_PROVIDER_TOKEN` at restore time. The Mosquitto container stays on the Jetson as the mesh broker: every other node sets `mqttLocal.host = jetson.local`. `sqlite3` is not installed on the Jetson — use the evals (`mind-dump counts`) or the HTTP API to inspect the DB.

## Music Assistant at the house (second MCP provider, 2026-09-12)

Music Assistant (MA) runs as the Home Assistant app on the house HA (homeassistant.local). Pin **MA 2.10.3**: its MCP server (the _FastMCP Server_ plugin) is explicitly experimental and tool wire names may change between releases — re-run `music-scenarios` after every MA upgrade.

Setup, in order:

1. HA → Settings → Apps → install **Music Assistant**; in MA enable the **Spotify** provider (Premium login) and keep **Sendspin** on (default). Each Voice PE appears as a player under its own name; note the exact names.
2. MA → Settings → Plugins → add **FastMCP Server**. Permissions: leave `query_*` ON; turn ON `control_playback`, `control_volume`, `control_media`, `control_players`; keep every `delete_*`, `edit_*`, `debug_*` and `config_*` OFF; `require_confirmation` may stay ON (v1 calls no destructive tool and Domia has an elicitation presenter); `meta_tool_discovery` OFF (it collapses the catalog to three meta tools and the specialization expects the real wire names). Open the **Connect Wizard** and mint a token for "Domia".
3. Probe from the hub (the client sends no `Origin` header; a `403 Forbidden Origin` means a proxy injects one):

```bash
curl -s -X POST http://homeassistant.local:8095/mcp/v1 -H "Authorization: Bearer $MA_TOKEN" -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | head -c 600     # expect playback_* / library_* names
```

4. Tell each satellite which MA player it is: `PATCH /satellites/<satelliteId>/settings {"mediaPlayerName":"<exact MA player name>"}` (rides `node-snapshot`; "play jazz" with no room then targets the speaker you spoke to).
5. Add the provider on the hub — either from the console preset _Music Assistant_ (kind `music-assistant`, whitelist of the eight control tools, bearer token) or `POST /config?domiaKey=DOMIA_JETSON` with `skillProviders: [<the existing home-assistant row>, {name:"music-assistant", protocol:"mcp", type:"http", url:"http://homeassistant.local:8095/mcp/v1", auth:{kind:"bearer", token:"…"}, toolWhitelist:[…], descriptor:{version:1, kind:"music-assistant"}, trustTier:"untrusted"}]`. `replaceSkillProviders` deletes rows not in the list, so always send both. Gate: `GET /skills` shows both providers connected, the music one with the eight controls plus the virtual `music_play` / `music_now_playing`, and `specialization.players ≥ 1`.
6. Fill `evals/fixtures/sites/casa.json` `speakers` with the real player names, then run both suites **on the Jetson itself** (they read and write the node's DB directly, so `EVAL_DB` must be the hub's file): `EVAL_MUSIC_SITE=casa EVAL_URL=http://127.0.0.1:3100 EVAL_DB=data/db/jetson.db EVAL_DOMIA_KEY=DOMIA_JETSON npm run evals -- music-scenarios` (it plays on the real speakers) and `EVAL_HA_SITE=casa EVAL_URL=http://127.0.0.1:3100 EVAL_DB=data/db/jetson.db EVAL_DOMIA_KEY=DOMIA_JETSON npm run evals -- tool-scenarios` (must stay 14/14 with both providers).

Interplay with the Voice PE: the firmware ducks music 20 dB while Domia listens and speaks and un-ducks afterwards; Domia now stops/pauses only its own announcement stream (`announcement: true`), so barge-in keeps the music playing. Two things to observe once at the house and record in the voice ledger: a wake within 3 s after a reply keeps the music; a barge-in mid-reply keeps the music; and whether PAUSE on the announcement pipeline is honoured. Ducking policies, wake verification under music and MA-routed announcements are documented follow-ups in `.claude/docs/2026-09-music-assistant-mcp-plan.md`.
