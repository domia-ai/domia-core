# Domia — Architecture & Current State

> What is built, verified, and running today — written for both developers and interested readers.
> Explanatory, not promotional; every claim maps to shipped code in this repo.

## What Domia is

Domia is a local-first voice AI companion. It listens, thinks, and talks back entirely on hardware you own —
speech recognition, the language model, speech synthesis, memory, everything. Each Domia is a distinct
character with its own voice, emotional state, and memory of you and its place. Several Domias form a
peer-to-peer mesh and share compute without giving up who they are. The whole system is one TypeScript/Node
process per node, configured entirely from a SQLite database — no cloud, no accounts, no telemetry.

## The voice pipeline

Wake word → VAD → speech-to-text → LLM → text-to-speech → playback, as an event chain on an in-process bus.
The LLM streams tokens; a sentence splitter hands finished sentences to TTS immediately, so speech starts
while the model is still writing (per-sentence pipelining). Playback, barge-in (interrupting a reply aborts
the turn), follow-up mode, and feedback sounds are part of the same flow.

- **Measured latency:** ~0.6–0.7s from end-of-speech to first audio (TTFA p50) with **all companion layers
  on** (persona, emotion, memory, knowledge base) on the dev machine (Apple M4 Max). On the reference
  always-on hub (Jetson Orin Nano 8GB, GPU-hosted 3B LLM with slot-affinity KV reuse), conversational
  perceived latency lands around ~1.4s with LLM time-to-first-token in the low hundreds of milliseconds —
  validated live on hardware. Absolute numbers vary by machine, the shape does not.
- **Observability:** every turn persists ~20 stage timings (`stt_ms`, `llm_queue_ms`, `llm_ttft_ms`,
  `tts_first_chunk_ms`, `ttfa_ms`, `rss_mb`, …) to `interaction_trace`, emits one greppable `TURN_COMPLETE`
  log line, and `npm run bench:voice` runs a golden corpus end-to-end and prints a labeled, comparable
  scorecard.

Speech inference runs **in-process** via `sherpa-onnx-node` (no Python, no sidecar): KWS wake word, Silero
VAD, five STT engines (Whisper, Moonshine, Zipformer, Parakeet, Parakeet-streaming), two TTS engines (Kokoro
— default; Pocket — faster, reference-voice). The LLM runs on local **Ollama**. Heavy inference goes through
child-process worker pools (warm/lazy/reap/recycle) so one hub can serve several rooms in parallel.

## The mesh: delegation, multi-hub, multi-tenant

- **Discovery + liveness** over local MQTT (heartbeats, instant-offline via LWT); **all voice/token/audio
  streaming** over gRPC.
- **Capability delegation:** a thin node can delegate STT, LLM, and/or TTS to a stronger Domia. The origin
  owns the conversation — its persona, voice, emotion, and memory travel inside the request; the responder is
  stateless and answers _as the origin's character, in its voice_. Emotion deltas and learned facts flow back
  to the origin. Failures persist on the origin.
- **Star topology:** each pipeline stage streams directly from the origin to its chosen responder — no chains.
  Several hubs coexist on one network; capability flags in DB decide who serves what.
- **Multi-tenant:** one process hosts N Domia identities (e.g. one per room), each with its own persona,
  config, and satellites, sharing the node's inference pools. Hosting is DB-driven (`is_hosted` rows), managed
  at runtime via `POST /identities` / `DELETE /identities/:domiaKey` with full lifecycle cleanup
  (retire/restore verified live). There is no env-var list of tenants.

## Satellites

A satellite is a small far-field mic/speaker device in a room; the Domia node does everything else. Three
protocols are implemented behind one adapter contract:

1. **ESPHome** — stock Home Assistant voice hardware (e.g. the Voice PE) connects with **factory firmware,
   no reflash**, over the native ESPHome API. Verified end-to-end on real hardware.
2. **Wyoming** — the Home Assistant satellite protocol; Domia connects out to the satellite.
3. **WebSocket** — Domia's reference protocol for custom satellite builds. Clients may send a
   `{"type": "audio_played", "interactionId": "..."}` control message when the reply's first audio actually
   starts on their speaker. The `interactionId` (echoed from `audio_stream_begin`) is required for the
   stamp: a message whose id is missing, mismatched, or stale is ignored. (`audio_stream_begin` carries an
   `interactionId` only for turn replies — announce/intercom streams have no turn, so there the field is
   absent and `audio_played` has nothing to confirm.) The node stamps it as the turn's
   `audio_audible_at` — the only transport able to prove
   audibility (ESPHome only reports announce-finished, Wyoming has no playback confirmation). Domia's eval
   clients send it on first frame received, which on loopback approximates delivery, not true audibility —
   real devices must send it at actual playback start.

Wake word runs on the device; audio streams to the node; satellites bind **per identity** (a hub hosting five
room-identities routes each satellite to its room's Domia). Discovery + binding + wake words + timers + volume
are managed from the web console. Presence, announcements (`POST /speak`, broadcast), and intercom ride the
same layer.

**Continued conversation (follow-up)** works on stock ESPHome hardware: after a reply, the device re-opens its
microphone and the user speaks again without repeating the wake word — chains of several exchanges validated on
a factory-firmware Voice PE. The node side is a per-connection run controller that owns the ESPHome voice
assistant event ladder end to end: generation counters for runs and playbacks (a late event from a closed run
can never affect the next one), exactly-once run termination, per-phase watchdogs (the firmware has none), a
single playback arbiter per device (replies before announcements, no overlapping audio), and playback-end
detection from the media-player entity state cross-checked against the known reply duration. Capture hygiene is
data-driven: the first instants of each capture window are gated so neither the device's own wake chime nor the
tail of the previous reply reaches the recognizer. All windows and trims are per-satellite database
configuration.

(protocol details), `domia-satellite-architecture.md` (design + as-built).

## The companion

The character layers are prompt text over the same single LLM call — they cost ~nothing on the hot path
(measured: tens of ms), because they ride in a KV-cache-friendly prompt and all _learning_ happens off-path.

- **Persona:** character profile (personality, communication style, role stance, voice style) rendered into
  the prompt; the persona — including the TTS voice — is what travels on delegation.
- **Emotion:** an 8-axis state (Plutchik) with decay toward a personality baseline. It shades prosody
  (speed/pitch/pauses) on every reply and the model can mark intensity inline with emotion tags (stripped
  before speech).
- **Tiered memory:**
  - _Recent turns_ — a rolling in-session window.
  - _Facts_ — durable "what it knows about you" (typed: user facts / preferences / observations, confidence-
    gated), recalled by relevance via embeddings.
  - _Knowledge base_ — **authored** "what it knows about its place" (`knowledge_entry`, edited in the console
    or `POST /knowledge`): a host Domia answers house/venue questions offline, with no tools.
  - _Long-term_ — session episodes (summaries with mood arc) and an evolving model of the person
    (interests, tendencies, familiarity), recalled as "previously…" context across sessions.
- **The two-brain pattern:** all learning (emotion deltas, fact extraction, session summaries) happens in a
  background "reflection" pass that yields to live voice — and runs on its **own small model** (default
  `llama3.2:1b`). This matters: if reflection shared the voice model, it would evict the voice prompt's KV
  cache between turns (measured: ~6× worse TTFT). Separate model, separate cache — the companion layers stay
  effectively free.
- **Retention:** traces, emotion events, facts, and episodes all have age + per-identity caps swept in the
  background; recordings are swept from disk.

## Skills (acting in the world)

- **Agnostic floor:** Domia speaks MCP. Point it at any MCP server via config — zero code per skill. Tools,
  policies, and finalize templates are all provider config.
- **Routing that small models can survive:** a hybrid, fully in-process **matcher** ranks tools per utterance
  — BM25 lexical (MiniSearch) + semantic embeddings (bge-small via Transformers.js, running on the
  onnxruntime already shipped) fused with reciprocal-rank fusion, with a cascade that skips the neural gate
  when lexical is confident. Verified cross-domain (home-control and hospitality corpora) with zero
  per-domain code. **Fail-closed:** if nothing matches confidently, the turn is normal conversation — no tool
  hallucination, no extra LLM hop.
- **Agent loop:** single-shot reply-or-tools on the same conversational LLM, required-argument validation with
  one bounded re-prompt, parallel tool execution, respond-first async tools ("on it" now, result spoken when
  ready), abort-aware.
- **Specializations:** a registry for premium skills where Domia ships custom code, activated purely by
  provider config. Home Assistant is #1 (entity aliases, core-tool pinning, zero-LLM confirmation templates).
- **Embeddings are shared infrastructure:** the same in-process embedding primitive serves tool routing,
  fact recall, and knowledge-base recall (backends: Transformers.js in-process default, Ollama alternate).

## Configuration model

- **Born minimal:** a node boots neutral — an envelope of `{DATABASE_URL, ports, DOMIA_KEY}` with every
  capability off. Its role comes entirely from DB config, applied via a **template**: `defaults`,
  `standalone`, `full-hub`, `thin-client`, `snappy`, `balanced`, `rich`, `jetson` (all in `templates/`), via
  CLI or console.
- **Everything is a DB knob:** engines, models, thread counts, thresholds, pool sizes, routing modes, memory
  windows — schema defaults, no hardcoded config in adapters. Engine families are registries (STT, TTS, VAD,
  KWS, matcher, embeddings) — adding an engine is a folder + a registry entry.
- **Live config apply:** web-console config changes diff → classify → reload only the affected subsystem
  (live / drain / pool-reload / identity / restart-fallback) under a per-identity mutex. Full restarts are the
  fallback, not the norm.
- **Dev setup:** two neutral nodes, A (`.env`, `data/db/a.db`) and B (`.env.b`, `data/db/b.db`), to exercise
  cross-node features. The names carry no role meaning.

## Operability

HTTP control API (`/voice`, `/chat`, `/speak`, `/mind`, `/knowledge`, `/identities`, `/satellites`,
`/templates`, `/config`, `/config/health`, `/models`, `/admin/restart`), a dev CLI, and the separate web
console (**domia-app**) for fleet observability + remote config across every node (read-only demo at
console.domia.ai). Testing without a microphone: POST a WAV to `/voice`; the whole pipeline past the mic is
production code.

## Honest not-done list

- **No authentication** on the HTTP API (LAN/dev posture; deferred deliberately — required before any remote
  exposure).
- **Only two language catalogs seeded so far.** Multilingual speech itself ships (English default + Spanish,
  end to end: multilingual STT, a Spanish TTS voice, multilingual intent embeddings, language catalogs for
  every spoken fixed string, per-identity language config — each room can speak its own language), and adding
  a language is a catalog entry + a config template — but only EN/ES exist today and the wake word stays
  English for now.
- **No CI pipeline** — verification is deterministic local suites (turn logic, protocol replay, controller
  invariants, parsing, adversarial inputs, per-class STT noise gates) plus end-to-end benches and corpus
  scorecards, run by convention rather than automation.
- **Satellite configuration does not yet survive re-registration** — if a satellite re-appears under a new IP,
  its row can be re-created with defaults and per-device flags need re-applying.
- **Pool-job cancellation** (aborting an in-flight TTS pool job) pending; barge-in already stops new work.
- Reply _quality_ on small models is its own upcoming chapter (model gauntlet + persona work); this document
  covers the mechanics, which are stable.
