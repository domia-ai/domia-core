# 🗣️ OpenWakeWord Runner for DOMIA

This module provides a Python-based runner script (`openwakeword_runner.py`) that uses [OpenWakeWord](https://github.com/dscripka/openWakeWord) to listen for wake word activations via microphone input. It integrates with Node.js and the DOMIA Core system to trigger `wakeword_detected` events.

## 📦 Features

- 🎧 Real-time microphone capture
- 🧠 Wake word detection with pre-trained or custom models
- 🔁 Communication with Node.js via `stdout`
- ⚠️ Emits detailed error messages for easy debugging

## 🧰 Requirements

- Python 3.8+
- Microphone access
- `portaudio` and `ffmpeg` libraries installed
- Compatible with Linux, macOS, and Windows (limited)

## 💻 Installation

### Linux (Ubuntu, Debian, Raspberry Pi OS)

```bash
sudo apt-get update
sudo apt-get install -y python3-dev portaudio19-dev libportaudio2 libportaudiocpp0 ffmpeg

python3 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install openwakeword sounddevice numpy
```

### macOS

```bash
brew install portaudio ffmpeg

python3 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip
pip install openwakeword sounddevice numpy
```

### Windows (experimental)

```bash
python -m venv .venv
.venv\Scripts\activate

pip install --upgrade pip
pip install openwakeword sounddevice numpy
```

> ⚠️ WSL is not recommended due to limited microphone access.

## 🚀 Running the Script

Use a pre-trained model to start detecting wakewords:

```bash
python scripts/openwakeword_runner.py --model marvin --sensitivity 0.5 --threshold 0.5
```

## ✅ Available Pre-trained Models

- `marvin`
- `alexa`
- `ok_nomis`
- `blueberry`
- `bumblebee`

These models are automatically downloaded and cached in `~/.cache/openwakeword`.

## 🧩 Node.js Integration Example

```ts
import { spawn } from "child_process"

const python = spawn("python3", [
	"scripts/openwakeword_runner.py",
	"--model",
	"marvin",
	"--sensitivity",
	"0.5",
	"--threshold",
	"0.5",
])

python.stdout.on("data", (data) => {
	const message = data.toString().trim()
	if (message === "wakeword_detected") {
		console.log("🔥 Wake word detected!")
	} else if (message.startsWith("error:")) {
		console.error("Error from Python:", message)
	} else {
		console.log("[wakeword]", message)
	}
})

python.stderr.on("data", (data) => {
	console.error("[wakeword:stderr]", data.toString())
})
```

## 🧪 Troubleshooting

### `ModuleNotFoundError: No module named 'sounddevice'`

Install it using:

```bash
pip install sounddevice
```

### Microphone not working on Linux

Ensure your user is part of the `audio` group:

```bash
groups $USER
```

And test with:

```bash
arecord -l
```

## 📁 File Structure Example

```
domia-core/
├── scripts/
│   └── openwakeword_runner.py
├── src/
│   └── runOpenWakeWord.ts
└── README.md
```

---

Made with ❤️ for [DOMIA](https://www.domia.ai/)
