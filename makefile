.PHONY: jetson-power jetson-power-service llm-bench help core ollama mosquitto install-llama run-llama setup-models \
	mosquitto-logs mosquitto-down mosquitto-user mosquitto-acl mosquitto-acl-off \
	up stop down install-deps services doctor posture status logs logs-raw restart dev \
	livekit-install livekit-native livekit-docker livekit-logs livekit-down \
	setup run dev-certs package domia-service install-services install-ollama \
	llama-cpp llama-cpp-build llm-gguf llm-server nemo-speech nemo-serve nemo-service \
	llm-service asr-server asr-service jetson-doctor jetson-setup

OLLAMA_MODEL ?= llama3.2:3b

MQTT_USER ?=
MQTT_PASS ?=

CERT_NODE ?= domia
CERT_DIR ?= data/certs
CERT_SANS ?=

DOMIA_ENV ?= .env

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
LLM_CACHE_RAM_MB ?= 256
LLM_SPEC_TYPE ?=
LLM_CHAT_TEMPLATE ?=
LLM_CHAT_TEMPLATE_ABS = $(if $(LLM_CHAT_TEMPLATE),$(abspath $(LLM_CHAT_TEMPLATE)),)
LLM_LAUNCHER = $(abspath scripts/llm-server.sh)
LLM_BUILD_JOBS ?= 3
LLM_CUDA_ARCHITECTURES ?= native
LLM_MEMORY_HIGH ?= 5G
NVPMODEL_MODE ?= 2
LLM_LAUNCHD_LABEL = ai.domia.llm-server
LLM_LAUNCHD_PLIST = $(HOME)/Library/LaunchAgents/$(LLM_LAUNCHD_LABEL).plist

NEMO_VERSION ?= 0.1.0
NEMO_DIR ?= $(HOME)/nemo-speech
NEMO_BIN = $(firstword $(wildcard $(NEMO_DIR)/nemo-speech*/bin/nemo-speech) $(NEMO_DIR)/nemo-speech/bin/nemo-speech)
NEMO_PORT ?= 8600
NEMO_MODEL ?= nemotron-3.5
NEMO_EXTRA_FLAGS ?=

ASR_GGUF ?= data/models/gguf/qwen3-asr-0.6b-q8.gguf
ASR_MMPROJ ?= data/models/gguf/mmproj-qwen3-asr-0.6b-q8.gguf
ASR_PORT ?= 11436

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

mosquitto-user: ##🔐 Add/replace one broker user (per node): make mosquitto-user MQTT_USER=node-a MQTT_PASS=...
	@[ -n "$(MQTT_USER)" ] && [ -n "$(MQTT_PASS)" ] || { echo "❌ usage: make mosquitto-user MQTT_USER=<name> MQTT_PASS=<password>"; exit 1; }
	@docker run --rm -v "$$(pwd)/config/mqtt:/mosquitto/config" eclipse-mosquitto sh -c \
		"touch /mosquitto/config/password.txt \
		&& mosquitto_passwd -b /mosquitto/config/password.txt '$(MQTT_USER)' '$(MQTT_PASS)' \
		&& chown mosquitto:mosquitto /mosquitto/config/password.txt"
	@echo "✅ broker user '$(MQTT_USER)' set — put it in that node's mqtt_config (username/password) and in config/mqtt/acl.txt"

mosquitto-acl: ##🛡️ Opt in to per-node topic ACLs: seed config/mqtt/acl.txt from acl.example and enable acl_file
	@bash scripts/mosquitto.sh acl

mosquitto-acl-off: ##🧹 Disable the ACL file (keeps acl.txt for later)
	@bash scripts/mosquitto.sh acl-off

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
	@bash scripts/install-deps.sh deps

##@ Diagnostics
services: ##🩺 Show which runtime services answer (MQTT broker, llama-server, nemo-speech) and how to start the missing ones
	@LLM_PORT="$(LLM_PORT)" NEMO_PORT="$(NEMO_PORT)" bash scripts/doctor.sh services

doctor: ##🩺 Check required system binaries (sox, node, docker compose)
	@DOMIA_ENV="$(DOMIA_ENV)" bash scripts/doctor.sh doctor

posture: ##🔒 Report the security/ops posture of $(DOMIA_ENV): TLS, mesh secret + rotation, MQTT ACLs, OpenTelemetry
	@DOMIA_ENV="$(DOMIA_ENV)" bash scripts/doctor.sh posture

status: ##🩺 One-screen state of this node: systemd units (domia, llama-server, nemo-speech), /health, connected satellites and providers
	@DOMIA_ENV="$(DOMIA_ENV)" bash scripts/doctor.sh status

logs: ##📜 Follow the node log of $(DOMIA_ENV) filtered to turns, satellites and providers (LOG_GREP=pattern to change the filter)
	@DOMIA_ENV="$(DOMIA_ENV)" LOG_GREP="$(LOG_GREP)" bash scripts/doctor.sh logs

logs-raw: ##📜 Follow the full JSON node log of $(DOMIA_ENV)
	@DOMIA_ENV="$(DOMIA_ENV)" bash scripts/doctor.sh logs-raw

restart: ##🔁 Restart the domia systemd service without sudo (kills the main process; Restart=always relaunches it) and wait for /health
	@bash scripts/doctor.sh restart

##@ Dev
dev: ##🧪 Start the dev environment (Mosquitto) and show which services still need starting
	@echo "🧪 Starting dev environment (Mosquitto)..."
	@$(MAKE) mosquitto
	@$(MAKE) services

##@ LiveKit
livekit-install: ##📦 Install the livekit-server binary (only if you use the feature)
	@bash scripts/install-deps.sh livekit

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

dev-certs: ##🔐 Self-signed dev CA + node cert for HTTPS/gRPC TLS (openssl; any OS). CERT_NODE=<name> CERT_SANS="IP:10.0.0.5 DNS:hub.lan"
	@bash scripts/gen-dev-certs.sh "$(CERT_NODE)" "$(CERT_DIR)" $(CERT_SANS)

package: ##📦 Build a deployable tarball (build/ + templates + scripts + MANIFEST.json) into dist/
	@bash scripts/package.sh

install-services: ##🔁 Reboot-safe Linux hub in one go: llama-server + domia (system units, sudo) + nemo-speech (user unit + linger, no sudo). LLM_CACHE_RAM_MB defaults to 256 MiB (0 disables the host prompt cache, -1 uncaps it)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ Linux-only (macOS: make llm-service + make nemo-serve + make run)"; exit 1; }
	@$(MAKE) llm-service
	@$(MAKE) nemo-service
	@$(MAKE) domia-service
	@$(MAKE) --no-print-directory services
	@echo "✅ hub survives reboots — verify after one with: make services"

domia-service: ##🛡️ Install domia as a systemd service (Linux, needs sudo)
	@WORKDIR="$(abspath .)" DOMIA_ENV="$(DOMIA_ENV)" bash scripts/install-service.sh domia

install-ollama: ##🧠 Install Ollama natively + pull default models (Linux/Jetson; GPU auto)
	@bash scripts/install-deps.sh ollama

##@ LLM serving (llama.cpp — any OS; alternative to Ollama, llm.baseUrl :11435/v1)
llama-cpp: ##🏗️ Build llama.cpp (llama-server) — Metal/CUDA/CPU auto-detected. FORCE=1 to rebuild
	@if [ -x "$(LLAMA_SERVER_BIN)" ] && [ -z "$(FORCE)" ]; then \
		echo "✅ llama-server already built: $(LLAMA_SERVER_BIN) (FORCE=1 to rebuild)"; \
	else $(MAKE) llama-cpp-build FORCE=$(FORCE); fi

llama-cpp-build:
	@LLM_SRC_DIR="$(LLM_SRC_DIR)" LLAMA_CPP_DIR="$(LLAMA_CPP_DIR)" LLAMA_SERVER_BIN="$(LLAMA_SERVER_BIN)" \
		LLM_BUILD_JOBS="$(LLM_BUILD_JOBS)" LLM_CUDA_ARCHITECTURES="$(LLM_CUDA_ARCHITECTURES)" FORCE="$(FORCE)" bash scripts/build-llama-cpp.sh

llm-gguf: ##📥 Stage the 3B GGUF (reuses an Ollama blob when present, else downloads)
	@LLM_GGUF_DIR="$(LLM_GGUF_DIR)" LLM_GGUF="$(LLM_GGUF)" LLM_OLLAMA_TAG="$(LLM_OLLAMA_TAG)" \
		LLM_GGUF_HF_URL="$(LLM_GGUF_HF_URL)" bash scripts/fetch-gguf.sh

llm-server: ##🚀 Run llama-server in the foreground on :$(LLM_PORT) (dev/bench, any OS)
	@$(MAKE) llama-cpp llm-gguf
	@echo "🚀 llama-server on http://0.0.0.0:$(LLM_PORT)/v1 — point llm.baseUrl there"
	@LLAMA_SERVER_BIN="$(LLAMA_SERVER_BIN)" LLM_GGUF="$(abspath $(LLM_GGUF))" LLM_PORT="$(LLM_PORT)" LLM_CTX="$(LLM_CTX)" \
		LLM_CHAT_TEMPLATE="$(LLM_CHAT_TEMPLATE_ABS)" LLM_EXTRA_FLAGS="$(LLM_EXTRA_FLAGS)" LLM_CACHE_RAM_MB="$(LLM_CACHE_RAM_MB)" LLM_SPEC_TYPE="$(LLM_SPEC_TYPE)" LLM_NO_WARMUP=1 \
		"$(LLM_LAUNCHER)"

nemo-speech: ##🏗️ Install NeMo-Speech.cpp prebuilt binary + pull the ASR model
	@NEMO_VERSION="$(NEMO_VERSION)" NEMO_DIR="$(NEMO_DIR)" NEMO_BIN="$(NEMO_BIN)" NEMO_PORT="$(NEMO_PORT)" \
		NEMO_MODEL="$(NEMO_MODEL)" bash scripts/install-deps.sh nemo-speech

nemo-serve: ##🚀 Run nemo-speech serve in the foreground on :$(NEMO_PORT) (dev, any OS)
	@$(MAKE) nemo-speech
	@MODEL=$$("$(NEMO_BIN)" model list --paths 2>/dev/null | grep -m1 "$(NEMO_MODEL)" | awk '{print $$NF}'); \
	[ -n "$$MODEL" ] || MODEL=$$(find $$HOME/.cache/nemo-speech $$HOME/Library/Caches/NeMoSpeech -name "*.gguf" 2>/dev/null | grep -m1 asr || find $$HOME/.cache/nemo-speech $$HOME/Library/Caches/NeMoSpeech -name "*.gguf" 2>/dev/null | head -1); \
	[ -n "$$MODEL" ] || { echo "❌ no ASR model found — run: make nemo-speech NEMO_MODEL=$(NEMO_MODEL)"; exit 1; }; \
	"$(NEMO_BIN)" serve --asr-model "$$MODEL" --host 127.0.0.1 --port $(NEMO_PORT) --no-ui --no-warmup --asr.backend.gpu 0 --asr.streaming.rnnt_right_context 1 $(NEMO_EXTRA_FLAGS)

nemo-service: ##🔁 Install nemo-speech serve as a systemd USER unit (Linux, no sudo; starts at boot via linger)
	@[ "$$(uname -s)" = "Linux" ] || { echo "❌ systemd service is Linux-only — on macOS use: make nemo-serve"; exit 1; }
	@$(MAKE) nemo-speech
	@NEMO_BIN="$(NEMO_BIN)" NEMO_PORT="$(NEMO_PORT)" NEMO_MODEL="$(NEMO_MODEL)" NEMO_EXTRA_FLAGS="$(NEMO_EXTRA_FLAGS)" \
		bash scripts/install-service.sh nemo --user

llm-service: ##🔁 Install llama-server as a service (Linux systemd needs sudo · macOS launchd user agent, no sudo)
	@$(MAKE) llama-cpp llm-gguf
	@LLM_LAUNCHD_LABEL="$(LLM_LAUNCHD_LABEL)" LLM_LAUNCHD_PLIST="$(LLM_LAUNCHD_PLIST)" LLM_LAUNCHER="$(LLM_LAUNCHER)" \
		LLAMA_SERVER_BIN="$(LLAMA_SERVER_BIN)" LLM_GGUF="$(abspath $(LLM_GGUF))" LLM_PORT="$(LLM_PORT)" LLM_CTX="$(LLM_CTX)" \
		LLM_CHAT_TEMPLATE="$(LLM_CHAT_TEMPLATE_ABS)" LLM_EXTRA_FLAGS="$(LLM_EXTRA_FLAGS)" LLM_CACHE_RAM_MB="$(LLM_CACHE_RAM_MB)" \
		LLM_SPEC_TYPE="$(LLM_SPEC_TYPE)" LLM_MEMORY_HIGH="$(LLM_MEMORY_HIGH)" CURDIR="$(CURDIR)" bash scripts/install-service.sh llm

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
	@LLAMA_SERVER_BIN="$(LLAMA_SERVER_BIN)" ASR_GGUF="$(abspath $(ASR_GGUF))" ASR_MMPROJ="$(abspath $(ASR_MMPROJ))" \
		ASR_PORT="$(ASR_PORT)" bash scripts/install-service.sh asr

##@ Jetson (Orin-class hub — see docs/JETSON.md and templates/jetson.json)

jetson-doctor: ##🔬 Verify Jetson prerequisites (CUDA toolkit, power mode, memory, swap)
	@bash scripts/doctor.sh jetson

jetson-power: ##⚡ Apply MAXN power mode + pin clocks now (sudo nvpmodel -m $(NVPMODEL_MODE) && sudo jetson_clocks)
	@sudo bash scripts/jetson-power.sh $(NVPMODEL_MODE) && bash scripts/doctor.sh status

jetson-power-service: ##🔁 Install the jetson-power boot unit (nvpmodel + jetson_clocks before llama-server; needs sudo)
	@NVPMODEL_MODE="$(NVPMODEL_MODE)" bash scripts/install-service.sh power

llm-bench: ##🧪 Measure llama-server prefill/decode throughput with the box state recorded (LABEL=name)
	@bash scripts/llm-bench.sh "$${LABEL:-$$(date +%Y%m%d-%H%M)}" --port $(LLM_PORT)

jetson-setup: ##🚀 Full Jetson LLM stack: doctor → build llama.cpp (CUDA) → model → systemd service
	@$(MAKE) jetson-doctor
	@$(MAKE) llm-service
	@echo ""
	@echo "✅ Jetson LLM stack ready (llama-server on :$(LLM_PORT))."
	@echo "   Next: download the local models the template needs (STT/TTS/VAD + smart-turn):"
	@echo "         npm run dev-cli -- setup-models jetson"
	@echo "   Then apply the Jetson role to your Domia:  npm run dev-cli -- config import templates/jetson.json"
