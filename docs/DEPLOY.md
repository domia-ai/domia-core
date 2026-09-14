# Deploying a Domia node

This is the operations guide for running `domia-core` on a real device: packaging, services, TLS, secrets, MQTT ACLs, tracing and what to expect from updates. Every knob here is **off by default** — a node with none of it configured boots exactly as in `GETTING_STARTED.md`. Roles still come from templates applied through the console; nothing below changes what a node _is_, only how it is protected and observed.

## 1. Package and install

```bash
make package                       # → dist/domia-core-<version>+<commit>.tar.gz (+ .sha256)
```

The tarball contains `build/` (compiled JS), `templates/`, `scripts/`, `proto/`, the DB schema (`src/db/schema/` + constants, needed by `db:reset`), `package.json`/`package-lock.json`, `.env.example`, the Mosquitto config (`mosquitto.conf` + `conf.d/`) + ACL template, this document and `MANIFEST.json` (version — with a `-dirty` suffix when built from an uncommitted tree — commit, build host, sha256 of every packaged file except `MANIFEST.json` itself, the entry point and the start command `node --env-file=.env build/index.js`). Native modules (sherpa-onnx, better-sqlite3) are **not** inside — `npm ci` on the target fetches the right binaries for its OS/arch. The `Dockerfile` is **not** packaged: it builds from a source checkout (`COPY . . && npm run build`), which the compiled tarball does not carry.

On the device:

```bash
tar xzf domia-core-*.tar.gz && cd domia-core-*
npm ci                                  # full install: db:reset needs drizzle-kit
cp .env.example .env && $EDITOR .env    # DATABASE_URL, DOMIA_KEY, ports, DOMIA_MESH_SECRET
npm run db:reset                        # creates the SQLite file from the schema (no migrations)
npm run setup:models                    # only the engines the node's template will use
npm start                               # or install it as a service (next section)
```

Then apply a template from the console (or `npm run dev-cli -- config import templates/<role>.json`).

## 2. Run as a service

- **Linux (systemd)** — `make install-services` installs the whole hub as enabled units in one go: `llama-server` (LLM) and `domia` (the node, ordered after `llama-server`) as system units (sudo), and `nemo-speech` (STT) as a **user** unit under `~/.config/systemd/user/` with `loginctl enable-linger` — no sudo, and it starts at boot without anyone logging in. All `Restart=always`. The system manager cannot order a system unit after a user unit, so `domia` may come up before `nemo-speech` is listening at boot. On an 8 GB box the launcher's `LLM_CACHE_RAM_MB=256` default caps llama-server's host prompt cache; `0` disables it and costs a full re-prefill on every lane switch, `-1` uncaps it and swaps the box. The three targets also exist individually (`make llm-service`, `make nemo-service`, `make domia-service`), but install all the servers your DB config points at: a node whose `stt.engine=NEMO_SPEECH` and no `nemo-speech` unit answers every turn with `INTERACTION_FAILED step: 'stt'` after the first reboot (the satellite shows a red ring). Logs: `journalctl -fu domia|llama-server|nemo-speech`. Verify boot survival any time with `make services` — it lists which units are enabled.
- **MQTT broker (docker)** — `make mosquitto` starts `eclipse-mosquitto` with `restart: unless-stopped` and fixes the config permissions it needs: the container runs as UID 1883, so `config/mqtt/password.txt` and `mosquitto.conf` must be world-readable (`644`). A `600` password file makes the broker crash-loop (`Unable to open pwfile`, exit 13) while `mosquitto --test-config` still reports OK — if you copy the config by hand, run `chmod 644 config/mqtt/password.txt`.
- **Not used = disabled** — if llama-server is the LLM, disable a natively installed Ollama (`sudo systemctl disable --now ollama`); on small boards its resident memory competes with the inference servers.
- **macOS (launchd)** — `make llm-service` installs the `ai.domia.llm-server` user agent for llama-server. The node itself runs with `make run`; wrap it in a launchd agent the same way if you need it to survive reboots (the plist pattern is in `config/launchd/ai.domia.llm-server.plist.tpl`).
- **Docker** — from a **source checkout** (not the compiled tarball), `docker compose up -d core` builds and runs the node from the `Dockerfile`; audio devices and mDNS discovery need host networking and device pass-through, which is why bare-metal is the recommended install for hubs and rooms.

`make doctor` checks the binaries **and** prints the posture (TLS, secret, ACLs, OTel) for the env file in `DOMIA_ENV`; `make posture` prints only the posture.

## 3. TLS (HTTPS + gRPC)

Off by default: the mesh speaks plaintext HTTP and gRPC on the LAN. Turn it on per node with three files in the env:

```
DOMIA_TLS_CERT_FILE=data/certs/<node>.crt
DOMIA_TLS_KEY_FILE=data/certs/<node>.key
DOMIA_TLS_CA_FILE=data/certs/ca.crt
# DOMIA_TLS_REQUIRE_CLIENT_CERT=1   → mutual TLS: peers must present a cert signed by that CA
```

- Both `CERT` and `KEY` switch the Fastify server to **HTTPS** (REST, `/satellite` and `/v1/realtime` WebSockets) and the gRPC server to **TLS** in the same process. `CA` is what the node trusts when it dials peers (and the CA that client certs are checked against when `REQUIRE_CLIENT_CERT=1`); without it the system trust store is used.
- **Peers pick the scheme automatically.** Each heartbeat now carries `grpcTls` and `httpScheme`; the registry stores `grpc_tls` per peer and the gRPC client opens `grpcs` channels to TLS peers and plaintext channels to the rest, so a mesh can be migrated node by node. The node's own audio URLs (`/audio/<id>`, fetched by delegated TTS/playback peers) follow its scheme too.
- Certificates must list the address peers dial in the SAN (`IP:<lan ip>` or `DNS:<host>`). `make dev-certs` (`scripts/gen-dev-certs.sh`) creates a self-signed CA + a node cert with `localhost`, `127.0.0.1`, the hostname and every non-link-local IPv4 of the machine; add more with `CERT_SANS="IP:10.0.0.5 DNS:hub.lan"`. Re-run it if the LAN IP changes, or give the node a DHCP reservation. Copy `ca.crt` to every peer; keep `.key` files mode 600 (the script does).
- Clients that call an HTTPS node (evals, `curl`, the console collector) need the CA: `export NODE_EXTRA_CA_CERTS=/path/to/ca.crt` for Node processes, `curl --cacert ca.crt`. The node's own loopback restart call (`/admin/restart` after a config apply in production) also goes through Node's trust store, so set `NODE_EXTRA_CA_CERTS` in the service environment when TLS is on.
- Production: swap the dev CA for your own PKI (any cert/key/CA in PEM works; the three env vars are the only contract). A missing or unreadable file fails the boot with `CORE/TLS_MATERIAL_UNREADABLE` rather than silently falling back to plaintext.
- **URL playback on satellites is the one thing TLS can break.** Satellites that play a URL instead of a stream (ESPHome / Voice PE media players, and any other `playAudioUrl` transport) fetch `/audio/<id>` with their own firmware HTTP client, which has no way to trust a private CA. When TLS is on, the node emits `https://…/audio/<id>` — the node listens on **one** port and it is HTTPS, so there is no plaintext audio origin to fall back to — and those satellites fail playback (the turn still completes; only the audio does not land). The node logs this once per process: `⚠️ TLS is on: /audio URLs are https …`. The workarounds are (a) leave TLS off on nodes that serve URL-playback satellites and protect that segment another way, (b) use a stream-capable transport (native WS, Wyoming) for those rooms, or (c) front the node with a reverse proxy holding a publicly trusted cert and point the node's `publicAudioBaseUrl` at it. `publicAudioBaseUrl` is node-level configuration (`host_node`, see §4c), set with `POST /node/config` (`{"version":1,"node":{"publicAudioBaseUrl":"https://proxy.lan"}}`); when it is set, every `/audio/<id>` link is built from that base instead of the node's own scheme, host and port.

Not covered here: MQTT transport encryption. `mqtt_config.protocol` accepts `mqtts`; add a `listener 8883` with `certfile`/`keyfile` to `config/mqtt/mosquitto.conf` if the broker leaves the trusted LAN.

## 4. Secrets and rotation

`DOMIA_MESH_SECRET` is the shared mesh credential: bearer token on REST/gRPC between nodes and the HMAC key that signs heartbeats (`heartbeatSignatureRequired`, DB, default on). Set a long random value (32+ chars) on every node before the first boot on a shared network; `make posture` warns about the example default.

Rotating it without downtime:

1. Add `DOMIA_MESH_SECRET_NEXT=<new secret>` to every node's env and restart them one at a time. A node with `NEXT` set **signs and sends with the new secret** and **accepts both** for the grace window — `domia.meshSecretGraceMs` (DB column, default 24h, live-reloadable through the console like every other `domia` field).
2. Check the posture on any node: `POST /mesh/rotate` (mesh bearer or loopback) returns `{ rotating, signingWith, accepted, graceMs, graceEndsAt, fingerprints }`. Fingerprints are 12-char SHA-256 prefixes, never the secrets.
   - `{"action":"restart-grace"}` restarts the window (e.g. the last node was restarted later than expected).
   - `{"action":"end-grace"}` stops accepting the old secret immediately.
3. Once every node runs with `NEXT`, move the new value into `DOMIA_MESH_SECRET`, drop `NEXT`, restart again. Between step 1 and 3 a stray node still on the old secret keeps working until the window closes, then its heartbeats are dropped (`heartbeatSignatureRequired`) and its calls get `401`/`UNAUTHENTICATED`.

`DOMIA_KEY` (the node's principal identity) and provider tokens (skill providers, LiveKit) are DB/config material and rotate through the console; `evals/node-snapshot.ts` (see `docs/JETSON.md`) is the export/import path when a node is rebuilt; at restore time each provider's token comes from `DOMIA_PROVIDER_TOKEN_<NAME>` (provider name upper-cased, non-alphanumerics → `_`), with `DOMIA_PROVIDER_TOKEN` as the fallback for providers without their own variable.

### What the bearer does _not_ cover

Every HTTP route requires the mesh bearer unless the caller is on loopback. The deliberate exceptions:

| Route                                                              | Open to           | Why                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` and `GET /health`                                          | anyone on the LAN | liveness for `make services`, load balancers and the console's reachability probe; neither returns identity or config data                                                                                                                    |
| `GET /audio/<id>` with `kind=tts` (the default) or `kind=announce` | anyone on the LAN | satellites that play a URL (ESPHome / Voice PE media players) fetch this with firmware HTTP clients that cannot carry a bearer. The payload is the node's own spoken reply, and the `<id>` is an unguessable UUID with a 5-minute serving TTL |

`GET /audio/<id>?kind=input` is **not** exempt: that is the user's own recording, so it needs the bearer (or loopback) like every other route. An unrecognised `kind` is not exempt either. `npm run evals -- http-surface` asserts this predicate directly, so the exemption list cannot widen unnoticed.

On a segment you do not trust, put the node behind TLS _and_ a firewall rule — the open audio kinds are a LAN-trust assumption, not an authorization decision.

## 4b. Skill provider trust tiers

Every skill provider (MCP server) carries a `trust_tier`: `untrusted` (default), `standard` or `trusted`. The tier decides **which of the server's own tool annotations Domia believes**, and the annotations decide whether a tool runs straight away or asks the user first.

| Tier                     | Annotations honored                                                                              | Practical effect                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `untrusted` / `standard` | only the risk-**increasing** ones (`destructiveHint: true`, `openWorldHint: true`)               | a server cannot declare itself safe: an unannotated or `readOnlyHint: true` tool is still classed `write_destructive` and **asks first** |
| `trusted`                | all of them, including the risk-decreasing ones (`readOnlyHint: true`, `destructiveHint: false`) | reads run silently, additive writes run silently, destructive tools still ask                                                            |

Two rules apply at every tier:

- **`openWorldHint: true` asks first.** Below `trusted`, any non-read tool a server marks open-world (it reaches beyond a closed, known set of entities — the public web, a mailbox, another user's data) is `confirm`, even when a descriptor override relaxed its risk class to `write_additive`. At `trusted` it runs silently.
- **A descriptor override wins.** Per provider, the `descriptor` JSON can set `execution.toolHints.<tool>` (change what a hint says) and `execution.toolPolicy.<tool>` (`allow` / `confirm` / `deny`) without raising the whole server's tier. That is the intended way to relax a single tool of an otherwise untrusted server.

`GET /skills?domiaKey=<key>` reports, per tool, `{ riskClass, policy, policySource }` — `policySource: "descriptor"` means an override decided it, `"risk_default"` means the tier + annotations did. The console shows `confirm` tools as "asks first".

Raising a provider to `trusted` is a deliberate act: it is a statement that you trust that server's own annotations. Do it in the console (provider row → trust tier) or directly:

```sql
UPDATE skill_provider SET trust_tier = 'trusted' WHERE name = '<provider>';
```

then reload skills: `POST /config?domiaKey=<key>` with `{"modules":{"skillsEngine":false}}`, then the same call with `{"modules":{"skillsEngine":true}}` (or restart the node). Only `modules.skillsEngine`, `skillProviders` and `character.language` changes reach the skills reloader — any other `modules` change and `POST /config/refresh` leave the connected providers untouched.

## 4b-bis. MCP transports and the SSE sunset

A skill provider's `type` column picks the transport, and the transport picks the client adapter. Domia ships two, deliberately isolated — they never share an SDK object, because MCP SDK v1 and v2 are separate packages whose `instanceof` checks and nominal types do not cross:

| Provider `type`          | Adapter                            | SDK                                                            |
| ------------------------ | ---------------------------------- | -------------------------------------------------------------- |
| `http` (Streamable HTTP) | `skill-engine/adapters/mcp-v2`     | `@modelcontextprotocol/client` v2 (+ `core`, `server`, `node`) |
| `stdio`                  | `skill-engine/adapters/mcp-v2`     | same v2 client, `@modelcontextprotocol/client/stdio`           |
| `sse` (legacy)           | `skill-engine/adapters/mcp-v1-sse` | `@modelcontextprotocol/sdk` v1 (pinned `^1.30`)                |

`resolveSkillAdapter(protocol, type)` does the selection; a provider whose `type` no adapter claims fails config health with `Unsupported protocol`.

**SSE is on its way out.** It is the 2024-era MCP transport, deprecated upstream and superseded by Streamable HTTP. Home Assistant's old `/mcp_server/sse` endpoint is the only reason `mcp-v1-sse` exists. Move a provider off it:

```sql
UPDATE skill_provider
SET type = 'http', url = 'http://<ha-host>:8123/api/mcp'
WHERE name = '<provider>';
```

then reload skills: `POST /config?domiaKey=<key>` with `{"modules":{"skillsEngine":false}}`, then the same call with `{"modules":{"skillsEngine":true}}` (or restart the node). Only `modules.skillsEngine`, `skillProviders` and `character.language` changes reach the skills reloader — any other `modules` change and `POST /config/refresh` leave the connected providers untouched. Verify with `GET /skills?domiaKey=<key>` — the tool list should come back unchanged.

### Protocol era (MCP revision `2026-07-28`)

The v2 adapter can speak either MCP era, **per provider**, from the provider's `config` JSON — one identity may talk to a 2025 server and a 2026 server at the same time.

| `config.protocolMode`                               | Client behaviour                                                                                                            | When to use it                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `legacy` (**default**, also when the key is absent) | the plain 2025 connect sequence — no `server/discover` probe, no new headers, byte-identical to before                      | every existing provider; nothing changes                                 |
| `auto`                                              | probes with `server/discover`; modern evidence selects the 2026-07-28 era, anything else falls back to the legacy handshake | a server you believe is on 2026-07-28 but must keep working if it is not |
| `2026-07-28`                                        | modern only — a server that cannot offer the revision fails the connection loudly                                           | a server you control and have already migrated                           |

Flip one provider to `auto`:

```sql
UPDATE skill_provider
SET config = json_set(coalesce(config, '{}'), '$.protocolMode', 'auto')
WHERE name = '<provider>';
```

then reload skills: `POST /config?domiaKey=<key>` with `{"modules":{"skillsEngine":false}}`, then the same call with `{"modules":{"skillsEngine":true}}` (or restart the node). Only `modules.skillsEngine`, `skillProviders` and `character.language` changes reach the skills reloader — any other `modules` change and `POST /config/refresh` leave the connected providers untouched. `GET /skills?domiaKey=<key>` reports the negotiated era per provider in `protocolEra` (`modern`, `legacy`, or `null` when disconnected).

What the modern era changes, all of it inside the adapter:

- **Tool-list changes** arrive on a `subscriptions/listen` stream that the client opens itself, instead of the 2025 `notifications/tools/list_changed` handler. The legacy handler stays in place for `legacy` providers; both feed the same debounced catalog invalidation.
- **`tools/list` results carry standard `ttlMs` / `cacheScope`.** Domia uses `ttlMs` as a **lower bound only** on the provider's own `tools_refresh_ms`: a server may make the cached catalog go stale sooner, never later. `ttlMs: 0` means "refetch on the next listing".
- **Multi-round-trip requests (MRTR).** A `tools/call` may answer `input_required` instead of a result; the client fulfils the embedded requests through the elicitation presenter and retries, up to 10 rounds, inside the same `callTool`.

> **An MCP elicitation is not a Domia confirmation.** A Domia confirmation is decided **before** a risky tool call and is durable — it parks the invocation in `pending_confirmation` and survives a restart. An MCP `input_required` happens **during** an in-flight `callTool`: it is answered by the same presenter, but it is never persisted and never resumed. If the user does not answer within the provider's `timeout` the round is cancelled, the call comes back as a clean tool error, and the model may simply invoke the tool again.

**When `mcp-v1-sse` gets removed:** as soon as no `skill_provider` row anywhere has `type = 'sse'`. At that point the folder, the `@modelcontextprotocol/sdk` v1 dependency, its ESLint `no-deprecated` carve-out and the SSE fixture in `evals/mcp-client.ts` all go together, and `sse` leaves `MCP_TRANSPORT_ENUM`. Until then, run `npm run evals -- mcp-client` after touching either adapter: it exercises both wire paths plus the selection rule.

## 4c. Node-level configuration (`host_node`)

A handful of knobs govern the **machine**, not an identity: they back a resource that every identity hosted in the process shares, so they cannot live on `domia` (`ConfigApplyManager` is keyed by `domiaKey` + `configRevision` and cannot arbitrate a shared resource). They live in the single `host_node` row and are read through the `node-config` module's in-memory accessor — never per turn from the DB.

| Column                          | Default   | Governs                                                     |
| ------------------------------- | --------- | ----------------------------------------------------------- |
| `meshControlToleranceMs`        | 30 000    | replay/staleness tolerance of the MQTT control envelope     |
| `meshDropWarnWindowMs`          | 10 000    | drop-warning throttle window (rebuilt live on change)       |
| `modelDownloadTimeoutMs`        | 1 800 000 | model download / archive listing timeout                    |
| `modelInstallMaxBytes`          | 12 GiB    | max bytes accepted for one model download                   |
| `modelInstallMaxRedirects`      | 5         | redirect hops allowed while downloading                     |
| `modelInstallMaxConcurrentJobs` | 2         | install jobs allowed to run at once                         |
| `modelJobRetentionMs`           | 1 800 000 | how long finished install jobs stay listable                |
| `publicAudioBaseUrl`            | null      | base URL announced in `/audio/<id>` links (reverse proxies) |

Routes (mesh bearer required, loopback exempt, **no `domiaKey`**):

```bash
curl -H "Authorization: Bearer $DOMIA_MESH_SECRET" http://<node>:3100/node/config
curl -X POST -H "Authorization: Bearer $DOMIA_MESH_SECRET" -H 'content-type: application/json' \
  -d '{"version":1,"node":{"modelInstallMaxConcurrentJobs":3}}' http://<node>:3100/node/config
```

`GET` returns `{ version, revision, node }`; `POST` takes a partial `node` section and answers `{ applied, revision, changed, reloaded }`, where `reloaded` names the node subsystems that picked the change up (`mesh`, `model-manager`, `audio`). Applies run under a node-wide mutex and bump `host_node.configRevision`, which is a counter of its own — independent of every identity's `domia.configRevision`.

Values are clamped by hard caps in the bundle schema (`MODEL_INSTALL_HARD_MAX_BYTES`, `MODEL_INSTALL_HARD_MAX_CONCURRENT_JOBS`, `MODEL_DOWNLOAD_TIMEOUT_HARD_MAX_MS`, …); a value above a cap is rejected with 400, never silently accepted. Mind templates and identity config bundles (`GET`/`POST /config`) never read or write `host_node` — an imported template cannot change a node-level knob.

## 5. MQTT broker: users per node and topic ACLs

The broker already refuses anonymous clients (`allow_anonymous false` + `password_file`). Two opt-in hardening steps:

```bash
make mosquitto-user MQTT_USER=node-a MQTT_PASS='<random>'   # one broker login per node
make mosquitto-acl                                           # seed config/mqtt/acl.txt + enable acl_file
```

Put each node's username/password in its `mqtt_config` (console → MQTT), then edit `config/mqtt/acl.txt` — one `user` block per node granting `write` on the topics it owns. Topic layout (root = `MQTT_TOPIC_ROOT`, default `domia`):

| Topic                                   | Publisher                      | Purpose                                            |
| --------------------------------------- | ------------------------------ | -------------------------------------------------- |
| `domia/<domiaKey>/LOCAL/heartbeat`      | the node hosting that identity | signed identity heartbeat, presence + capabilities |
| `domia/<domiaKey>/LOCAL/config_changed` | the node hosting that identity | live config refresh signal                         |
| `domia/<nodeId>/LOCAL/offline`          | the broker (last will)         | instant offline for the console                    |
| `domia/<nodeId>/LOCAL/speaking`         | the node                       | speaking/silence broadcast between rooms           |

Every node reads `domia/+/LOCAL/#`; the console collector gets read-only `domia/#`. `make mosquitto-acl` validates the broker config with a one-shot `mosquitto --test-config` container and restarts the broker if it is running; `make mosquitto-acl-off` disables the file again. Verify by hand: `docker run --rm -v "$(pwd)/config/mqtt:/mosquitto/config:ro" eclipse-mosquitto mosquitto -c /mosquitto/config/mosquitto.conf --test-config`.

## 6. Tracing (OpenTelemetry)

See a turn as a waterfall in one minute, all local (nothing leaves the machine):

```bash
docker run -d --name domia-jaeger -e COLLECTOR_OTLP_ENABLED=true \
  -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one:latest
echo 'DOMIA_OTEL_EXPORTER_URL=http://127.0.0.1:4318/v1/traces' >> .env   # then restart the node
open http://127.0.0.1:16686/search?service=domia-core
```

Every turn becomes one `domia.turn` trace with a child span per stage (`domia.stt`, `domia.intent`, `domia.llm`, `domia.tool <name>`, `domia.tts`, `domia.playback`) carrying `domia.turn.ttfa_ms`, `domia.turn.perceived_ttfa_ms`, `domia.turn.status`, `domia.intent.decision`, `domia.satellite_id`, and the events `llm.first_sentence` / `tts.first_audio`. A fast-path command shows a single `domia.tool` span and no `domia.llm`. Delegated turns from two nodes share one trace (`domia.origin_domia_key` / `domia.executor_domia_key`). Spans are batched and flushed on shutdown; a node killed mid-batch loses that batch. To stop: remove the env line and `docker rm -f domia-jaeger`.

```
DOMIA_OTEL_EXPORTER_URL=http://collector:4318/v1/traces   # OTLP/HTTP
DOMIA_OTEL_SERVICE_NAME=domia-core                         # resource service.name
```

Unset → **nothing is loaded** (the SDK is imported lazily only when the URL is present; cold boot and the hot path are unchanged). Set → every turn becomes one trace built from the turn-event bus, so no pipeline code participates:

- `domia.turn` (root) — `domia.interaction_id`, `domia.origin_domia_key`, `domia.executor_domia_key`, `domia.satellite_id`, `domia.trace_id`, input type/source, status, TTFA / perceived TTFA / total ms, failure step + code; endpoint and speculation events as span events.
- children: `domia.stt` (transcript length only, never the text), `domia.intent`, `domia.llm` (GenAI semconv: `gen_ai.operation.name=chat`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reasons`), `domia.tool <name>` (`gen_ai.tool.name`, provider, risk class, policy decision, status), `domia.tts`, `domia.playback`, and `domia.stage.<name>` for explicit stage events.
- The OTel trace id **is** the Domia `traceId` (UUIDs map 1:1, other header values hash to 32 hex), so a turn delegated across nodes lands in one trace when both nodes export.

Spans are emitted when the turn reaches a terminal event (completed / failed / aborted); turns that never terminate are flushed with `domia.turn.incomplete=true` when the 256-turn window rolls over. Point it at Jaeger (`jaeger/all-in-one` exposes 4318), Grafana Tempo or any OTLP collector. `npm run evals -- otel` exercises the bridge with an in-memory exporter.

## 7. Updates and rollback (expectations)

**Any `db:reset` is preceded by a lossless snapshot and runs offline** — the exact sequence (mind-dump → verify → node-snapshot → stop the service and wait for the process to exit → reset → start → restore the mind (`mind-dump restore`) → restore node config/config/satellites (`node-snapshot restore`) → counts → one real turn) is in `docs/JETSON.md` "Resetting a node without losing its state"; it applies to every node, not only the Jetson.

There is no updater yet. Today an update is: `make package` on the build host → copy the tarball → extract next to the running install → `npm ci` → stop the service → switch → start → check `/health`. Keep the previous directory until the new one has answered a real turn; `DATABASE_URL` points at the same SQLite file, and `npm run db:reset` **wipes** it — snapshot first (`evals/mind-dump.ts` + `evals/node-snapshot.ts`, in the order above) whenever the schema changed.

The planned updater (roadmap chapter S, item S5 — the microduck blueprint) will make this a release directory with signed tarballs (`MANIFEST.json` already carries per-file SHA-256), an atomic `current` symlink switch, a health gate that rolls back automatically, a boot counter and a snapshot before every update. Nothing in this document will change shape for it; the tarball layout is the contract.

## 8. Checklist before a node leaves the bench

- [ ] `DOMIA_MESH_SECRET` random, 32+ chars, identical on every node (`make posture`)
- [ ] TLS on for every node that is reachable beyond a trusted LAN segment (`make dev-certs` → own PKI later)
- [ ] broker: per-node users + `make mosquitto-acl`
- [ ] `heartbeatSignatureRequired` left on (DB default)
- [ ] `make install-services` (Linux) / launchd (macOS) for the node AND every model server its config uses; then `sudo reboot` once and confirm `make services` shows every port answering and every unit enabled
- [ ] a mind snapshot taken and stored off-device
