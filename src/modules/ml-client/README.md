## 🔌 ML Client

Client module for the local Python ML inference server (`domia_ml_server`, FastAPI on `DOMIA_ML_PORT`).

Encapsulates the HTTP API surface of the ml-server: TTS synthesis, STT transcription, health probing, and engine introspection. Bound to environment-driven configuration (`DOMIA_ML_HOST`, `DOMIA_ML_PORT`) and exists as a module rather than a util because it is service-specific, not generic.

### Public API

| Function                | Purpose                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `synthesizeTts(params)` | POST `/tts/synthesize` — returns audio bytes + voice used                           |
| `transcribeStt(params)` | POST `/stt/transcribe` — returns transcript                                         |
| `pingMlServer()`        | GET `/health` — boolean readiness probe (used by `setupMlServer` to wait for spawn) |
| `listEngines()`         | GET `/engines` — which engines are loaded vs cold                                   |

### Resilience

- All POST calls go through `fetchWithRetry` from `utils/http-client` with `retries: 1` on transient errors (ECONNREFUSED, ECONNRESET, fetch failed, HTTP 502/503/504).
- `pingMlServer` and `listEngines` use a short timeout (2s) suited for liveness; data-plane calls default to 60s and accept a `timeoutMs` override per request.
- Errors thrown via `domiaError` with codes from `ML_ERRORS` (SERVER_UNAVAILABLE, SYNTHESIS_FAILED, TRANSCRIPTION_FAILED) so callers get structured, actionable failures.

### When to use

Anywhere the Node side needs to invoke a model. Engine handlers (`runKokoro`, `runPiper`, `runVosk`, `runWhisper`) call this module instead of spawning Python subprocesses, which keeps inference cold-start cost paid once at server boot rather than on every request.
