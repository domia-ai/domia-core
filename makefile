PYTHON := .venv/bin/python3
PIP := .venv/bin/pip
REQUIREMENTS := src/resources/python/requirements.txt

##@ Help
help: ##🆘 Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[.a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Core
core: ##🧠 Run core project locally
	@echo "🚀 Starting core service..."
	@docker compose up --build -d core

ollama: ##🧠 Run ollama project locally
	@echo "🚀 Starting ollama service..."
	@docker compose up --build -d ollama

##@ Models
install-phi: ##📦 Install the phi3:mini model locally inside the ollama container
	@echo "🔍 Installing Phi-3 mini model in Ollama container..."
	@docker compose exec ollama ollama pull phi3:mini
	@echo "✅ Phi-3 mini model installed successfully."

run-phi: ##💬 Start interactive shell with Phi model inside the ollama container
	@docker compose exec ollama ollama run phi3:mini

##@ Lifecycle
up: ##📈 Up the project locally
	@echo "🟢 Bringing up all containers..."
	@docker compose up -d

stop: ##⏸️ Stops the project locally
	@echo "🛑 Stopping all containers..."
	@docker compose stop

down: ##📉 Down the project and remove volumes
	@echo "🧹 Shutting down and cleaning up..."
	@docker compose down -v

##@ Python Setup
venv: ##🐍 Create fresh virtual environment and install Python dependencies
	@echo "🔁 Step 1/3: Creating virtual environment if needed..."
	@if [ ! -f $(PYTHON) ]; then \
		python3 -m venv .venv; \
	fi
	@echo "📦 Step 2/3: Upgrading pip..."
	@$(PYTHON) -m pip install --upgrade pip
	@echo "📦 Step 3/3: Installing dependencies..."
	@$(PYTHON) -m pip install -r $(REQUIREMENTS)

install-py: ##📦 Install Python dependencies into existing virtual environment
	@echo "📦 Installing Python dependencies into existing .venv..."
	@$(PYTHON) -m pip install -r $(REQUIREMENTS)

##@ Debugging
run-wakeword: ##🎧 Run the wakeword detection script (Python)
	@echo "🎧 Running wakeword detector with 'domia' model..."
	@$(PYTHON) src/resources/python/open-wake-word/runner.py --model domia --debug

list-devices: ##🎛️ List available audio input/output devices
	@echo "🎛️ Listing available audio devices..."
	@$(PYTHON) src/resources/python/open-wake-word/list_devices.py

mic-test: ##🎙️ Record a short audio sample to test microphone input and RMS level
	@echo "🎙️ Starting microphone test recording..."
	@$(PYTHON) src/resources/python/open-wake-word/mic_test.py

run-vosk: ##🗣️ Run the Vosk STT runner with a sample audio file
	@echo "🗣️ Running Vosk transcription with test.wav..."
	@$(PYTHON) src/resources/python/vosk/runner.py \
		--file tmp/recordings/test.wav \
		--model src/resources/stt-models/vosk/vosk-model-small-en-us-0.15 \
		--timeout 5

##@ System Dependencies
install-deps: ##🔧 Install required system binaries (sox)
	@echo "🔧 Installing required system dependency: sox..."
	@unameOut=$$(uname -s); \
	case $$unameOut in \
		Linux*) \
			sudo apt-get update && sudo apt-get install -y sox ;; \
		Darwin*) \
			command -v brew >/dev/null 2>&1 || { echo "❌ Homebrew not found. Install from https://brew.sh"; exit 1; }; \
			brew install sox ;; \
		*) \
			echo "❌ Unsupported OS. Please install 'sox' manually."; exit 1 ;; \
	esac
	@echo "✅ Binary installation complete."

##@ Diagnostics
doctor-py: ##🩺 Check if Python, virtualenv, and required modules are correctly set up
	@echo "🩺 Running Python environment check..."
	@command -v python3 >/dev/null 2>&1 && echo "✅ python3 found" || { echo "❌ python3 not found"; exit 1; }
	@test -d .venv && echo "✅ .venv folder exists" || { echo "❌ .venv folder not found. Run: make venv"; exit 1; }
	@$(PYTHON) -c "import sounddevice, numpy, openwakeword, vosk" && \
	echo "✅ All required Python modules are installed" || \
	{ echo "❌ Some Python modules are missing. Run: make install-py"; exit 1; }

doctor-binaries: ##🩺 Check required system binaries (sox)
	@echo "🧪 Checking system-level binaries..."
	@command -v sox >/dev/null 2>&1 && echo "✅ sox found" || { echo "❌ sox not found. Run: make install-deps"; exit 1; }
	@echo "🎯 System binary check complete."

doctor: ##🩺 Run all environment checks (binaries, Python, .env)
	@echo "🩺 Running full Domia system check..."
	@$(MAKE) doctor-binaries
	@$(MAKE) doctor-py
	@echo "✅ All system checks passed!"
