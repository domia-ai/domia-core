## 🧠 Module Architecture Overview

DOMIA is designed as a collection of modular cognitive engines. Each module (e.g., `emotion-engine`, `memory-engine`, `identity-engine`) encapsulates a distinct layer of intelligence or functionality within the DOMIA ecosystem.

All modules follow a consistent, folder-based architecture to ensure clarity, scalability, and maintainability across the entire system.

### 📁 Folder-Based Module Pattern

Each DOMIA module includes the following standard folders:

| Folder        | Role                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------- |
| `constants/`  | Contains static values, constants, and predefined enums.                                  |
| `controller/` | Public API of the module. Contains the main methods exposed to other parts of the system. |
| `db-adapter/` | Handles database operations or connections. Abstracts persistence logic for the module.   |
| `example/`    | Demonstrates usage patterns and serves as live documentation.                             |
| `schemas/`    | Includes validation schemas (e.g., with Zod) to enforce input/output integrity.           |
| `types/`      | TypeScript interfaces and types shared within the module.                                 |
| `utils/`      | Stateless utility functions used internally.                                              |
| `__tests__/`  | Unit tests scoped to the module’s functionality.                                          |
| `index.ts`    | Entry point that re-exports selected functionality for simplified imports.                |

### 🧩 Why Modular?

- **Decoupling**: Each module operates independently but adheres to common standards.
- **Composability**: Modules can be plugged in or swapped out with minimal effort.
- **Cohesion**: Related logic stays together, improving readability and development flow.
- **Scalability**: New features can grow organically inside their own bounded contexts.

This architecture is designed to support DOMIA’s long-term vision: a distributed, cognitive, and emotionally intelligent system for smart environments.
