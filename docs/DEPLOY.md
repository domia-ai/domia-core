# Deploying a Domia node

This is the operations guide for running `domia-core` on a real device: packaging, services, TLS, secrets, MQTT ACLs, tracing and what to expect from updates. Every knob here is **off by default** — a node with none of it configured boots exactly as in `GETTING_STARTED.md`. Roles still come from templates applied through the console; nothing below changes what a node _is_, only how it is protected and observed.

## 1. Package and install

```bash
make package                       # → dist/domia-core-<version>+<commit>.tar.gz (+ .sha256)
```

The tarball contains `build/` (compiled JS), `templates/`, `scripts/`, `proto/`, the DB schema (`src/db/schema.ts` + constants, needed by `db:reset`), `package.json`/`package-lock.json`, `.env.example`, the Mosquitto config (`mosquitto.conf` + `conf.d/`) + ACL template, this document and `MANIFEST.json` (version — with a `-dirty` suffix when built from an uncommitted tree — commit, build host, sha256 of every packaged file except `MANIFEST.json` itself, the entry point and the start command `node --env-file=.env build/index.js`). Native modules (sherpa-onnx, better-sqlite3) are **not** inside — `npm ci` on the target fetches the right binaries for its OS/arch. The `Dockerfile` is **not** packaged: it builds from a source checkout (`COPY . . && npm run build`), which the compiled tarball does not carry.

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

- **Linux (systemd)** — `make install-services` installs the whole hub as enabled units in one go: `llama-server` (LLM) and `domia` (the node, ordered after the servers) as system units (sudo), and `nemo-speech` (STT) as a **user** unit under `~/.config/systemd/user/` with `loginctl enable-linger` — no sudo, and it starts at boot without anyone logging in. All `Restart=always`. On an 8 GB box pass `LLM_CACHE_RAM_MB=0`. The three targets also exist individually (`make llm-service`, `make nemo-service`, `make domia-service`), but install all the servers your DB config points at: a node whose `stt.engine=NEMO_SPEECH` and no `nemo-speech` unit answers every turn with `INTERACTION_FAILED step: 'stt'` after the first reboot (the satellite shows a red ring). Logs: `journalctl -fu domia|llama-server|nemo-speech`. Verify boot survival any time with `make services` — it lists which units are enabled.
- **MQTT broker (docker)** — `make mosquitto` starts `eclipse-mosquitto` with `restart: unless-stopped` and fixes the config permissions it needs: the container runs as UID 1883, so `config/mqtt/password.txt` and `mosquitto.conf` must be world-readable (`644`). A `600` password file makes the broker crash-loop (`Unable to open pwfile`, exit 13) while `mosquitto --test-config` still reports OK — if you copy the config by hand, run `chmod 644 config/mqtt/password.txt`.
- **Not used = disabled** — if llama-server is the LLM, disable a natively installed Ollama (`sudo systemctl disable --now ollama`); on small boards its resident memory competes with the inference servers.
- **macOS (launchd)** — `make llm-service` installs the `ai.domia.llm-server` user agent for llama-server. The node itself runs with `make run`; wrap it in a launchd agent the same way if you need it to survive reboots (the plist pattern is in the makefile).
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
- **URL playback on satellites is the one thing TLS can break.** Satellites that play a URL instead of a stream (ESPHome / Voice PE media players, and any other `playAudioUrl` transport) fetch `/audio/<id>` with their own firmware HTTP client, which has no way to trust a private CA. When TLS is on, the node emits `https://…/audio/<id>` — the node listens on **one** port and it is HTTPS, so there is no plaintext audio origin to fall back to — and those satellites fail playback (the turn still completes; only the audio does not land). The node logs this once per process: `⚠️ TLS is on: /audio URLs are https …`. Today the workarounds are (a) leave TLS off on nodes that serve URL-playback satellites and protect that segment another way, (b) use a stream-capable transport (native WS, Wyoming) for those rooms, or (c) front the node with a reverse proxy holding a publicly trusted cert. A `domia.publicAudioBaseUrl` column that lets an operator point satellite audio at that proxy (or at a plaintext origin) is **deferred** — it needs a schema column and is not in this change.

Not covered here: MQTT transport encryption. `mqtt_config.protocol` accepts `mqtts`; add a `listener 8883` with `certfile`/`keyfile` to `config/mqtt/mosquitto.conf` if the broker leaves the trusted LAN.

## 4. Secrets and rotation

`DOMIA_MESH_SECRET` is the shared mesh credential: bearer token on REST/gRPC between nodes and the HMAC key that signs heartbeats (`heartbeatSignatureRequired`, DB, default on). Set a long random value (32+ chars) on every node before the first boot on a shared network; `make posture` warns about the example default.

Rotating it without downtime:

1. Add `DOMIA_MESH_SECRET_NEXT=<new secret>` to every node's env and restart them one at a time. A node with `NEXT` set **signs and sends with the new secret** and **accepts both** for the grace window — `domia.meshSecretGraceMs` (DB column, default 24h, live-reloadable through the console like every other `domia` field).
2. Check the posture on any node: `POST /mesh/rotate` (mesh bearer or loopback) returns `{ rotating, signingWith, accepted, graceMs, graceEndsAt, fingerprints }`. Fingerprints are 12-char SHA-256 prefixes, never the secrets.
   - `{"action":"restart-grace"}` restarts the window (e.g. the last node was restarted later than expected).
   - `{"action":"end-grace"}` stops accepting the old secret immediately.
3. Once every node runs with `NEXT`, move the new value into `DOMIA_MESH_SECRET`, drop `NEXT`, restart again. Between step 1 and 3 a stray node still on the old secret keeps working until the window closes, then its heartbeats are dropped (`heartbeatSignatureRequired`) and its calls get `401`/`UNAUTHENTICATED`.

`DOMIA_KEY` (the node's principal identity) and provider tokens (skill providers, LiveKit) are DB/config material and rotate through the console; `evals/node-snapshot.ts` (see `docs/JETSON.md`) is the export/import path when a node is rebuilt.

### What the bearer does _not_ cover

Every HTTP route requires the mesh bearer unless the caller is on loopback. The deliberate exceptions:

| Route                                                              | Open to           | Why                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /` and `GET /health`                                          | anyone on the LAN | liveness for `make services`, load balancers and the console's reachability probe; neither returns identity or config data                                                                                                                    |
| `GET /audio/<id>` with `kind=tts` (the default) or `kind=announce` | anyone on the LAN | satellites that play a URL (ESPHome / Voice PE media players) fetch this with firmware HTTP clients that cannot carry a bearer. The payload is the node's own spoken reply, and the `<id>` is an unguessable UUID with a 5-minute serving TTL |

`GET /audio/<id>?kind=input` is **not** exempt: that is the user's own recording, so it needs the bearer (or loopback) like every other route. An unrecognised `kind` is not exempt either. `npm run evals -- http-surface` asserts this predicate directly, so the exemption list cannot widen unnoticed.

On a segment you do not trust, put the node behind TLS _and_ a firewall rule — the open audio kinds are a LAN-trust assumption, not an authorization decision.

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

There is no updater yet. Today an update is: `make package` on the build host → copy the tarball → extract next to the running install → `npm ci` → stop the service → switch → start → check `/health`. Keep the previous directory until the new one has answered a real turn; `DATABASE_URL` points at the same SQLite file, and `npm run db:reset` **wipes** it — export the mind first (`GET /mind`, `evals/node-snapshot.ts`) whenever the schema changed.

The planned updater (roadmap chapter S, item S5 — the microduck blueprint) will make this a release directory with signed tarballs (`MANIFEST.json` already carries per-file SHA-256), an atomic `current` symlink switch, a health gate that rolls back automatically, a boot counter and a snapshot before every update. Nothing in this document will change shape for it; the tarball layout is the contract.

## 8. Checklist before a node leaves the bench

- [ ] `DOMIA_MESH_SECRET` random, 32+ chars, identical on every node (`make posture`)
- [ ] TLS on for every node that is reachable beyond a trusted LAN segment (`make dev-certs` → own PKI later)
- [ ] broker: per-node users + `make mosquitto-acl`
- [ ] `heartbeatSignatureRequired` left on (DB default)
- [ ] `make install-services` (Linux) / launchd (macOS) for the node AND every model server its config uses; then `sudo reboot` once and confirm `make services` shows every port answering and every unit enabled
- [ ] a mind snapshot taken and stored off-device
