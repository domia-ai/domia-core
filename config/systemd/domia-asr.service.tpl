[Unit]
Description=Qwen3-ASR server (Domia STT)
After=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
ExecStart=${LLAMA_SERVER_BIN} -m ${ASR_GGUF} --mmproj ${ASR_MMPROJ} --host 127.0.0.1 --port ${ASR_PORT} -ngl 99 -c 2048
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
