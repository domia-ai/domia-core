🧠 emotion-engine Overview
The emotion-engine is responsible for managing the emotional state of each DOMIA instance based on:

Events from the environment

User interactions

Time progression

Internal drives

It acts as a core module that all other components (voice, memory, UI, etc.) depend on to generate emotionally meaningful behavior.

## 🎭 emotion-engine

The `emotion-engine` module manages the emotional state of each DOMIA instance. It maintains a dynamic emotion vector that evolves in response to interactions, time, personality, and contextual stimuli.

This module directly influences DOMIA's behavioral tone, reactions, and long-term psychological patterns.

---

### 📚 Public Methods (Emotion Lifecycle)

| Method                                  | Purpose                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `triggerEmotion(domia, cause, delta)`   | Applies an emotional change based on an external or internal cause. The delta modifies the current emotion vector and creates an event. |
| `decayEmotion(domia)`                   | Applies a natural decay to the current emotional state, reducing intensity over time.                                                   |
| `resetEmotion(domiaId, emotionVector?)` | Resets the DOMIA's emotional state to a default or specified vector.                                                                    |
| `getInitialEmotionState(personality)`   | Returns the starting emotional preset based on DOMIA's personality.                                                                     |

---

### 🧪 Planned / Upcoming Methods

| Method                                   | Purpose                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `deriveMood(domiaId)`                    | Derives a high-level mood label (e.g., calm, anxious, euphoric) from the emotion vector. |
| `getDominantEmotion(domiaId)`            | Returns the strongest individual emotion currently present.                              |
| `simulateEmotionalResponse(input)`       | Simulates an emotional reaction to a hypothetical event or interaction.                  |
| `generateEmotionNarrative(domiaId)`      | Produces a short descriptive narrative of DOMIA's current emotional state.               |
| `adjustEmotionByMemory(domiaId, memory)` | Modifies emotion vector based on memory recall or long-term associations.                |
| `getEmotionHistory(domiaId)`             | Returns a timeline or list of past emotion states and transitions.                       |
| `exportEmotionSnapshot(domiaId)`         | Generates a snapshot of the emotion vector for external visualization or backup.         |

🧠 Emotion Engine Concepts
Emotion Vector: A numerical representation of DOMIA’s current affective state (e.g., joy, fear, surprise, etc.)

Emotion Delta: A partial vector indicating how the state should change in reaction to a cause.

Decay: A mechanic that gradually reduces emotion intensity, simulating emotional fading over time.

Preset States: Each personality has a predefined emotional baseline (e.g., FRIENDLY starts more positive).
