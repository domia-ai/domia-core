## ⚙️ config-engine

The `config-engine` module manages the setup, initialization, reconfiguration, and export/import of a DOMIA's core configuration. It is responsible for enabling/disabling cognitive modules, generating consistent state across character and emotion modules, and serializing the full profile for storage or transfer.

---

### 🌱 Provisioning lifecycle (born-minimal → role)

Every Domia boots **neutral / born-minimal**: all runtime capabilities (`wakeword`, `record`, `stt`, `intentDetection`, `intentExecution`, `promptGeneration`, `llm`, `tts`, `playback`) default to `false` (see `DEFAULT_CONFIG_VALUES` in `constants/`). A fresh node runs only heartbeat + HTTP + CLI + gRPC — it needs **no models to boot** and never crashes on a missing model: a structured preflight disables the voice listener and reports the degraded state via `GET /config/health`. "smart"/"dump" are **not** roles in code; behavior is decided entirely by this DB config.

A Domia gets its **role after boot** by importing a config bundle (a portable JSON _template_). One shared persistence path, two transports:

- **CLI** — `DOMIA_ENV=<env> npm run dev-cli -- config import templates/<role>.json`
- **Web Console** — Templates → _Apply_

Both call `persistConfig` (in `modules/config/controller`), which writes the bundle to the DB and then **always restarts** the Domia so it reloads cleanly — there is no live/partial apply. Only the restart _trigger_ differs by transport (in-process exit/touch for HTTP, `requestServiceRestart` for the out-of-process CLI; see `modules/runtime-control`).

Role templates are the **source of truth** in `domia-core/templates/*.json` and are synced into the web Console:

| Template           | Capabilities on            | Role                                                |
| ------------------ | -------------------------- | --------------------------------------------------- |
| `full-hub.json`    | stt, llm, tts, intents     | compute hub — serves other Domias over gRPC, no mic |
| `thin-client.json` | wakeword, record, playback | captures locally, delegates STT/LLM/TTS over gRPC   |
| `defaults.json`    | none                       | the born-minimal baseline ("start from scratch")    |

The config block for a stage stays in the bundle **even when its capability is off** — on delegation the origin's config travels to the responder, so it must exist.

---

### 📚 Public Methods

| Method                                         | Purpose                                                                                               |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `initialize(initialConfig, client?)`           | Creates a new DOMIA with a given configuration and initializes all base modules.                      |
| `reset(domiaId, config, client?)`              | Resets the emotional state, module settings, and character profile using a new configuration.         |
| `updateModuleSettingsByDomiaId(domiaId, data)` | Updates specific settings in the module configuration.                                                |
| `enableModule(domiaId, moduleName, client?)`   | Enables a specific module for the given DOMIA.                                                        |
| `disableModule(domiaId, moduleName, client?)`  | Disables a specific module.                                                                           |
| `isModuleEnabled(domia, moduleName)`           | Returns whether a specific module is currently enabled.                                               |
| `exportConfig(domia)`                          | Serializes the full configuration of a DOMIA, including traits, skills, emotions and enabled modules. |
| `importConfig(domiaId, config, client?)`       | Applies an entire configuration to an existing DOMIA, replacing all current data.                     |

---

### 🧠 Configuration Contents

A DOMIA configuration (`ConfigType`) includes:

- Identity (`name`, `domiaKey`)
- Modules enabled (`emotionEngine`, `memoryEngine`, etc.)
- Personality & emotional vector
- Character traits (language, age, profession, etc.)
- Social information (hobbies, skills, interests)
- Optional Wi-Fi or network preferences

---

### 🧪 Planned / Upcoming Methods

| Method                                | Purpose                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------- |
| `getDefaultConfig()`                  | Returns the default configuration object (same as `DEFAULT_CONFIG_VALUES`).  |
| `getConfigTemplate(type)`             | Returns a template config based on type: `child`, `assistant`, `guest`, etc. |
| `partialUpdateConfig(domiaId, patch)` | Applies a shallow update to an existing config (without full reset).         |
| `getConfigDifferences(current, next)` | Returns a diff object showing what would change if config is replaced.       |
| `validateConfig(config)`              | Validates a configuration object using schema rules and constraints.         |

---

This module is essential for onboarding new DOMIA instances, cloning devices, or managing reboots and module toggling in live environments.
