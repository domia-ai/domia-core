# qlora-manager

Manages QLoRA adapters applicable to base LLM models (light fine-tuning that modifies personality, emotions, etc.).

> Allows each DOMIA to have customized "mental extensions".

✅ What does the qlora-manager include?
📁 Folder: src/modules/qlora-manager/

Method Function
getAllModules() Lists all available QLoRA adapters
installModule(name) Downloads the file and registers it
getActiveModules(domiaId) Returns active modules for a DOMIA
enableModule(domiaId, qloraId) Activates a specific module
disableModule(domiaId, qloraId) Deactivates it
getPromptAddon(domiaId) Returns text to insert in the contextual prompt

## Description

The QLoRA Manager is a specialized module that handles the management of QLoRA (Quantized Low-Rank Adaptation) adapters for LLM models. These adapters enable lightweight fine-tuning of base models, allowing for personalized modifications to a DOMIA's behavior, personality traits, and emotional responses without requiring full model retraining.

## Key Features

- QLoRA adapter management and installation
- Per-DOMIA module activation
- Dynamic prompt enhancement
- Lightweight model customization
- Personality and behavior modification
- Efficient resource utilization

## Use Cases

- Personality customization
- Emotional response tuning
- Behavior pattern modification
- Domain-specific adaptations
- User preference integration
