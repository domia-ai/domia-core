# 🚀 Getting Started with Domia Core

This guide takes you from a clean machine to a running Domia. All speech inference runs **in-process** via `sherpa-onnx-node` and the LLM runs locally via **Ollama**.

## 📋 Prerequisites

- **Node.js ≥ 24** (nvm recommended)
- **Docker** — runs Ollama (LLM) and Mosquitto (MQTT) — [install](https://www.docker.com/products/docker-desktop/)
- **sox** — audio playback (installed for you by `make install-deps`)

## 🛠️ Installation

```bash
# 1. Node dependencies
npm install

# 2. System binaries (sox), then verify
make install-deps
make doctor

# 3. Start Ollama + Mosquitto (Docker), then pull an LLM
make dev                 # brings up Ollama + Mosquitto
make install-llama       # pulls llama3.1:8b into the Ollama container

# 4. Download the on-device speech models (STT / TTS / VAD / wake word)
npm run setup:models     # or: make setup-models

# 5. MQTT password (user: domia / pass: domia)
make mosquitto-password

# 6. Create the database from schema (no migrations — the DB is regenerated)
npm run db:reset:smart

# 7. Run your Domia
npm run dev:smart
```

When you see `DOMIA is running and waiting for events...`, it's live on `http://localhost:3000`.

## 🧪 Testing individual components (no microphone needed)

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
curl -X POST http://localhost:3000/voice \
  -H 'content-type: application/json' \
  -d '{"filePath":"'"$PWD"'/tmp/your-audio.wav"}'
```

## 🔀 Run a second Domia (delegation / multi-room)

A second instance is preconfigured in `.env.dump`. In another terminal:

```bash
npm run db:reset:dump
npm run dev:dump          # runs on http://localhost:3001
```

Now the two Domias discover each other over MQTT and can delegate STT/LLM/TTS to one another — the basis for the multi-room hub. (`smart`/`dump` are dev-only labels; in production every instance is just a Domia whose role is decided by its DB config.)

## 🧩 Swapping engines & models

Everything is DB config — switch without touching code:

- **STT:** download alternatives with `npm run setup:models:whisper` / `:zipformer` / `:moonshine`, then set `stt_config.engine` + model path.
- **TTS:** Kokoro is the default (`npm run setup:models:kokoro`); pick a voice via `tts_config.voice_name` (e.g. `am_adam`, `bf_emma`).
- **LLM:** any Ollama model — `docker exec -it domia-ollama ollama pull <model>`, then set `llm_model_config.model_name`.

After a config change, apply it live with `curl -X POST http://localhost:3000/config/refresh` (no restart needed).

## 🆘 Troubleshooting

- `make doctor` — verifies `sox` is installed.
- Ollama not responding → `make dev` (is the container up?) and confirm `OLLAMA_HOST` in `.env`.
- `SQLITE_ERROR: no such column` after a schema change → re-run `npm run db:reset:smart` (the DB is regenerated, never migrated).
- Logs stream to `log/smart.log` / `log/dump.log`.

---

See the [README](./README.md) for what Domia does and how it's architected.
