# llm-model-manager

Manages the LLM models available in the system: their name, provider, path, status, compatibility, etc.

> Allows DOMIA to switch between models based on capability or configuration.

✅ 1. llm-model-manager (new module)
This module manages available models: their metadata, availability, installation, and synchronization.

🔹 Responsibilities:
Method Description
getAllModels() Lists all models in the database
getAvailableModels() Lists only those with available = true
getModelById(modelId) Returns a specific model
createModel(metadata) Adds a new model to the table
markAsInstalled(modelId) Changes available = true and saves installedAt
scanInstalledModelsViaOllama() Queries Ollama and updates availability
installModel(name) Calls Ollama API to pull the model
getModelSize(modelId) Returns the size ('tiny', 'base', 'large')

🔁 This module can be called from:

config-engine (to know what to use by default)

llm-agent (to decide how to build the prompt or call the model)

UI/API (to show options to the user)

📁 Suggested folder: src/modules/llm-model-manager/

## Description

The LLM Model Manager is a crucial component in DOMIA's AI infrastructure. It provides a centralized system for managing different Large Language Models, handling their lifecycle from installation to deployment. The module ensures that DOMIA can seamlessly switch between different models based on specific requirements, performance needs, or user preferences.

Key features include:

- Model metadata management
- Installation and availability tracking
- Integration with Ollama for model management
- Size and capability categorization
- Cross-module coordination for model selection and usage
