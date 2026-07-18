##@ Help
help: ##🆘 Display this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n"} /^[.a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 } /^##@/ { printf "\n\033[1m%s\033[0m\n", substr($$0, 5) } ' $(MAKEFILE_LIST)

##@ Core
core: ##🧠 Run core project locally
	@echo "🚀 Starting core service..."
	@docker compose up --build -d core

ollama: ##🧠 Run ollama service locally
	@echo "🚀 Starting ollama service..."
	@docker compose up --build -d ollama

mosquitto: ##📡 Start the Mosquitto MQTT broker
	@echo "📡 Starting Mosquitto broker..."
	@mkdir -p data/mqtt log/mqtt
	@docker run --rm -v "$$(pwd)/data/mqtt:/mosquitto/data" -v "$$(pwd)/log/mqtt:/mosquitto/log" \
		eclipse-mosquitto chown -R mosquitto:mosquitto /mosquitto/data /mosquitto/log
	@docker compose up -d mosquitto

##@ Models
install-llama: ##📦 Install the llama3.1:8b model inside the ollama container
	@echo "🔍 Installing llama3.1:8b model in Ollama container..."
	@docker compose exec ollama ollama pull llama3.1:8b
	@echo "✅ llama3.1:8b installed."

run-llama: ##💬 Start interactive shell with the llama3.1:8b model inside the ollama container
	@docker compose exec ollama ollama run llama3.1:8b

setup-models: ##📥 Download local STT/TTS/KWS/VAD models (sherpa-onnx)
	@npm run setup:models

##@ MQTT
mosquitto-logs: ##📜 Show Mosquitto logs
	@docker compose logs -f mosquitto

mosquitto-down: ##🧹 Stop and remove Mosquitto container and data
	@echo "🧹 Stopping and cleaning Mosquitto..."
	@docker compose stop mosquitto
	@docker compose rm -f mosquitto
	@rm -rf ./data/mqtt ./log/mqtt

mosquitto-password: ##🔐 Generate password.txt with user 'domia' (Docker)
	@echo "🔐 Generating password.txt for user 'domia' using Docker..."
	@docker run --rm -v "$$(pwd)/config/mqtt:/mosquitto/config" eclipse-mosquitto sh -c \
		"rm -f /mosquitto/config/password.txt \
		&& mosquitto_passwd -b -c /mosquitto/config/password.txt domia domia \
		&& chown mosquitto:mosquitto /mosquitto/config/password.txt"

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
doctor: ##🩺 Check required system binaries (sox, node, docker compose)
	@echo "🧪 Checking system-level binaries..."
	@command -v sox >/dev/null 2>&1 && echo "✅ sox found" || { echo "❌ sox not found. Run: make install-deps"; exit 1; }
	@command -v node >/dev/null 2>&1 && echo "✅ node found ($$(node --version))" || { echo "❌ node not found"; exit 1; }
	@command -v docker >/dev/null 2>&1 && echo "✅ docker found" || { echo "❌ docker not found"; exit 1; }
	@docker compose version >/dev/null 2>&1 && echo "✅ docker compose found ($$(docker compose version --short))" || { echo "❌ docker compose (v2) not found. Docker Desktop bundles it; on Linux: sudo apt install docker-compose-v2"; exit 1; }
	@echo "🎯 System checks passed."

##@ Dev
dev: ##🧪 Start development environment (Ollama + Mosquitto)
	@echo "🧪 Starting dev environment with Ollama and Mosquitto..."
	@$(MAKE) ollama
	@$(MAKE) mosquitto

##@ LiveKit
livekit-install: ##📦 Install the livekit-server binary (only if you use the feature)
	@unameOut=$$(uname -s); \
	case $$unameOut in \
		Darwin*) \
			brew install livekit ;; \
		Linux*) \
			curl -sSL https://get.livekit.io | bash ;; \
		*) \
			echo "❌ Install livekit-server manually"; exit 1 ;; \
	esac

livekit-native: ##🛰️ Run LiveKit natively from the declared config (any OS)
	@command -v livekit-server >/dev/null 2>&1 || { echo "❌ run: make livekit-install"; exit 1; }
	@livekit-server --config config/livekit/livekit.yaml

livekit-docker: ##🛰️ Run LiveKit in a container (host-net ideal on Linux)
	@docker compose --profile lab up -d livekit

livekit-logs: ##📜 LiveKit container logs
	@docker compose logs -f livekit

livekit-down: ##🧹 Stop & remove the LiveKit container
	@docker compose stop livekit && docker compose rm -f livekit

##@ Bootstrap (native)
setup: ##🚀 From-zero: system deps, models, db and build (any OS)
	@$(MAKE) install-deps
	@npm ci
	@npm run setup:models
	@[ -f .env ] || cp .env.example .env
	@npm run db:reset
	@npm run build
	@echo "✅ setup complete — start with: make run"

run: ##🏁 Run the compiled node (loads .env)
	@npm start

DOMIA_ENV ?= .env

domia-service: ##🛡️ Install domia as a systemd service (Linux, needs sudo)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make run"; exit 1; }
	@[ -f build/index.js ] || { echo "❌ no build found — run: make setup"; exit 1; }
	@printf '[Unit]\nDescription=Domia core\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=%s\nWorkingDirectory=%s\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\nExecStart=%s/node_modules/.bin/dotenvx run -f %s -- node build/index.js\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
		"$$(id -un)" "$(abspath .)" "$$(dirname $$(command -v node))" "$(abspath .)" "$(DOMIA_ENV)" > /tmp/domia.service
	@sudo cp /tmp/domia.service /etc/systemd/system/domia.service
	@sudo systemctl daemon-reload && sudo systemctl enable --now domia
	@echo "✅ domia service installed (env: $(DOMIA_ENV)). Logs: journalctl -fu domia"

install-ollama: ##🧠 Install Ollama natively + pull default models (Linux/Jetson; GPU auto)
	@command -v ollama >/dev/null 2>&1 || curl -fsSL https://ollama.com/install.sh | sh
	@ollama pull llama3.2:3b && ollama pull llama3.2:1b
	@echo "✅ ollama ready (llama3.2:3b + reflection 1b)"

##@ LLM serving (llama.cpp — any OS; alternative to Ollama, llm.baseUrl :11435/v1)
LLM_SRC_DIR ?= $(HOME)/src
LLAMA_CPP_DIR ?= $(LLM_SRC_DIR)/llama.cpp
LLAMA_SERVER_BIN = $(LLAMA_CPP_DIR)/build/bin/llama-server
LLM_GGUF_DIR = data/models/gguf
LLM_GGUF ?= $(LLM_GGUF_DIR)/llama-3.2-3b-instruct-q4_k_m.gguf
LLM_GGUF_HF_URL ?= https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
LLM_PORT ?= 11435
LLM_CTX ?= 4096
LLM_EXTRA_FLAGS ?=
LLM_BUILD_JOBS ?= 3

llama-cpp: ##🏗️ Build llama.cpp (llama-server) — Metal/CUDA/CPU auto-detected. FORCE=1 to rebuild
	@if [ -x "$(LLAMA_SERVER_BIN)" ] && [ -z "$(FORCE)" ]; then \
		echo "✅ llama-server already built: $(LLAMA_SERVER_BIN) (FORCE=1 to rebuild)"; exit 0; fi
	@mkdir -p $(LLM_SRC_DIR)
	@[ -d "$(LLAMA_CPP_DIR)/.git" ] || git clone --depth 1 https://github.com/ggml-org/llama.cpp "$(LLAMA_CPP_DIR)"
	@if [ -n "$(FORCE)" ]; then \
		echo "🔄 updating llama.cpp to latest"; \
		git -C "$(LLAMA_CPP_DIR)" fetch --depth 1 origin && \
		git -C "$(LLAMA_CPP_DIR)" reset --hard FETCH_HEAD; fi
	@cd "$(LLAMA_CPP_DIR)" && \
	if [ "$$(uname -s)" = "Darwin" ]; then \
		echo "🍎 macOS detected — building with Metal"; \
		cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF; \
	elif [ -x /usr/local/cuda/bin/nvcc ]; then \
		echo "🟩 NVIDIA CUDA detected — building with GGML_CUDA"; \
		PATH=/usr/local/cuda/bin:$$PATH cmake -B build \
			-DGGML_CUDA=ON \
			-DCMAKE_CUDA_ARCHITECTURES=native \
			-DCMAKE_CUDA_COMPILER=/usr/local/cuda/bin/nvcc \
			-DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF; \
	else \
		echo "🧮 no GPU toolchain found — building CPU-only"; \
		cmake -B build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF; \
	fi && cmake --build build --target llama-server -j $(LLM_BUILD_JOBS)
	@echo "✅ built: $(LLAMA_SERVER_BIN)"

llm-gguf: ##📥 Stage the 3B GGUF (reuses an Ollama blob when present, else downloads)
	@mkdir -p $(LLM_GGUF_DIR)
	@if [ -f "$(LLM_GGUF)" ]; then echo "✅ GGUF already staged: $(LLM_GGUF)"; exit 0; fi
	@blob=$$(python3 -c "import json,glob,os; \
		roots=['/usr/share/ollama/.ollama/models', os.path.expanduser('~/.ollama/models')]; \
		p=[m for r in roots for m in glob.glob(r+'/manifests/**/llama3.2/3b',recursive=True)]; \
		m=json.load(open(p[0])) if p else None; \
		root=p[0].split('/manifests/')[0] if p else ''; \
		print(next((root+'/blobs/'+l['digest'].replace(':','-') \
			for l in (m['layers'] if m else []) if l['mediaType'].endswith('.model')),''))" 2>/dev/null); \
	if [ -n "$$blob" ] && [ -f "$$blob" ]; then \
		echo "📦 Reusing Ollama blob ($$blob)"; cp "$$blob" "$(LLM_GGUF)"; \
	else \
		echo "🌐 Downloading GGUF from Hugging Face..."; \
		curl -fL --progress-bar "$(LLM_GGUF_HF_URL)" -o "$(LLM_GGUF)"; fi
	@echo "✅ GGUF ready: $(LLM_GGUF)"

llm-server: ##🚀 Run llama-server in the foreground on :$(LLM_PORT) (dev/bench, any OS)
	@$(MAKE) llama-cpp llm-gguf
	@echo "🚀 llama-server on http://0.0.0.0:$(LLM_PORT)/v1 — point llm.baseUrl there"
	@"$(LLAMA_SERVER_BIN)" -m "$(LLM_GGUF)" \
		--host 0.0.0.0 --port $(LLM_PORT) \
		-ngl 99 -c $(LLM_CTX) --no-warmup $(LLM_EXTRA_FLAGS)

llm-service: ##🔁 Install llama-server as a systemd service (Linux, needs sudo)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make llm-server"; exit 1; }
	@$(MAKE) llama-cpp llm-gguf
	@printf '[Unit]\nDescription=llama.cpp server (Domia LLM)\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=%s\nExecStart=%s -m %s --host 0.0.0.0 --port %s -ngl 99 -c %s %s\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
		"$$(id -un)" "$(LLAMA_SERVER_BIN)" "$(abspath $(LLM_GGUF))" "$(LLM_PORT)" "$(LLM_CTX)" "$(LLM_EXTRA_FLAGS)" > /tmp/llama-server.service
	@sudo cp /tmp/llama-server.service /etc/systemd/system/llama-server.service
	@sudo systemctl daemon-reload && sudo systemctl enable --now llama-server
	@echo "✅ llama-server service installed (port $(LLM_PORT)). Logs: journalctl -fu llama-server"

##@ Jetson (Orin-class hub — see docs/JETSON.md and templates/jetson.json)

jetson-doctor: ##🔬 Verify Jetson prerequisites (CUDA toolkit, power mode, memory, swap)
	@echo "🔬 Checking Jetson prerequisites..."
	@[ -x /usr/local/cuda/bin/nvcc ] && echo "✅ CUDA toolkit ($$(/usr/local/cuda/bin/nvcc --version | grep -oE 'release [0-9.]+'))" || { echo "❌ CUDA toolkit missing (needed to compile llama.cpp). Run: sudo apt install -y nvidia-jetpack"; exit 1; }
	@command -v cmake >/dev/null 2>&1 && echo "✅ cmake found" || { echo "❌ cmake not found. Run: sudo apt install -y cmake"; exit 1; }
	@command -v git >/dev/null 2>&1 && echo "✅ git found" || { echo "❌ git not found"; exit 1; }
	@mode=$$(nvpmodel -q 2>/dev/null | head -1 | cut -d: -f2 | xargs); \
	if [ "$$mode" = "MAXN_SUPER" ] || [ "$$mode" = "MAXN" ]; then echo "✅ power mode: $$mode"; \
	else echo "⚠️ power mode: $${mode:-unknown} — for best LLM speed run: sudo nvpmodel -m 2 (MAXN_SUPER)"; fi
	@avail=$$(awk '/MemAvailable/{print int($$2/1024)}' /proc/meminfo); \
	if [ "$$avail" -ge 1024 ]; then echo "✅ memory available: $${avail}MB"; \
	else echo "⚠️ only $${avail}MB available — close heavy processes before building/serving"; fi
	@if swapon --show 2>/dev/null | grep -q .; then echo "✅ swap active"; \
	else echo "⚠️ no swap — recommended on 8GB (memory spikes can OOM-kill services):"; \
		echo "   sudo fallocate -l 8G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"; fi
	@echo "🎯 Jetson checks passed."

jetson-setup: ##🚀 Full Jetson LLM stack: doctor → build llama.cpp (CUDA) → model → systemd service
	@$(MAKE) jetson-doctor
	@$(MAKE) llm-service
	@echo ""
	@echo "✅ Jetson LLM stack ready (llama-server on :$(LLM_PORT))."
	@echo "   Next: download the local models the template needs (STT/TTS/VAD + smart-turn):"
	@echo "         npm run setup:models:jetson"
	@echo "   Then apply the Jetson role to your Domia:  npm run dev-cli -- config import templates/jetson.json"
