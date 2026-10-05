# Modules

Each folder here is one capability of Domia (speech-to-text, the LLM engine, the agent loop, skills, memory, reflection, satellites, …). A module owns its logic, its types and its persistence, and exposes them through a barrel.

## Shape

| Path                                        | Role                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                  | Pure barrel: re-exports what other modules may use. No logic.                                                                                       |
| `controller/`                               | The module's public functions.                                                                                                                      |
| `types/`                                    | Every named type of the module, in `types/index.ts`. Types are never declared inline elsewhere.                                                     |
| `utils/`                                    | Stateless helpers used inside the module.                                                                                                           |
| `constants/`                                | Fixed values that are not configuration. Anything tunable is a database column, not a constant here.                                                |
| `schemas/`                                  | Zod schemas for input and stored JSON.                                                                                                              |
| `db-adapter/`                               | Persistence for the module.                                                                                                                         |
| `engines/`, `adapters/`, `specializations/` | For modules with interchangeable implementations: one folder per implementation plus a registry. Adding an engine is a folder and a registry entry. |

A module has only the folders it needs.

## Conventions

- Closure factories (`createX`), no classes.
- A file with logic never re-exports; barrels only re-export.
- Adapters throw `domiaError`; they never return a failure object.
- Log through `createLogger`.

The full rules are in [`AGENTS.md`](../../AGENTS.md) at the repository root.
