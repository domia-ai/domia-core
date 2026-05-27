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
	@docker run --rm -v "$$(pwd)/config/mqtt:/mosquitto/config" eclipse-mosquitto \
		mosquitto_passwd -b -c /mosquitto/config/password.txt domia domia

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
doctor: ##🩺 Check required system binaries (sox)
	@echo "🧪 Checking system-level binaries..."
	@command -v sox >/dev/null 2>&1 && echo "✅ sox found" || { echo "❌ sox not found. Run: make install-deps"; exit 1; }
	@command -v node >/dev/null 2>&1 && echo "✅ node found ($$(node --version))" || { echo "❌ node not found"; exit 1; }
	@echo "🎯 System checks passed."

##@ Dev
dev: ##🧪 Start development environment (Ollama + Mosquitto)
	@echo "🧪 Starting dev environment with Ollama and Mosquitto..."
	@$(MAKE) ollama
	@$(MAKE) mosquitto
