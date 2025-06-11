## 🧩 core-engine

The `core-engine` module provides access to the foundational DOMIA entity, which represents the root configuration and identity anchor for each DOMIA instance. Other cognitive modules (e.g., emotion, memory, character) are linked to this entity.

This module is responsible for retrieving and creating DOMIA instances and provides a central lookup mechanism based on ID or a public `domiaKey`.

---

### 📚 Public Methods

| Method                                 | Purpose                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `getDomiaByDomiaKey(domiaKey)`         | Retrieves a DOMIA instance using its unique `domiaKey` (usually defined at device level). |
| `getDomiaById(id)`                     | Retrieves a DOMIA instance by its internal database ID.                                   |
| `getDomia(domiaIdOrKey, byKey = true)` | Unified access method: fetches DOMIA either by key or ID depending on the `byKey` flag.   |
| `insertDomia(data, client?)`           | Creates a new DOMIA instance using the provided Prisma input data.                        |

---

### 🧪 Planned / Upcoming Methods

| Method                                  | Purpose                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `getDomiaWithModules(domiaId)`          | Returns the DOMIA instance along with its related modules (emotion, memory, character, etc.). |
| `initializeDomiaState(domiaId)`         | Initializes all default modules and values for a newly created DOMIA.                         |
| `deleteDomia(domiaId)`                  | Deletes the DOMIA instance and all related cognitive module records.                          |
| `cloneDomia(domiaId, overrides?)`       | Creates a copy of an existing DOMIA with optional overrides.                                  |
| `updateDomiaMetadata(domiaId, updates)` | Updates global DOMIA properties such as name, avatar, location, etc.                          |
| `getAllDomiaForUser(userId)`            | Retrieves all DOMIA instances linked to a specific user or account.                           |
| `getDomiaStatus(domiaId)`               | Returns operational status: online/offline, module health, last sync.                         |

🧠 Notes
The domiaKey is often used to associate physical devices or external services with a DOMIA instance.

The core-engine serves as the anchor for all other modules (emotionState, memory, characterProfile, etc.) via relational models.

It is commonly used as the entry point when initializing a session, device, or cognitive action.
