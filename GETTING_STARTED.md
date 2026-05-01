# 🚀 Getting Started with DOMIA Core

This guide will help you set up and run the DOMIA Core project from scratch.

## 📋 Prerequisites

- **Node.js** with nvm (preferably version 24.2.0 - tested)
- **Python** with pyenv (preferably version 3.11.9 - tested) - [Install pyenv](https://github.com/pyenv/pyenv)
- **Docker** - [Install Docker](https://www.docker.com/products/docker-desktop/)

## 🛠️ Installation Steps

### 1. Install Node.js Dependencies

```bash
npm install
```

### 2. Install Python Dependencies

```bash
make venv
```

### 3. Install Required Binaries

```bash
make install-deps
```

### 4. Verify Installation

Check that everything is properly configured and installed:

```bash
make doctor
```

### 5. Set Up Ollama Container

Install the Ollama container in Docker:

```bash
make ollama
```

### 6. Install LLM Model

Install a language model (e.g., Llama):

```bash
make install-llama
```

## 🧪 Testing Individual Components

You can test each functionality individually:

### Test Microphone and Record Audio

```bash
make mic-test
```

### Run Speech-to-Text (STT) with Vosk

Test STT with the audio generated from the microphone test:

```bash
make run-vosk
```

### Test Wake Word Detection

```bash
make run-wakeword
```

### Test LLM with Llama

```bash
make run-llama
```

## 🖥️ Development CLI

### Run Development CLI

```bash
npm run dev-cli
```

### Interactive Shell

For an interactive shell experience:

```bash
npm run dev-cli interactive
```

## 🔐 MQTT Mosquitto Setup

Create the password file using the default credentials (username: `domia`, password: `domia`). You can change these if needed:

```bash
make mosquitto-password
```

> **Note:** If you don't have `mosquitto_passwd` installed locally, you can use Docker:
>
> ```bash
> mkdir -p config/mqtt
> docker run --rm -v "$PWD/config/mqtt:/data" eclipse-mosquitto mosquitto_passwd -c /data/password.txt domia
> ```

## 🧩 Optional Engines

DOMIA's voice pipeline ships with sensible defaults (Vosk for STT, Piper for TTS). Alternative engines are opt-in:

### Whisper STT (more accurate transcription)

```bash
make download-whisper-model   # ~466 MB, one-time download
```

Then switch the active STT engine to `WHISPER` in your `stt_config` (model name `small.en`).

### Kokoro TTS (more expressive voice)

Kokoro requires `espeak-ng` as a system dependency:

```bash
make install-deps-kokoro
```

Models are auto-downloaded by the `kokoro` Python package on first use. Switch the active TTS engine to `KOKORO` in your `tts_config` (e.g., voice `af_heart`).

### Try engines via dev CLI without changing config

```bash
npm run dev-cli -- tts --engine KOKORO --voice af_heart --text "Hello from Kokoro"
npm run dev-cli -- stt --engine WHISPER --model small.en --file tmp/mic_test_output.wav
```

## 🎯 Next Steps

After completing the setup, you can:

1. Start the main application
2. Configure additional models
3. Set up custom wake words
4. Integrate with external services

## 🆘 Troubleshooting

If you encounter issues:

1. Run `make doctor` to verify your setup
2. Check the logs for specific error messages
3. Ensure all prerequisites are properly installed
4. Verify Docker is running (if using containerized components)

---

For more detailed information, check the [main README.md](README.md) and individual module documentation.
