## ⚙️ config-engine

The `config-engine` module manages the setup, initialization, reconfiguration, and export/import of a DOMIA's core configuration. It is responsible for enabling/disabling cognitive modules, generating consistent state across character and emotion modules, and serializing the full profile for storage or transfer.

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
