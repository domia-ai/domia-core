# AGENTS.md — domia-core

Rules and map for any coding agent (and any person) working in this repository. `CLAUDE.md` imports this file; there is no second copy. If a rule here conflicts with what the code does, say so instead of guessing which one is right.

## What this is

Domia is a voice agent that lives entirely on the user's own hardware. You talk to it and it talks back in character: it hears a wake word, transcribes the speech, decides whether you asked for something or are just talking, acts through its skills or answers with a local language model, and speaks the reply. It remembers what it learns about the people it talks with, has a personality and a mood that persist, and keeps voice, memory and configuration on the device — no cloud audio, no account.

`domia-core` is the product: one Node process per device. The same process can be a complete assistant on one machine, a hub that serves several rooms, or a thin device that only listens and plays while a stronger node does the heavy stages. It is built to run on modest hardware; better hardware gets a better experience through configuration, not through a different product.

How one turn flows:

1. **Listen** — wake word and voice-activity detection on the device or on a satellite; streaming speech-to-text.
2. **Decide** — a pending confirmation or an open question is resolved first; then the **fast path** (templates that answer known commands in milliseconds, no model); then the **tool judge** (one short model call that names the single tool the sentence asks for, or none).
3. **Act or answer** — if a tool was named, the **agent** calls it and speaks the result; otherwise the model replies in character, streamed sentence by sentence.
4. **Speak** — text-to-speech streamed to the speaker that heard the request.
5. **Reflect** — after the turn, off the hot path, a background pass extracts facts and mood from the conversation.

Words used throughout the code:

| Term                 | Meaning                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| identity (a "Domia") | one character with its own persona, voice, memory and config, addressed by a `domiaKey`                                         |
| node                 | one running process; hosts one or more identities                                                                               |
| hub                  | a node other devices delegate stages to                                                                                         |
| thin client          | a node that captures and plays audio and delegates STT, LLM and TTS                                                             |
| satellite            | a room microphone/speaker device attached to a node over one of several protocols (ESPHome, Wyoming, LiveKit, native WebSocket) |
| origin               | the identity a turn belongs to; it owns the conversation, the trace and the memory even when another node does the work         |
| skill provider       | a source of tools: the built-in provider, or any MCP server; some have a code specialization                                    |
| descriptor           | the JSON that tells Domia how to route, fast-path and phrase a provider's tools                                                 |
| mind                 | everything an identity has learned and become: facts, episodes, user model, mood                                                |
| template             | a JSON bundle of config that gives a node its role                                                                              |

Stack: TypeScript on Node 24, SQLite with Drizzle, MQTT for discovery and heartbeat, gRPC streaming between nodes. Wake word, voice activity, turn detection and in-process speech run through `sherpa-onnx-node`; the LLM (and optionally speech-to-text) are external servers reached over HTTP (llama.cpp `llama-server`, Ollama, NeMo-Speech.cpp).

Read before changing anything substantial:

| Doc                                | What it answers                                  |
| ---------------------------------- | ------------------------------------------------ |
| `README.md`                        | what works today, quick start                    |
| `GETTING_STARTED.md`               | clean machine to a running node                  |
| `docs/ARCHITECTURE.md`             | how a turn flows, modules, topologies            |
| `docs/skill-descriptor.md`         | how a skill is routed, fast-pathed and finalized |
| `docs/DEPLOY.md`, `docs/JETSON.md` | running on a real device and on a Jetson hub     |
| `src/modules/README.md`            | the module folder convention                     |
| `COMMITS.md`                       | commit message style                             |

## Layout

```
src/
  index.ts        boot
  db/             schema/ (Drizzle tables by family), constants/ (every default lives here), json types
  config/         environment parsing (the few values that are not database config)
  modules/        one folder per capability (stt-engine, llm-engine, agent, skill-engine, memory, …)
  setups/         process wiring: HTTP server, gRPC server, core bus, MQTT, config reloaders
  buses/          typed event buses
  utils/          logger, errors, language catalogs, LLM-JSON parsing
  types/          ambient declarations          test-utils/   mocks and corpora shared by the evals
  cli/            developer CLI
  generated/      protobuf output (npm run proto:gen) — never edit by hand
evals/            the verification suites and their registry (evals/index.ts)
templates/        node role templates applied through the config API
proto/            gRPC contract
config/, data/    service and broker config; data/ holds models, databases and certificates (not tracked)
scripts/, makefile  OS-level setup: models, services, llama-server, packaging
tmp/              throwaway scripts; excluded from build and lint; nothing durable goes here
```

A module is `index.ts` (a pure barrel) plus the folders it needs: `controller/` (its public functions), `types/`, `utils/`, `constants/`, `schemas/` (Zod), `db-adapter/` (persistence), and for modules that host interchangeable implementations `engines/`, `adapters/` or `specializations/` (one folder per implementation plus a registry). Not every module has every folder.

## Commands

| Command                               | What it does                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev` / `npm run dev:b`       | run node A / node B with reload (two neutral dev nodes, separate DBs)              |
| `npm run stop`                        | stop every dev process of this checkout — use this, never kill pids by hand        |
| `npm run check`                       | build + lint + typecheck of `evals/` — must be clean before you call anything done |
| `npm test`                            | the `pure` eval battery (no node, no model, no network)                            |
| `npm run evals -- <suite or battery>` | run one suite or a battery; `npm run evals -- --list` prints them all              |
| `npm run db:reset` / `db:reset:b`     | delete the database and rebuild it from the schema (wipes all data)                |
| `npm run proto:gen`                   | regenerate `src/generated/proto` after editing `proto/`                            |
| `npm run dev-cli -- <command>`        | developer CLI (doctor, model setup, config import)                                 |

Eval batteries: `pure` needs nothing. `node`, `tool`, `quality` and `hardware` need a running node (and say what else they need: skills, a Home Assistant, a model server). Several `tool` and `quality` suites actuate real devices or play on real speakers; their descriptions say so — do not run those against someone's home without being asked.

## How a node is defined

- A node is an envelope: a database, ports and a principal identity key. It boots neutral. Its role (hub, full device, thin client) comes entirely from database configuration, applied from a template.
- One process can host several identities; they are rows, not environment variables.
- Never branch on the name of a node or identity. Code reads capabilities and config, not names. (Dev seed scripts, test utilities and bench harnesses are the only exception.)

## Rules

Functional style

The codebase is written as functions and data, not objects.

- **Functions and closures, never classes.** A stateful thing is a factory (`createX(deps)`) that returns functions closed over its state. No `class`, no `this`, no inheritance. The single class is `DomiaError`, because an error must extend `Error`.
- **Pure by default.** A function takes what it needs as arguments and returns its result. Side effects (database, network, audio, logging, time) live at the edges — adapters, controllers, handlers — and the logic between them is pure and lives in `utils/`.
- **Do not mutate what you were given.** Arguments, config objects and anything read from another module are read-only; return a new value instead.
- **`const` always; `let` only for the private state of a closure or a measured hot loop** (audio frames, token streams). Never use `let` to build a value by branching — write an expression (ternary, `map`/`filter`/`reduce`, an early-returning helper).
- **Explicit dependencies.** Pass collaborators in; do not reach for module-level mutable state. A module-level `Map` or cache is allowed only inside the module that owns it, behind functions.
- **Small functions with names that say what they do.** If a block needs a comment to be understood, it wants to be a named function.

Code shape

- **No comments in code.** No JSDoc, no section dividers, no "why" notes. The only exception is a one-line note for an invariant that cannot be expressed in a name (an ordering constraint, a race, a cost that explains a lazy import).
- **Named types live only in the module's types file** — `types/index.ts` in a module, `types.ts` or `types/` in a `src/utils/` helper. Never declare a named type in a controller, util or adapter. Row types inferred from a table live beside the schema in `src/db/`; shapes of JSON columns live in `src/db/json-types.ts`.
- **`type`, not `interface`** (lint only warns on this one; treat it as a rule).
- **A module's root `index.ts` is a pure barrel** and a file with logic never re-exports something else. (Inside `engines/`, `adapters/` and `tools/`, each implementation's own `index.ts` is its implementation, and the folder's index is its registry.)
- **No backwards-compatibility shims and no dead code.** If something is unused, delete it. No `_unused` renames, no "removed" markers.
- **No code for a developer's machine.** A fresh install must be correct by itself; a quirk of one dev box is a doc note, never a guard in the product.

Configuration

- **Nothing tunable is hardcoded.** Thread counts, thresholds, model paths, timeouts, sample rates and the like are database columns read at runtime. The default goes in the column's `.default(...)`, sourced from a named constant in `src/db/constants`. (Structural starting state — a counter at `0`, a flag at `false`, an empty string — may be a literal; a value someone could reasonably want to tune may not.)
- **Defaults are chosen for modest hardware**, never for a fast development machine. A heavier model or setting is an option in config, not a default. Thin clients never run STT, LLM or TTS; they delegate.
- **No migrations.** There are no migration files. A schema change ships with `npm run db:reset`, which deletes the database and rebuilds it straight from `src/db/schema`. Say in the pull request that a reset is needed, because it wipes a node's data.

Models and languages

- **No Python in the product.** In-process inference goes through `sherpa-onnx-node`; anything else is an external server Domia talks to over HTTP or WebSocket. (A setup or benchmark shell script may call the system `python3` for one-off parsing; nothing a running node needs may.) `npm run evals -- sherpa-gate` must pass on every `sherpa-onnx-node` version change.
- **Language is data.** Words, phrases and grammar markers live in the language catalogs (`src/utils/language-catalogs`) as records keyed by language with an English fallback. A new language is a new key, never a new branch in code.

Skills

- **The core is provider-agnostic.** No vocabulary or behaviour of one provider outside its specialization folder (`npm run evals -- agnostic-gate` enforces it).
- **Routing is tuned with data, not with code.** A sentence reaches a tool through the fast-path templates or through the tool judge, and both are fed by the skill descriptor (`fastPath`, `routing.toolExamples`, `routing.toolLabels`). Never fix a misrouted sentence with a word list or a special case in core; change the mechanism or the descriptor, and measure on `npm run evals -- tool-judge` (its test sentences are kept disjoint from the descriptor examples on purpose).

Scope of a change

- **Every feature must hold in every deployment shape**: standalone, several identities in one process, several hubs, and through a satellite — and on every transport (a satellite and a full local node).
- **Prefer the general fix.** If a change only works for one model, one OS or one device, it is an option, not the solution.

Errors and logs

- Engine, database and gRPC adapters `throw domiaError(...)` with a code from the error catalog (`src/utils/error`); they never return `{ success: false }` and never swallow. A plain `Error` is only for a programming invariant inside a pure helper (a malformed template at load, an impossible branch) — anything a caller is expected to handle is a `domiaError`.
- Core-bus handlers catch and report the failed interaction; they never rethrow past the bus.
- Registries, hooks and fire-and-forget observers catch, warn and continue.
- Narrow with `isDomiaError`, not `instanceof`.
- Log through `createLogger(namespace)`. No `console.*` in `src/` outside the logger and the CLI (evals and scripts print freely).
- Parse model output with `parseLlmJson`; plain `JSON.parse` is for protocol payloads only.

## Verifying a change

A clean compile is not evidence. Before saying something works:

1. `npm run check` and `npm test`.
2. The suite that covers what you touched:

| Area                                  | Suite                                                            |
| ------------------------------------- | ---------------------------------------------------------------- |
| routing, tool judge, shortlist        | `skill-routing`, `tool-judge`, `routing`                         |
| fast path, built-in tools, routines   | `fast-path-data`, `builtin-tools`, `routines`, `fast-path-sweep` |
| agent loop, confirmations, delegation | `agent-loop`, `delegated-skills`                                 |
| skill descriptors, MCP                | `descriptor-resource`, `mcp-client`, `skills-reload`             |
| endpointing, speculation, slots       | `turn-logic`, `two-tier`                                         |
| reply and audio delivery              | `reply-delivery`, `audio-delivery`, `ttfa`                       |
| memory and reflection                 | `reflection`, `reflection-extraction`, `fact-dedup`              |
| config and schema                     | `config-apply`, `node-config`, `http-surface`                    |
| languages                             | `language-scaffold`                                              |
| latency                               | `bench-voice`, `satellite-bench` (report before and after)       |

3. For anything on the voice path, drive real audio: post a WAV to the node's `/voice` endpoint or run the satellite bench, then read the interaction row and the logs. This exercises everything except the wake word and the microphone.
4. Report what you ran and what it printed. If a suite fails or you skipped one, say that.

`routing`, `fast-path-sweep` and the other `node`/`tool` suites need a running node; `tool-judge` needs only the model server (its address comes from `EVAL_JUDGE_OPENAI_HOST`; the eval settings are in `evals/lib/env.ts`). For routing and latency, report the numbers before and after.

New behaviour gets a check in the suite that owns the area. Durable test tooling lives in `evals/`; `tmp/` is disposable. `npm run validate` adds the Prettier check; the commit hook formats staged files.

## Common tasks

**Add a configuration knob.** Put the default in the matching file of `src/db/constants/`, add the column with `.default(THAT_CONSTANT)` to the table in `src/db/schema/`, read it at runtime from the resolved config object (never cache it in a module constant), and classify it in `src/modules/config-apply/constants` (live, or which subsystem must reload). `npm run evals -- config-apply` fails until it is classified. Set it in a file under `templates/` only when a role needs a value different from the default. It needs a `db:reset`.

**Add a built-in tool.** One folder under `src/modules/skill-engine/specializations/domia/tools/<name>/`: the definition and executor in `index.ts`, and one JSON pack per language in `descriptors/` — `intents` (fast-path templates), `exampleUtterances` (the sentences the tool judge learns from; the specialization turns them into `routing.toolExamples`) and `finalize` texts. Add it to the list in `tools/index.ts`. `builtin-tools` and `fast-path-data` cover it. Limits that belong to the tool's contract may be constants in its folder; anything a user would tune is a column.

**Fix a sentence that reaches the wrong tool, or none.** Find the turn's intent decision (`fast-path:…`, `skill (judge:…)`, `chat (judge:none)`). If a template should have caught it, fix the template data. Otherwise improve that tool's examples or label in the descriptor. First check the tool can do what was asked at all — if its arguments cannot express the request, the fix is in the tool, not in routing. Add sentences of that kind — not the same sentence — to the corpus in `evals/fixtures/builtin-routing-corpus.json` and run `tool-judge`; the suite fails if a test sentence equals a descriptor example.

**Drive a voice turn without a microphone.** `POST /voice` with `{"filePath": "/absolute/path/to.wav"}` on the node's HTTP port (example in `GETTING_STARTED.md`); `POST /chat` with `{"domiaKey", "text"}` does the same from text. The response carries the interaction id and stage timings, `GET /interactions/<id>` returns the full row, and the node log shows each stage.

Utility suites (`mind-dump`, `node-snapshot`, generators) are tools, not tests; run them by name.

## Git

- An agent working in a maintainer's checkout does not commit, push, amend, rebase or tag unless asked in that conversation: it leaves the work in the tree and says what changed. (A contributor working on their own fork commits to their own branch as usual — see `CONTRIBUTING.md`.)
- No destructive commands (`reset --hard`, `checkout --` over someone's changes, force push) without an explicit request.
- No `Co-Authored-By` lines and no tool attribution in commit messages or pull requests.
- Commit messages follow `COMMITS.md`.

## Never

- Commit `.env*` files, databases, model files, certificates, or real voice recordings.
- Print or log secrets (mesh secret, provider tokens, API keys).
- Copy a pinned dependency version from an example; install the current release.
- Edit `src/generated/`.
- Run suites that actuate real devices on an installation you were not asked to test.
