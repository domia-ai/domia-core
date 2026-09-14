# Domia — The Local AI That Lives With You

**Domia** is a local-first, privacy-respecting AI companion. It listens, thinks, and talks back — **100% on your own hardware**, no cloud. Each Domia is a unique character with its own personality, voice, emotions, and memory, and several Domias can work together across your spaces as one mesh.

Unlike a traditional assistant, Domia is not a single service in someone else's datacenter — it's a presence that runs where you are, keeps its own identity, and can borrow compute from a more powerful Domia nearby without ever giving up _who it is to you_.

**Three things make Domia different:**

- 🎭 **Personality** — every Domia is a character with its own voice, an 8-dimension emotional state, and memory. A presence with continuity, not a stateless command box.
- 🕸️ **Delegation** — drop a Domia in any space; they form a peer-to-peer mesh and **share compute**. A thin device leans on a stronger one, and its persona travels with the request — so a hub answers _as your Domia_, in its voice.
- 🧩 **Skills** — extensible via the Model Context Protocol: Domia decides when a turn needs a tool, calls it mid-conversation, and folds the result into its spoken reply. Point it at any MCP server to act in the world — still 100% local.

**▶ See it live — [console.domia.ai](https://console.domia.ai)** — a read-only console of real captured conversations across five personas (voices, emotion, memory, per-stage latency, and the mesh delegation between spaces).

> 🛠️ Living document — early but real. The sections below describe **what actually works today**, with pointers into the code, plus where we're headed.

**Ecosystem:** [domia.ai](https://domia.ai) (site) · this repo `domia-core` (the voice AI) · [domia-app](https://github.com/domia-ai/domia-app) (the Console — [live demo](https://console.domia.ai)) · [@domia_ai](https://x.com/domia_ai) · [Discord](https://discord.gg/Sx4ACEMSyv)

---

## ✅ What works today

Every capability below is implemented and runs end-to-end on your own hardware — speech inference in-process via `sherpa-onnx-node`, the LLM on a local OpenAI-compatible server (llama.cpp `llama-server`, the template default) or Ollama, no cloud.

- **Full voice-to-voice (S2S) pipeline** — wake word + VAD → speech-to-text → local LLM → text-to-speech → playback, with **per-sentence LLM→TTS pipelining** so it starts speaking before the full answer is generated.
  `src/modules/{audio-capture,vad,stt-engine,llm-engine,tts-engine,audio-playback}` · `src/modules/core-bus`
- **Multi-device P2P mesh** — Domias discover each other over MQTT and stream audio/text/tokens to each other over **gRPC streaming**.
  `src/modules/{grpc-client,network-sync,heartbeat-manager}` · `src/setups/grpc-server`
- **Capability delegation** — a thin device can delegate STT/LLM/TTS to a stronger Domia. The origin orchestrates; the responder just lends compute.
  `src/modules/capability-resolver`
- **Off-the-shelf voice satellites** — stock **Home Assistant voice hardware** (ESPHome devices like the Voice PE, factory firmware) and **Wyoming** satellites connect straight to a Domia, plus a reference WebSocket protocol. Wake word on the device, everything else on your Domia.
  `src/modules/{satellite-core,satellite-protocols,satellite-discovery}`
- **Multi-tenant** — one process can host several Domia identities at once (one per room), each with its own persona, config, and satellites, sharing the node's inference.
  `src/setups/hosted-identities`
- **Multi-space parallel hub** — one hub can serve several spaces **at the same time** via child-process inference pools (warm/lazy/reap/recycle workers, RAM-aware).
  `src/modules/inference-pool`
- **Identity owned by the origin** — your Domia's **persona, voice, emotion, and memory travel with the request**, so when a hub answers for it, it answers in _your_ Domia's character and voice, not the hub's.
  `src/modules/{prompt-context-builder,emotion-engine,memory,reflection}`
- **Emotion + reflection** — an 8-dimension emotional state with decay, updated by one off-the-hot-path LLM "reflection" pass that also extracts facts to remember.
  `src/modules/{emotion-engine,reflection}`
- **Tiered memory** — recent-conversation memory, durable fact memory ("what it knows about you"), an authored **knowledge base** ("what it knows about its place" — a host Domia answers house questions offline, no tools), and long-term memory: session episodes plus a growing model of who it talks to.
  `src/modules/memory` · `src/modules/session-manager`
- **Skills / tool-calling via MCP** (opt-in) — Domia speaks the Model Context Protocol: it decides when a turn needs a tool, picks it, calls it mid-conversation, and folds the result into its spoken reply. A **hybrid router** (lexical + semantic embeddings, fully in-process) picks the right tools for small local models and fails closed to conversation — add any MCP server via config, zero extra code; Home Assistant gets a built-in specialization.
  **Trust tiers** decide which of a server's tool annotations Domia believes: below `trusted` only the risk-increasing ones count, so an unannotated tool asks before it acts, and anything marked `openWorldHint` asks first even when its risk class was relaxed. A per-provider descriptor override relaxes a single tool without trusting the whole server; `GET /skills` reports every tool's `riskClass`, `policy` and `policySource`. See `docs/DEPLOY.md` § 4b.
  **Transports:** Streamable HTTP and stdio run on the MCP SDK **v2** client (`@modelcontextprotocol/client`); the deprecated **SSE** transport keeps a separate, isolated v1 adapter purely for Home Assistant's legacy `/mcp_server/sse`. The two never share an SDK object. Move providers to Streamable HTTP (`/api/mcp`) — the v1 adapter is removed once no `sse` provider is left. See `docs/DEPLOY.md` § 4b-bis.
  **Protocol era:** MCP revision `2026-07-28` is adopted **per provider** via `config.protocolMode` — `legacy` (the default, unchanged 2025 wire), `auto` (probe and fall back) or `2026-07-28` (modern only). On the modern era tool-list changes ride a `subscriptions/listen` stream, `tools/list` cache hints can only shorten the catalog's refresh window, and a tool may ask for input mid-call (MRTR) through the same elicitation presenter — that is a transient in-call question, never a durable Domia confirmation.
  `src/modules/{skill-engine,agent,matcher,embeddings,intent-router}` · `src/modules/llm-engine` (tool-calling)
- **Everything is DB-driven + remotely reconfigurable** — engines, models, voices, thread counts, concurrency are all config in SQLite (Drizzle); a Domia boots minimal and gets its role by importing a config bundle (`POST /config`), which persists and restarts it to reload cleanly.
  `src/db` · `src/modules/config-engine` · HTTP `POST /config`
- **Operability** — HTTP control API (`/voice`, `/chat`, `/speak`, `/mind`, `/knowledge`, `/identities`, `/satellites`, `/templates`, `/config`, `/config/health`, `/admin/restart`), a developer CLI to exercise STT/TTS/LLM/mind in isolation, per-turn stage metrics persisted for every interaction, and a repeatable voice benchmark (`npm run evals -- bench-voice`). A separate **web console** — [domia-app](https://github.com/domia-ai/domia-app) — drives this API across every Domia (fleet observability + remote config); [live read-only demo](https://console.domia.ai).
  `src/setups/http-server` · `src/cli/dev`
- **Voice UX** — wake word, barge-in (interrupt a reply), follow-up conversation mode (keep talking without re-waking), model warm-up on boot, and non-verbal feedback sounds — all DB-configurable.
- **Adapts to your hardware** — the same code runs on a thin edge device or a powerful hub; model size, engine, and thread counts are just DB config, never hardcoded. Better hardware, better experience.

**Already shipped, still maturing:** multilingual speech (English + Spanish, end to end) and GPU-accelerated inference on dedicated hub hardware (validated on Jetson Orin). The mesh/HTTP API is guarded today by a shared **mesh secret** (`Authorization: Bearer <DOMIA_MESH_SECRET>`, loopback exempt).

**On the roadmap (not built yet):** per-user API authentication and accounts, fine-tuned lightweight models, and a marketplace for voices/characters.

---

## 🧠 How it works

### The voice pipeline

```mermaid
flowchart LR
  A[🎙️ Wake word + VAD] --> B[STT]
  B --> C[LLM]
  C -- per sentence --> D[TTS]
  D --> E[🔊 Playback]
```

The LLM streams tokens; a sentence-splitter feeds finished sentences to TTS immediately, so audio starts playing while the model is still talking.

### Any Domia, role decided by config

There is no hardcoded "server" or "client". **Every instance is just a Domia.** What it does — run STT locally? delegate TTS? act as a hub for other spaces? — is decided entirely by its database config (capabilities, engines, delegations), applied from a portable template. In development we run two neutral instances (node A and node B) to exercise cross-Domia features; neither has a baked-in role.

### Identity travels with the request

When Domia **A** (your kitchen) borrows compute from Domia **B** (a hub):

```
A (origin) ──gRPC──► B (responder, lends compute)
   └─ sends its persona + voice + emotion + memory in the request
B answers in A's character and A's voice, then reports new emotion/facts back to A
```

The hub never "owns" the conversation — it lends CPU, while the **identity stays with the origin**. That's why several spaces can share one hub and each still sounds and feels like itself.

For the full architecture and current state, see [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 🚀 Quick start

**Prerequisites:** Node.js ≥ 24, Docker (for Ollama + MQTT), and `sox` (audio playback).

```bash
# 1. install deps
npm install

# 2. start Mosquitto (MQTT) and an LLM server
docker compose up -d mosquitto
make llm-service        # llama.cpp llama-server as a service (systemd on Linux, launchd on macOS): builds it,
                        # stages the templates' default model (llama3.2:3b) and serves it on :11435
# Alternative: Ollama (simplest model management, lenient tool-call parsing — the templates point at
# llama-server; switch llm.engine to OLLAMA in the console if you prefer it):
#   docker compose up -d ollama && docker exec -it domia-ollama ollama pull llama3.2:3b

# 3. download the on-device speech models (STT / TTS / VAD / wake word)
npm run setup:models

# 4. create this node's env file (gitignored; only .env.example is tracked), then the database
cp .env.example .env     # edit DOMIA_KEY, ports, DATABASE_URL, DOMIA_MESH_SECRET
npm run db:reset         # from the schema, no migrations — drizzle-kit push

# 5. run your Domia (boots minimal — every capability off, no models needed yet)
npm run dev

# 6. give it a role from a portable config template (CLI or web console)
npm run dev-cli -- config import templates/full-hub.json
```

You should see `DOMIA is running and waiting for events...`. Drive it without a microphone by POSTing a WAV to `http://localhost:3100/voice`, or use the dev CLI:

```bash
npm run dev-cli -- tts -t "hello, this is my own voice"
```

**Born minimal, configured externally.** A Domia has no baked-in role — it boots minimal and you apply a config template (`full-hub`, `standalone`, `thin-client`, `snappy`, `jetson`, or your own) via the CLI or the web console; the change persists and the Domia restarts to apply it.

**Many Domias (delegation / multi-space):** one **env file** per instance (device identity), launched with `DOMIA_ENV=<file> npm run dev` — no per-instance scripts. Create a second identity with `cp .env.example .env.b` (edit its `DOMIA_KEY`, ports and `DATABASE_URL`), then `npm run db:reset:b` and `npm run dev:b` (both wired to `.env.b`). Give one `full-hub` and another `thin-client`, and they discover each other over the mesh and delegate STT/LLM/TTS.

**Verify:** `npm test` runs the pure eval battery (no node needed); `npm run evals -- --list` shows every suite and battery (`pure`, `node`, `tool`, `quality`, `hardware`, plus `utility` suites by name); `npm run evals -- <suite>` runs one against the node at `EVAL_URL`; `npm run dev-cli -- doctor` checks binaries and which runtime services answer; `bash scripts/download-models.sh <name>` downloads a model set.

Suites marked `[needs …]` in `--list` require a capability on the live node (an enabled module flag, a real Home Assistant provider, multilingual embeddings). When one is missing the runner **fails loudly** — it prints the reason and a recovery command and exits non-zero — so a gate can never turn into a silent pass. Set `EVAL_ALLOW_SKIP=1` to go back to skipping unmet suites (useful in CI on a node that deliberately has no Home Assistant).

**Home-Assistant scenarios on your own house:** the ordered tool battery lives in `evals/cases/tool-scenarios.json` and never names a device. Utterances and reply expectations carry `{{entity.<alias>.<field>}}` placeholders (`name`, `spoken`, `spokenSingular`, `area`, `token`, `entityId`, `nameEs`) resolved against a site map in `evals/fixtures/sites/<site>.json`, picked with `EVAL_HA_SITE` — `mock` (the in-process mock HA, mirrors the lab names), `lab`, `casa`. A turn whose placeholder the site cannot resolve (a Spanish `nameEs`, say) is skipped and reported, so the same chain runs anywhere. Run it without hardware via `npm run evals -- tool-scenarios-mock`; run it against a real house with `EVAL_HA_SITE=casa EVAL_LIVE=1 npm run evals -- tool-scenarios` (the site is what selects the house; `EVAL_LIVE=1` is the convention for live runs) — **this actuates real devices**: it turns the two lights on, dims them, and turns them back off, ending on a cleanup turn that leaves everything it touched off. To point it at your own home, copy a site file, put your entity names and areas in it, and pass its name in `EVAL_HA_SITE`.

See **[GETTING_STARTED.md](./GETTING_STARTED.md)** for the full walkthrough and per-component testing, and **[docs/DEPLOY.md](./docs/DEPLOY.md)** to take a node to production (packaging, services, TLS, secret rotation, MQTT ACLs, tracing).

---

## 🗺️ Architecture at a glance

`sherpa-onnx-node` (STT/TTS/VAD/wake, in-process) · **llama.cpp `llama-server`** (OpenAI-compatible LLM, default) or **Ollama** · **SQLite + Drizzle** (all config & state) · **gRPC streaming** (Domia↔Domia) · **MQTT** (discovery + heartbeat) · **TypeScript / Node 24**.

`src/modules/` grouped by role:

- **Voice pipeline** — `audio-capture`, `vad`, `stt-engine`, `tts-engine`, `audio-playback`
- **Cognition** — `llm-engine`, `prompt-context-builder`, `reflection`
- **Identity** — `emotion-engine`, `memory`, `mind`
- **Action** — `skill-engine`, `agent`, `matcher`, `embeddings`, `intent-router`
- **Satellites** — `satellite-core`, `satellite-protocols` (ESPHome / Wyoming / LiveKit / OpenAI-Realtime / WebSocket), `satellite-discovery`
- **Distribution** — `grpc-client`, `capability-resolver`, `network-sync`, `heartbeat-manager`, `mqtt-event-handler`
- **Performance & ops** — `inference-pool`, `voice-admission`, `config-engine`, `session-manager`

### HTTP control API

Every non-loopback request carries `Authorization: Bearer <DOMIA_MESH_SECRET>` (loopback is exempt). Routes come from `src/setups/http-server/http-server.ts`:

| Area                    | Routes                                                                                                                                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn / voice            | `POST /voice`, `POST /chat`, `POST /chat/stream`, `POST /speak`, `POST /turn/cancel`, `POST /announce-audio`, `POST /intercom`, `GET /presence`, `WS /satellite`                                                |
| Config                  | `GET`/`POST /config`, `GET /config/schema`, `GET /config/health`, `POST /config/refresh`, `GET`/`POST /node/config`                                                                                             |
| Mind / knowledge        | `GET /mind`, `GET`/`POST /knowledge`                                                                                                                                                                            |
| Identities              | `GET`/`POST /identities`, `DELETE /identity-data`, `POST /admin/reset-conversation`                                                                                                                             |
| Satellites              | `GET /satellites`, `GET /satellites/discover`, `POST /satellites`, `PUT /satellites/:id/{wake-words,numbers,follow-up,volume,timers}`, `POST /satellites/:id/test-speaker`, `GET /satellites/:id/livekit-token` |
| Models / skills / bench | `GET /models`, `POST /models/install`, `GET /skills`, `GET /skills/discover`, `POST /bench/run`, `GET /templates`                                                                                               |
| Proactivity             | `GET /proactivity/status`, `GET`/`POST /proactivity/schedule`                                                                                                                                                   |
| Sync / ops              | `GET /sync`, `GET /health`, `GET /`, `GET /stats/latency`, `POST /mesh/rotate`, `POST /admin/restart`                                                                                                           |

---

## 📦 Roadmap

- **Now → next:** live soak of the companion layers, real-world Home Assistant deployment, broader GPU hub validation (Jetson-class already live), test suite + CI.
- **Then:** per-user API authentication and accounts, vector long-term memory at scale, fine-tuned lightweight models, more language catalogs beyond EN/ES.

---

## 🔓 License

**Apache License 2.0** — fully open source. Read it, run it, fork it, build on it, ship it commercially. Domia runs entirely on your own hardware; the code that does it is yours too.

---

## 🤝 Contributing

Developer, designer, or voice artist — you're welcome. Start with [GETTING_STARTED.md](./GETTING_STARTED.md), and note the project's [emotional commit style](./COMMITS.md).
