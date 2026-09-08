.PHONY: help core ollama mosquitto install-llama run-llama setup-models \
	mosquitto-logs mosquitto-down mosquitto-user mosquitto-acl mosquitto-acl-off \
	up stop down install-deps services doctor posture dev \
	livekit-install livekit-native livekit-docker livekit-logs livekit-down \
	setup run dev-certs package domia-service install-services install-ollama \
	llama-cpp llama-cpp-build llm-gguf llm-server nemo-speech nemo-serve nemo-service \
	llm-service asr-server asr-service jetson-doctor jetson-setup

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
	@chmod 755 config/mqtt config/mqtt/conf.d 2>/dev/null; chmod 644 config/mqtt/mosquitto.conf; [ -f config/mqtt/password.txt ] && chmod 644 config/mqtt/password.txt || true
	@docker compose up -d mosquitto
	@sleep 3; docker inspect -f '{{.State.Status}}' domia-mqtt 2>/dev/null | grep -q running && echo "✅ broker running on :1883" || { echo "❌ broker not running — docker logs domia-mqtt"; docker logs domia-mqtt 2>&1 | tail -5; exit 1; }

##@ Models
OLLAMA_MODEL ?= llama3.2:3b

install-llama: ##📦 Pull the templates' default model ($(OLLAMA_MODEL)) inside the ollama container
	@echo "🔍 Pulling $(OLLAMA_MODEL) in the Ollama container..."
	@docker compose exec ollama ollama pull $(OLLAMA_MODEL)
	@echo "✅ $(OLLAMA_MODEL) installed."

run-llama: ##💬 Start an interactive shell with $(OLLAMA_MODEL) inside the ollama container
	@docker compose exec ollama ollama run $(OLLAMA_MODEL)

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

MQTT_USER ?=
MQTT_PASS ?=

mosquitto-user: ##🔐 Add/replace one broker user (per node): make mosquitto-user MQTT_USER=node-a MQTT_PASS=...
	@[ -n "$(MQTT_USER)" ] && [ -n "$(MQTT_PASS)" ] || { echo "❌ usage: make mosquitto-user MQTT_USER=<name> MQTT_PASS=<password>"; exit 1; }
	@docker run --rm -v "$$(pwd)/config/mqtt:/mosquitto/config" eclipse-mosquitto sh -c \
		"touch /mosquitto/config/password.txt \
		&& mosquitto_passwd -b /mosquitto/config/password.txt '$(MQTT_USER)' '$(MQTT_PASS)' \
		&& chown mosquitto:mosquitto /mosquitto/config/password.txt"
	@echo "✅ broker user '$(MQTT_USER)' set — put it in that node's mqtt_config (username/password) and in config/mqtt/acl.txt"

mosquitto-acl: ##🛡️ Opt in to per-node topic ACLs: seed config/mqtt/acl.txt from acl.example and enable acl_file
	@[ -f config/mqtt/acl.txt ] && echo "✅ config/mqtt/acl.txt exists (edit it: one 'user' block per node)" \
		|| { cp config/mqtt/acl.example config/mqtt/acl.txt; echo "📝 seeded config/mqtt/acl.txt from acl.example — edit the user blocks (node usernames, identity keys, nodeIds)"; }
	@mkdir -p config/mqtt/conf.d
	@printf 'acl_file /mosquitto/config/acl.txt\n' > config/mqtt/conf.d/acl.conf
	@grep -q "include_dir /mosquitto/config/conf.d" config/mqtt/mosquitto.conf \
		|| printf '\ninclude_dir /mosquitto/config/conf.d\n' >> config/mqtt/mosquitto.conf
	@echo "✅ ACLs enabled (conf.d/acl.conf + include_dir in mosquitto.conf)"
	@docker run --rm -v "$$(pwd)/config/mqtt:/mosquitto/config:ro" eclipse-mosquitto \
		mosquitto -c /mosquitto/config/mosquitto.conf --test-config >/dev/null 2>&1 \
		&& echo "✅ broker config + ACL parse OK" || echo "⚠️ broker config test failed — run: docker run --rm -v \$$(pwd)/config/mqtt:/mosquitto/config:ro eclipse-mosquitto mosquitto -c /mosquitto/config/mosquitto.conf --test-config"
	@docker compose ps --status running mosquitto 2>/dev/null | grep -q mosquitto \
		&& { docker compose restart mosquitto >/dev/null && echo "🔄 mosquitto restarted with ACLs"; } \
		|| echo "ℹ️  broker not running — ACLs apply on next: make mosquitto"

mosquitto-acl-off: ##🧹 Disable the ACL file (keeps acl.txt for later)
	@rm -f config/mqtt/conf.d/acl.conf
	@sed -i.bak '/include_dir \/mosquitto\/config\/conf.d/d' config/mqtt/mosquitto.conf && rm -f config/mqtt/mosquitto.conf.bak
	@echo "✅ ACLs disabled (conf.d/acl.conf + include_dir removed; restart the broker to apply)"

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
			command -v apt-get >/dev/null 2>&1 || { echo "❌ apt-get not found — install 'sox' with your distro's package manager (e.g. dnf/pacman/zypper install sox)"; exit 1; }; \
			sudo apt-get update && sudo apt-get install -y sox ;; \
		Darwin*) \
			command -v brew >/dev/null 2>&1 || { echo "❌ Homebrew not found. Install from https://brew.sh"; exit 1; }; \
			brew install sox ;; \
		*) \
			echo "❌ Unsupported OS. Please install 'sox' manually."; exit 1 ;; \
	esac
	@echo "✅ Binary installation complete."

##@ Diagnostics
services: ##🩺 Show which runtime services answer (MQTT broker, llama-server, nemo-speech) and how to start the missing ones
	@echo "🩺 Runtime services:"
	@(command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 1883 >/dev/null 2>&1) && echo "✅ MQTT broker on :1883" || echo "ℹ️  no MQTT broker on 127.0.0.1:1883 (fine if your nodes point at a broker elsewhere; local one: make mosquitto)"
	@curl -sf -m 2 http://127.0.0.1:$(LLM_PORT)/health >/dev/null 2>&1 && echo "✅ llama-server on :$(LLM_PORT)" || echo "❌ llama-server not answering on :$(LLM_PORT) → make llm-service   (or docker compose up -d ollama && switch llm.engine to OLLAMA)"
	@curl -sf -m 2 http://127.0.0.1:$(NEMO_PORT)/v1/models >/dev/null 2>&1 && echo "✅ nemo-speech on :$(NEMO_PORT)" || echo "ℹ️  nemo-speech not answering on :$(NEMO_PORT) (only needed for the NEMO_SPEECH STT engine) → make nemo-service"
	@[ "$$(uname -s)" = "Linux" ] && command -v systemctl >/dev/null 2>&1 && { echo "🔁 Survives a reboot (systemd enabled):"; for u in domia llama-server; do st=$$(systemctl is-enabled $$u 2>/dev/null); [ -n "$$st" ] || st="not-installed"; printf "   %-13s %s\n" $$u "$$st"; done; st=$$(systemctl --user is-enabled nemo-speech 2>/dev/null); [ -n "$$st" ] || st="not-installed"; printf "   %-13s %s (user unit, linger=%s)\n" nemo-speech "$$st" "$$(loginctl show-user $$(id -un) -p Linger --value 2>/dev/null)"; echo "   (missing/disabled → make install-services)"; } || true

doctor: ##🩺 Check required system binaries (sox, node, docker compose)
	@echo "🧪 Checking system-level binaries..."
	@command -v sox >/dev/null 2>&1 && echo "✅ sox found" || { echo "❌ sox not found. Run: make install-deps"; exit 1; }
	@command -v node >/dev/null 2>&1 && echo "✅ node found ($$(node --version))" || { echo "❌ node not found"; exit 1; }
	@command -v docker >/dev/null 2>&1 && echo "✅ docker found" || echo "ℹ️  docker not found (optional — only for the container path: make up / ollama / mosquitto)"
	@docker compose version >/dev/null 2>&1 && echo "✅ docker compose found ($$(docker compose version --short))" || echo "ℹ️  docker compose (v2) not found (optional — Docker Desktop bundles it; on Linux: sudo apt install docker-compose-v2)"
	@$(MAKE) --no-print-directory posture
	@echo "🎯 System checks passed."

posture: ##🔒 Report the security/ops posture of $(DOMIA_ENV): TLS, mesh secret + rotation, MQTT ACLs, OpenTelemetry
	@echo "🔒 Posture ($(DOMIA_ENV)):"
	@[ -f "$(DOMIA_ENV)" ] || { echo "ℹ️  $(DOMIA_ENV) not found — cp .env.example .env"; exit 0; }; \
	v() { grep -E "^$$1=" "$(DOMIA_ENV)" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"'"' ; }; \
	cert=$$(v DOMIA_TLS_CERT_FILE); key=$$(v DOMIA_TLS_KEY_FILE); ca=$$(v DOMIA_TLS_CA_FILE); \
	if [ -n "$$cert" ] && [ -n "$$key" ]; then \
		if [ -r "$$cert" ] && [ -r "$$key" ]; then \
			exp=$$(openssl x509 -enddate -noout -in "$$cert" 2>/dev/null | cut -d= -f2); \
			echo "✅ TLS on: HTTPS + gRPC TLS (cert $$cert, expires $${exp:-?}; CA $${ca:-system trust})"; \
			[ -n "$$ca" ] && [ ! -r "$$ca" ] && echo "⚠️ DOMIA_TLS_CA_FILE=$$ca is not readable"; \
			[ "$$(v DOMIA_TLS_REQUIRE_CLIENT_CERT)" = "1" ] && echo "✅ mTLS: peers must present a client cert" || echo "ℹ️  client certs not required (DOMIA_TLS_REQUIRE_CLIENT_CERT=1 to enforce)"; \
		else echo "❌ TLS configured but cert/key unreadable ($$cert / $$key) — the node will refuse to boot"; fi; \
	else echo "ℹ️  TLS off — plaintext HTTP + gRPC on the LAN (make dev-certs, then set DOMIA_TLS_* in $(DOMIA_ENV))"; fi; \
	secret=$$(v DOMIA_MESH_SECRET); next=$$(v DOMIA_MESH_SECRET_NEXT); \
	case "$$secret" in ""|*change-me*) echo "⚠️ DOMIA_MESH_SECRET is unset or the example default — set a long random secret on every node" ;; \
		*) [ $${#secret} -ge 32 ] && echo "✅ mesh secret set ($${#secret} chars)" || echo "⚠️ mesh secret is short ($${#secret} chars) — 32+ recommended" ;; esac; \
	[ -n "$$next" ] && echo "🔄 mesh secret rotation in progress (DOMIA_MESH_SECRET_NEXT set) — POST /mesh/rotate shows the grace window" || true; \
	if grep -rqs '^acl_file ' config/mqtt/conf.d config/mqtt/mosquitto.conf 2>/dev/null; then echo "✅ MQTT ACLs enabled (config/mqtt/acl.txt)"; \
	else echo "ℹ️  MQTT ACLs off — every broker user may publish any topic (make mosquitto-acl to opt in)"; fi; \
	grep -q '^allow_anonymous false' config/mqtt/mosquitto.conf 2>/dev/null && echo "✅ MQTT anonymous access disabled" || echo "⚠️ MQTT allows anonymous clients"; \
	otel=$$(v DOMIA_OTEL_EXPORTER_URL); \
	[ -n "$$otel" ] && echo "✅ OpenTelemetry traces → $$otel" || echo "ℹ️  OpenTelemetry off (DOMIA_OTEL_EXPORTER_URL unset — nothing loaded)"

##@ Dev
dev: ##🧪 Start the dev environment (Mosquitto) and show which services still need starting
	@echo "🧪 Starting dev environment (Mosquitto)..."
	@$(MAKE) mosquitto
	@$(MAKE) services

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
	@$(MAKE) services
	@echo "✅ setup complete — start with: make run (then apply a template: npm run dev-cli -- config import templates/full-hub.json)"

run: ##🏁 Run the compiled node (loads .env)
	@npm start

CERT_NODE ?= domia
CERT_DIR ?= data/certs
CERT_SANS ?=

dev-certs: ##🔐 Self-signed dev CA + node cert for HTTPS/gRPC TLS (openssl; any OS). CERT_NODE=<name> CERT_SANS="IP:10.0.0.5 DNS:hub.lan"
	@bash scripts/gen-dev-certs.sh "$(CERT_NODE)" "$(CERT_DIR)" $(CERT_SANS)

package: ##📦 Build a deployable tarball (build/ + templates + scripts + MANIFEST.json) into dist/
	@bash scripts/package.sh

DOMIA_ENV ?= .env

install-services: ##🔁 Reboot-safe Linux hub in one go: llama-server + domia (system units, sudo) + nemo-speech (user unit + linger, no sudo). LLM_CACHE_RAM_MB=0 recommended on 8GB boxes
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ Linux-only (macOS: make llm-service + make nemo-serve + make run)"; exit 1; }
	@$(MAKE) llm-service
	@$(MAKE) nemo-service
	@$(MAKE) domia-service
	@$(MAKE) --no-print-directory services
	@echo "✅ hub survives reboots — verify after one with: make services"

domia-service: ##🛡️ Install domia as a systemd service (Linux, needs sudo)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make run"; exit 1; }
	@[ -f build/index.js ] || { echo "❌ no build found — run: make setup"; exit 1; }
	@printf '[Unit]\nDescription=Domia core\nAfter=network-online.target llama-server.service nemo-speech.service\n\n[Service]\nType=simple\nUser=%s\nWorkingDirectory=%s\nEnvironment=PATH=%s:/usr/local/bin:/usr/bin:/bin\nExecStart=%s/node_modules/.bin/dotenvx run -f %s -- node build/index.js\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
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
LLM_OLLAMA_TAG ?= llama3.2/3b
LLM_GGUF_HF_URL ?= https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf
LLM_PORT ?= 11435
LLM_CTX ?= 4096
LLM_EXTRA_FLAGS ?=
LLM_CHAT_TEMPLATE ?=
LLM_CHAT_TEMPLATE_ABS = $(if $(LLM_CHAT_TEMPLATE),$(abspath $(LLM_CHAT_TEMPLATE)),)
LLM_LAUNCHER = $(abspath scripts/llm-server.sh)
LLM_BUILD_JOBS ?= 3

llama-cpp: ##🏗️ Build llama.cpp (llama-server) — Metal/CUDA/CPU auto-detected. FORCE=1 to rebuild
	@if [ -x "$(LLAMA_SERVER_BIN)" ] && [ -z "$(FORCE)" ]; then \
		echo "✅ llama-server already built: $(LLAMA_SERVER_BIN) (FORCE=1 to rebuild)"; \
	else $(MAKE) llama-cpp-build FORCE=$(FORCE); fi

llama-cpp-build:
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
		p=[m for r in roots for m in glob.glob(r+'/manifests/**/$(LLM_OLLAMA_TAG)',recursive=True)]; \
		m=json.load(open(p[0])) if p else None; \
		root=p[0].split('/manifests/')[0] if p else ''; \
		print(next((root+'/blobs/'+l['digest'].replace(':','-') \
			for l in (m['layers'] if m else []) if l['mediaType'].endswith('.model')),''))" 2>/dev/null); \
	if [ -n "$$blob" ] && [ -f "$$blob" ]; then \
		echo "📦 Reusing Ollama blob ($$blob)"; cp "$$blob" "$(LLM_GGUF)"; \
	else \
		echo "🌐 Downloading GGUF from Hugging Face..."; \
		curl -fL --retry 3 -C - --progress-bar "$(LLM_GGUF_HF_URL)" -o "$(LLM_GGUF).part" && mv "$(LLM_GGUF).part" "$(LLM_GGUF)"; fi
	@echo "✅ GGUF ready: $(LLM_GGUF)"

llm-server: ##🚀 Run llama-server in the foreground on :$(LLM_PORT) (dev/bench, any OS)
	@$(MAKE) llama-cpp llm-gguf
	@echo "🚀 llama-server on http://0.0.0.0:$(LLM_PORT)/v1 — point llm.baseUrl there"
	@LLAMA_SERVER_BIN="$(LLAMA_SERVER_BIN)" LLM_GGUF="$(abspath $(LLM_GGUF))" LLM_PORT="$(LLM_PORT)" LLM_CTX="$(LLM_CTX)" \
		LLM_CHAT_TEMPLATE="$(LLM_CHAT_TEMPLATE_ABS)" LLM_EXTRA_FLAGS="$(LLM_EXTRA_FLAGS)" LLM_CACHE_RAM_MB="$(LLM_CACHE_RAM_MB)" LLM_NO_WARMUP=1 \
		"$(LLM_LAUNCHER)"

NEMO_VERSION ?= 0.1.0
NEMO_DIR ?= $(HOME)/nemo-speech
NEMO_BIN = $(firstword $(wildcard $(NEMO_DIR)/nemo-speech*/bin/nemo-speech) $(NEMO_DIR)/nemo-speech/bin/nemo-speech)
NEMO_PORT ?= 8600
NEMO_MODEL ?= nemotron-3.5
NEMO_EXTRA_FLAGS ?=

nemo-speech: ##🏗️ Install NeMo-Speech.cpp prebuilt binary + pull the ASR model
	@if [ -x "$(NEMO_BIN)" ]; then echo "✅ nemo-speech already installed: $(NEMO_BIN)"; \
	else \
		case "$$(uname -s)-$$(uname -m)" in \
			Darwin-arm64) asset=macos-aarch64-metal ;; \
			Linux-aarch64) asset=linux-aarch64-vulkan ;; \
			Linux-x86_64) asset=linux-x86_64-cuda13 ;; \
			*) echo "❌ unsupported platform"; exit 1 ;; \
		esac; \
		mkdir -p "$(NEMO_DIR)"; \
		echo "🌐 Downloading nemo-speech-$(NEMO_VERSION)-$$asset..."; \
		curl -fL --progress-bar "https://github.com/NVIDIA/NeMo-Speech.cpp/releases/download/v$(NEMO_VERSION)/nemo-speech-$(NEMO_VERSION)-$$asset.tar.gz" | tar xz -C "$(NEMO_DIR)"; \
	fi
	@"$(NEMO_BIN)" model pull $(NEMO_MODEL)
	@echo "✅ nemo-speech ready — set stt.engine=NEMO_SPEECH, stt.baseUrl=http://127.0.0.1:$(NEMO_PORT)/v1"

nemo-serve: ##🚀 Run nemo-speech serve in the foreground on :$(NEMO_PORT) (dev, any OS)
	@$(MAKE) nemo-speech
	@MODEL=$$("$(NEMO_BIN)" model list --paths 2>/dev/null | grep -m1 "$(NEMO_MODEL)" | awk '{print $$NF}'); \
	[ -n "$$MODEL" ] || MODEL=$$(find $$HOME/.cache/nemo-speech $$HOME/Library/Caches/NeMoSpeech -name "*.gguf" 2>/dev/null | grep -m1 asr || find $$HOME/.cache/nemo-speech $$HOME/Library/Caches/NeMoSpeech -name "*.gguf" 2>/dev/null | head -1); \
	[ -n "$$MODEL" ] || { echo "❌ no ASR model found — run: make nemo-speech NEMO_MODEL=$(NEMO_MODEL)"; exit 1; }; \
	"$(NEMO_BIN)" serve --asr-model "$$MODEL" --host 127.0.0.1 --port $(NEMO_PORT) --no-ui --no-warmup --asr.backend.gpu 0 --asr.streaming.rnnt_right_context 1 $(NEMO_EXTRA_FLAGS)

nemo-service: ##🔁 Install nemo-speech serve as a systemd USER unit (Linux, no sudo; starts at boot via linger)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make nemo-serve"; exit 1; }
	@$(MAKE) nemo-speech
	@MODEL=$$(find $$HOME/.cache/nemo-speech -name "*.gguf" 2>/dev/null | grep -m1 asr || find $$HOME/.cache/nemo-speech -name "*.gguf" | head -1); \
	[ -n "$$MODEL" ] || { echo "❌ no ASR model found — run: make nemo-speech NEMO_MODEL=$(NEMO_MODEL)"; exit 1; }; \
	mkdir -p "$$HOME/.config/systemd/user"; \
	printf '[Unit]\nDescription=NeMo-Speech.cpp server (Domia STT)\nAfter=network-online.target\n\n[Service]\nType=simple\nExecStart=%s serve --asr-model %s --host 127.0.0.1 --port %s --no-ui --no-warmup --asr.backend.gpu 0 --asr.streaming.rnnt_right_context 1 %s\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=default.target\n' \
		"$(NEMO_BIN)" "$$MODEL" "$(NEMO_PORT)" "$(NEMO_EXTRA_FLAGS)" > "$$HOME/.config/systemd/user/nemo-speech.service"
	@systemctl --user daemon-reload && systemctl --user enable --now nemo-speech
	@loginctl enable-linger "$$(id -un)" 2>/dev/null || true
	@[ "$$(loginctl show-user "$$(id -un)" -p Linger --value 2>/dev/null)" = "yes" ] && echo "✅ nemo-speech user service installed on :$(NEMO_PORT), starts at boot (linger on). Logs: journalctl --user -fu nemo-speech" \
		|| echo "⚠️ nemo-speech user service installed on :$(NEMO_PORT) but linger is OFF — it will only start after you log in. Enable once with: sudo loginctl enable-linger $$(id -un)"

LLM_LAUNCHD_LABEL = ai.domia.llm-server
LLM_LAUNCHD_PLIST = $(HOME)/Library/LaunchAgents/$(LLM_LAUNCHD_LABEL).plist

llm-service: ##🔁 Install llama-server as a service (Linux systemd needs sudo · macOS launchd user agent, no sudo)
	@$(MAKE) llama-cpp llm-gguf
	@case "$$(uname -s)" in Darwin|Linux) ;; *) echo "❌ unsupported OS — use: make llm-server"; exit 1 ;; esac
	@if [ "$$(uname -s)" = "Darwin" ]; then \
		mkdir -p "$(HOME)/Library/LaunchAgents" log; \
		launchctl bootout "gui/$$(id -u)/$(LLM_LAUNCHD_LABEL)" 2>/dev/null || true; \
		for i in $$(seq 1 30); do launchctl print "gui/$$(id -u)/$(LLM_LAUNCHD_LABEL)" >/dev/null 2>&1 || break; sleep 1; done; \
		printf '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>%s</string>\n<key>ProgramArguments</key><array><string>%s</string></array>\n<key>EnvironmentVariables</key><dict>\n<key>LLAMA_SERVER_BIN</key><string>%s</string>\n<key>LLM_GGUF</key><string>%s</string>\n<key>LLM_PORT</key><string>%s</string>\n<key>LLM_CTX</key><string>%s</string>\n<key>LLM_CHAT_TEMPLATE</key><string>%s</string>\n<key>LLM_EXTRA_FLAGS</key><string>%s</string>\n<key>LLM_CACHE_RAM_MB</key><string>%s</string>\n</dict>\n<key>RunAtLoad</key><true/>\n<key>KeepAlive</key><true/>\n<key>StandardOutPath</key><string>%s/log/llama-server.log</string>\n<key>StandardErrorPath</key><string>%s/log/llama-server.log</string>\n</dict></plist>\n' \
			"$(LLM_LAUNCHD_LABEL)" "$(LLM_LAUNCHER)" "$(LLAMA_SERVER_BIN)" "$(abspath $(LLM_GGUF))" "$(LLM_PORT)" "$(LLM_CTX)" "$(LLM_CHAT_TEMPLATE_ABS)" "$(LLM_EXTRA_FLAGS)" "$(LLM_CACHE_RAM_MB)" "$(CURDIR)" "$(CURDIR)" > "$(LLM_LAUNCHD_PLIST)"; \
		launchctl bootstrap "gui/$$(id -u)" "$(LLM_LAUNCHD_PLIST)"; \
		echo "✅ llama-server launchd agent installed (port $(LLM_PORT)). Logs: tail -f log/llama-server.log · restart: launchctl kickstart -k gui/$$(id -u)/$(LLM_LAUNCHD_LABEL) · remove: launchctl bootout gui/$$(id -u)/$(LLM_LAUNCHD_LABEL)"; \
	else \
		printf '[Unit]\nDescription=llama.cpp server (Domia LLM)\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=%s\nEnvironment=LLAMA_SERVER_BIN=%s\nEnvironment=LLM_GGUF=%s\nEnvironment=LLM_PORT=%s\nEnvironment=LLM_CTX=%s\nEnvironment=LLM_CHAT_TEMPLATE=%s\nEnvironment="LLM_EXTRA_FLAGS=%s"\nEnvironment=LLM_CACHE_RAM_MB=%s\nExecStart=%s\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
			"$$(id -un)" "$(LLAMA_SERVER_BIN)" "$(abspath $(LLM_GGUF))" "$(LLM_PORT)" "$(LLM_CTX)" "$(LLM_CHAT_TEMPLATE_ABS)" "$(LLM_EXTRA_FLAGS)" "$(LLM_CACHE_RAM_MB)" "$(LLM_LAUNCHER)" > /tmp/llama-server.service; \
		sudo cp /tmp/llama-server.service /etc/systemd/system/llama-server.service; \
		sudo systemctl daemon-reload && sudo systemctl enable --now llama-server; \
		echo "✅ llama-server service installed (port $(LLM_PORT)). Logs: journalctl -fu llama-server"; \
	fi

ASR_GGUF ?= data/models/gguf/qwen3-asr-0.6b-q8.gguf
ASR_MMPROJ ?= data/models/gguf/mmproj-qwen3-asr-0.6b-q8.gguf
ASR_PORT ?= 11436

asr-server: ##🎤 Run the GPU ASR server (Qwen3-ASR via llama.cpp) in the foreground on :$(ASR_PORT)
	@$(MAKE) llama-cpp
	@npm run dev-cli -- setup-models qwen3-asr
	@echo "🎤 ASR server on http://127.0.0.1:$(ASR_PORT)/v1 — point stt.baseUrl there (engine OPENAI_COMPATIBLE)"
	@"$(LLAMA_SERVER_BIN)" -m "$(ASR_GGUF)" --mmproj "$(ASR_MMPROJ)" \
		--host 127.0.0.1 --port $(ASR_PORT) -ngl 99 -c 2048

asr-service: ##🔁 Install the GPU ASR server as a systemd service (Linux, needs sudo)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd is Linux-only — use: make asr-server"; exit 1; }
	@$(MAKE) llama-cpp
	@npm run dev-cli -- setup-models qwen3-asr
	@printf '[Unit]\nDescription=Qwen3-ASR server (Domia STT)\nAfter=network-online.target\n\n[Service]\nType=simple\nUser=%s\nExecStart=%s -m %s --mmproj %s --host 127.0.0.1 --port %s -ngl 99 -c 2048\nRestart=always\nRestartSec=5\n\n[Install]\nWantedBy=multi-user.target\n' \
		"$$(id -un)" "$(LLAMA_SERVER_BIN)" "$(abspath $(ASR_GGUF))" "$(abspath $(ASR_MMPROJ))" "$(ASR_PORT)" > /tmp/domia-asr.service
	@sudo cp /tmp/domia-asr.service /etc/systemd/system/domia-asr.service
	@sudo systemctl daemon-reload && sudo systemctl enable --now domia-asr
	@echo "✅ domia-asr service on :$(ASR_PORT). Logs: journalctl -fu domia-asr"

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
	@echo "         npm run dev-cli -- setup-models jetson"
	@echo "   Then apply the Jetson role to your Domia:  npm run dev-cli -- config import templates/jetson.json"
