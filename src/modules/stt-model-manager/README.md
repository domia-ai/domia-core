# stt-model-manager

This module manages the Speech-to-Text (STT) models available in the DOMIA system.

## 🎯 Purpose

To select, validate, and execute the appropriate STT model for converting audio to text, either locally or remotely, depending on the environment.

## ✅ Responsibilities

- Register and list available STT models (such as whisper.cpp, faster-whisper, etc.)
- Verify if models are installed and functional
- Execute transcription from `.wav` or `.mp3` files
- Delegate actual transcription to `stt-engine` when applicable
- Serve as a control point for scaling based on device profile

## 🚫 What it doesn't do

- Does not record audio (that's handled by `audio-capture`)
- Does not perform direct transcription (that's handled by `stt-engine`)
- Does not manage global configuration (that's handled by `config-engine`)

## 🛠 Expected Methods

```ts
getAvailableModels(): STTModel[]
validateModelInstalled(modelId: string): boolean
getDefaultSTTModel(): STTModel
runSTT({ modelId, inputPath }): Promise<TranscriptionResult>
```

## Description

The STT Model Manager is a crucial component that oversees the lifecycle of speech-to-text models in DOMIA. It ensures that the appropriate model is available and properly configured for each use case, whether running locally or in a cloud environment.

## Key Features

- Model lifecycle management
- Installation and validation
- Performance optimization
- Environment-aware model selection
- Integration with STT engine
- Resource-aware scaling
