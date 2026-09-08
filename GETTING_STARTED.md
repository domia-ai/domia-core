# 🚀 Getting Started with Domia Core

This guide takes you from a clean machine to a running Domia. All speech inference runs **in-process** via `sherpa-onnx-node` and the LLM runs locally via **llama.cpp `llama-server`** (the template default, an OpenAI-compatible server) or **Ollama**.

> **▶ Want to see what you're building toward first?** Explore [**console.domia.ai**](https://console.domia.ai) — a read-only Console of real captured conversations across five personas (voices, emotion, memory, per-stage latency, and mesh delegation between spaces).

## 📋 Prerequisites

- **Node.js ≥ 24** (nvm recommended)
- **Docker with Compose v2** — runs Ollama (LLM) and Mosquitto (MQTT) — [install](https://www.docker.com/products/docker-desktop/). Docker Desktop bundles Compose; on Linux with the distro's `docker.io` package install it separately (`sudo apt install docker-compose-v2`) — `make doctor` checks for it.
- **sox** — audio playback (installed for you by `make install-deps`)

## 🛠️ Installation

```bash
# 1. Node dependencies
npm install

# 2. System binaries (sox), then verify
make install-deps
make doctor

# 3. Start Mosquitto and an LLM server
make mosquitto           # MQTT broker (Docker)
make llm-service         # llama.cpp llama-server as a service (systemd on Linux, launchd on macOS) — the templates' default
make install-services    # Linux hubs: llama-server + nemo-speech + domia as enabled systemd units — the only way voice survives a reboot (docs/DEPLOY.md §2)
# or, if you prefer Ollama: docker compose up -d ollama && make install-llama   # pulls llama3.2:3b (the same model the templates expect)

# 4. Download the on-device speech models (STT / TTS / VAD / wake word)
npm run setup:models     # or: make setup-models

# 5. MQTT user for this node (put the same name/password in the node's mqtt_config)
make mosquitto-user MQTT_USER=node-a MQTT_PASS=<password>

# 6. Create this node's env file (gitignored; only .env.example is tracked), then the database
cp .env.example .env     # edit DOMIA_KEY, ports, DATABASE_URL, DOMIA_MESH_SECRET
npm run db:reset         # no migrations — drizzle-kit push

# 7. Run your Domia
npm run dev
```

When you see `DOMIA is running and waiting for events...`, it's live on `http://localhost:3100`.

A fresh Domia boots **minimal** — heartbeat + HTTP + CLI + gRPC, every capability off, no models required. You then give it a role from a portable config template, by **CLI**:

```bash
npm run dev-cli -- config import templates/full-hub.json    # full local pipeline (STT/LLM/TTS)
# or
npm run dev-cli -- config import templates/thin-client.json # wake word + mic, delegates the rest
```

…or from the **web console** (apply a "Full hub" / "Thin client" template, or edit any setting). Either path persists the config and restarts the Domia to apply it. Install any missing models with `npm run setup:models` (or the web Models manager), then it reloads on the next restart.

### The provisioning lifecycle

```
        ┌──────────────────────────────────────────────────────────┐
        │  BORN-MINIMAL BOOT                                        │
        │  heartbeat + HTTP + CLI + gRPC · every capability OFF     │
        │  no models needed · never crashes on a missing model     │
        └─────────────────────────────┬────────────────────────────┘
                                      │  import a config template
                                      │  CLI: `config import`  ·  or  web Console: Apply
                                      ▼
        ┌──────────────────────────────────────────────────────────┐
        │  persistConfig  →  writes the bundle to the DB           │
        └─────────────────────────────┬────────────────────────────┘
                                      │  ALWAYS restart (no live/partial apply)
                                      ▼
        ┌──────────────────────────────────────────────────────────┐
        │  REBOOT · reloads cleanly from DB  →  now has its ROLE    │
        │  full-hub  → STT/LLM/TTS/intents (a compute hub)         │
        │  thin-client → wake-word + mic, delegates the rest       │
        └──────────────────────────────────────────────────────────┘
```

Change the role any time by importing a different template — it just persists + restarts again. A missing model degrades that stage (visible in `GET /config/health`) instead of crashing; install it and the next restart picks it up.

## 🧪 Testing individual components (no microphone needed)

**Evals runner.** `npm test` runs the pure battery (no node needed). `npm run evals -- --list` prints every suite grouped by battery (`pure`, `node`, `tool`, `quality`, `hardware`); `npm run evals -- <suite>` runs one suite against the node at `EVAL_URL`, `npm run evals -- node` the whole regression battery (`utility` suites run by name). `npm run dev-cli -- doctor` reports binaries and runtime services; `bash scripts/download-models.sh <name>` downloads a model set.

Use the developer CLI to exercise each engine in isolation:

```bash
npm run dev-cli -- tts -t "hello, this is my voice"     # text → speech
npm run dev-cli -- stt --file tmp/your-audio.wav        # speech → text
npm run dev-cli -- llm -p "say something kind"          # prompt → reply
npm run dev-cli -- status                               # health / config snapshot
npm run dev-cli -- mind                                 # inspect persona / emotion
```

You can also drive the **full pipeline** without a mic by POSTing a WAV to the HTTP endpoint:

```bash
curl -X POST http://localhost:3100/voice \
  -H 'content-type: application/json' \
  -d '{"filePath":"'"$PWD"'/tmp/your-audio.wav"}'
```

## 🔀 Run a second Domia (delegation / multi-room)

> **Dev-only convenience.** In production each Domia runs on its **own device** (a Raspberry Pi, a Mac mini, a NUC…) — one instance per host, with its own DB and ports. Running two (or more) instances on a single machine — separate env files, ports, DBs — exists **only** so you can exercise cross-Domia features (gRPC delegation, MQTT discovery, P2P symmetry) on one dev box without a second physical device.

Every Domia is just "a Domia" — its role is its DB config, not a label. Launch as many as you want: one **env file** per instance (device identity: `DATABASE_URL`, `DOMIA_KEY`, ports, log) and `DOMIA_ENV=<file> npm run dev`. No new package.json scripts. `.env` files are per-instance and gitignored (only `.env.example` is tracked), so create the second one by copying the example — `cp .env.example .env.b`, then edit its `DOMIA_KEY`, ports and `DATABASE_URL` (the `db:reset:b` / `dev:b` scripts are wired to `.env.b`):

```bash
npm run db:reset:b
npm run dev:b          # runs on http://localhost:3101

# give them complementary roles, then they delegate over the mesh:
DOMIA_ENV=.env      npm run dev-cli -- config import templates/full-hub.json
DOMIA_ENV=.env.b npm run dev-cli -- config import templates/thin-client.json
```

A third instance is just `cp .env.example .env.kitchen`, edit its identity, then `DOMIA_ENV=.env.kitchen npm run db:reset && DOMIA_ENV=.env.kitchen npm run dev`.

### Securing the mesh (optional, off by default)

Two nodes on a LAN talk plaintext HTTP/gRPC authenticated by `DOMIA_MESH_SECRET`. To encrypt: `make dev-certs` (self-signed CA + node cert under `data/certs/`), set `DOMIA_TLS_CERT_FILE` / `DOMIA_TLS_KEY_FILE` / `DOMIA_TLS_CA_FILE` in the node's env file and restart — peers learn the scheme from the heartbeat and switch to HTTPS/gRPC-TLS on their own, so you can migrate one node at a time. Secret rotation (`DOMIA_MESH_SECRET_NEXT` + `POST /mesh/rotate`), per-node broker users with topic ACLs (`make mosquitto-acl`) and OpenTelemetry traces (`DOMIA_OTEL_EXPORTER_URL`) are in **[docs/DEPLOY.md](./docs/DEPLOY.md)**; `make doctor` prints the current posture.

## 📡 Connect a satellite (off-the-shelf voice hardware)

A satellite is a small far-field mic/speaker in a room; your Domia does everything else. Five protocols are supported:

- **ESPHome** — stock Home Assistant voice hardware (e.g. the **Voice PE**) with **factory firmware, no reflash**.
- **Wyoming** — the Home Assistant satellite protocol.
- **LiveKit** — a WebRTC room transport for network satellites.
- **OpenAI-Realtime** — Domia as a local backend for OpenAI-Realtime clients.
- **WebSocket (native)** — Domia's reference protocol for custom builds.

Flow: open the web Console → your Domia → Satellites → **Discover** (mDNS scan finds ESPHome devices on the LAN) → bind it to the identity that owns that room. Wake word runs on the device; wake words, timers, and volume are managed from the Console. Satellites bind **per identity** — a hub hosting several room-identities routes each satellite to its room's Domia.

If discovery fails across VPNs/subnets, add the satellite manually by host/port (mDNS does not cross most VPN boundaries).

## 🧠 The companion layers (memory, emotion, knowledge)

The character layers ship **on by default** in the standard templates and cost ~nothing on the hot path (all learning happens in a background "reflection" pass on its own small model — pull `llama3.2:1b`):

- **Facts** — Domia learns durable facts about you from conversation (typed + confidence-gated) and recalls them by relevance.
- **Knowledge base** — _authored_ knowledge about its place. Add entries in the Console (Knowledge section) or via the API, and Domia answers those questions offline, no tools:

```bash
curl -X POST 'http://localhost:3100/knowledge?domiaKey=<KEY>' \
  -H 'content-type: application/json' \
  -d '{"title":"Wifi","content":"The network is CasaExample; password on the router card.","keywords":["wifi"]}'
```

- **Long-term memory** — when a session ends, a summary episode and an evolving model of the person are written; the next session starts with "previously…" context.
- **Emotion** — an 8-axis mood shades speaking speed/pitch per reply and decays toward the character's baseline.

All of it is per-identity DB flags (`module_settings`) — editable live from the Console.

## 📊 Measure it

Every turn persists per-stage timings (STT, LLM queue/TTFT, TTS first-chunk, TTFA, RSS) and logs one `TURN_COMPLETE` line:

```bash
npm run evals -- bench-voice                  # golden corpus end-to-end, prints a scorecard
LABEL=my-change npm run evals -- bench-voice  # labeled run, saved to evals/bench-results/
grep TURN_COMPLETE log/a.log | tail -5        # per-turn timing lines
```

Run a labeled bench before and after any tuning change to see exactly what moved.

## 🧩 Swapping engines & models

Everything is DB config — switch without touching code:

- **STT:** seven engines (Whisper, Moonshine, Zipformer, Parakeet, streaming-transducer in-process, plus OpenAI-compatible and NeMo-Speech external servers). Download alternatives with `bash scripts/download-models.sh whisper` / `zipformer` / `moonshine`, then set `stt_config.engine` + model path.
- **TTS:** six engines. Kokoro is the default (`bash scripts/download-models.sh kokoro`); pick a voice via `tts_config.voice_name` (e.g. `am_adam`, `bf_emma`). Others include **Vits**, **Matcha**, **Kitten**, **Pocket** (`bash scripts/download-models.sh pocket`, faster, clones a reference voice) and **Supertonic** — switch with `tts_config.engine`.
- **LLM:** the default is llama.cpp `llama-server` (OpenAI-compatible, `:11435/v1`) — swap the GGUF with `make llm-service LLM_GGUF=...`. With Ollama instead, `docker exec -it domia-ollama ollama pull <model>`, set `llm_model_config.engine=OLLAMA` and `model_name`.

Any config edit — via the web Console, `config import`, or `POST /config` — persists to the DB and restarts the Domia so it reloads cleanly from config. `POST /config/refresh` only re-reads the cached identity/heartbeat after an out-of-band DB write (e.g. activating a mind template); it does not reconfigure the pipeline.

## 🗣️ Speak another language (Spanish today, N-language ready)

Language is per-identity config — in a multi-room home each Domia can speak its own language. Spanish ships end to end, on the same **NeMo-Speech** STT + **llama-server** LLM stack as English (`templates/espanol.json` sets `stt.engine=NEMO_SPEECH` on `:8600/v1` and `llm.engine=OPENAI_COMPATIBLE` on `:11435/v1`):

```bash
# 1. Spanish model set: multilingual Parakeet STT model + Spanish Piper TTS voice + multilingual intent embeddings
bash scripts/download-models.sh espanol
# 2. serve STT and the LLM (same servers as English)
make nemo-serve          # NeMo-Speech STT server on :8600 (multilingual Parakeet)
make llm-service         # llama.cpp llama-server on :11435
# 3. apply the Spanish role
npm run dev-cli -- config import templates/espanol.json
```

Every spoken fixed string (confirmations, timers, fallbacks) comes from a language catalog; skill matching, memory recall, and Home Assistant entity resolution all follow the configured language. English stays the base/default, and the wake word stays English for now. Adding a language = one catalog entry in `src/utils/language-catalogs/` + a config template.

## 🤖 Running Domia on a Jetson

Domia runs great as a dedicated hub on an NVIDIA Jetson Orin Nano. The short version is `make jetson-setup` + `config import templates/jetson.json` — see **[docs/JETSON.md](./docs/JETSON.md)** for the full guide (prerequisites, LLM serving choices, tuning notes and measured benchmarks).

## 🆘 Troubleshooting

- `make doctor` — verifies `sox` is installed.
- LLM not responding → `make services` (which server answers?). For llama-server, `make llm-service`; for Ollama, confirm the container is up and `OLLAMA_HOST` in `.env`.
- `SQLITE_ERROR: no such column` after a schema change → re-run `npm run db:reset` (the DB is regenerated, never migrated).
- Logs stream to `log/<instance>.log`, one file per env (`DOMIA_LOG_FILE`) — e.g. `log/a.log`, `log/b.log`.

---

See the [README](./README.md) for what Domia does and how it's architected.
