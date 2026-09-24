[Unit]
Description=llama.cpp server (Domia LLM)
After=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
Environment=LLAMA_SERVER_BIN=${LLAMA_SERVER_BIN}
Environment=LLM_GGUF=${LLM_GGUF}
Environment=LLM_PORT=${LLM_PORT}
Environment=LLM_CTX=${LLM_CTX}
Environment=LLM_CHAT_TEMPLATE=${LLM_CHAT_TEMPLATE}
Environment="LLM_EXTRA_FLAGS=${LLM_EXTRA_FLAGS}"
Environment=LLM_CACHE_RAM_MB=${LLM_CACHE_RAM_MB}
Environment=LLM_SPEC_TYPE=${LLM_SPEC_TYPE}
ExecStart=${LLM_LAUNCHER}
MemoryHigh=${LLM_MEMORY_HIGH}
OOMScoreAdjust=-100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
