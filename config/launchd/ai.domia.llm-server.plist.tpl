<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${LLM_LAUNCHD_LABEL}</string>
<key>ProgramArguments</key><array><string>${LLM_LAUNCHER}</string></array>
<key>EnvironmentVariables</key><dict>
<key>LLAMA_SERVER_BIN</key><string>${LLAMA_SERVER_BIN}</string>
<key>LLM_GGUF</key><string>${LLM_GGUF}</string>
<key>LLM_PORT</key><string>${LLM_PORT}</string>
<key>LLM_CTX</key><string>${LLM_CTX}</string>
<key>LLM_CHAT_TEMPLATE</key><string>${LLM_CHAT_TEMPLATE}</string>
<key>LLM_EXTRA_FLAGS</key><string>${LLM_EXTRA_FLAGS}</string>
<key>LLM_CACHE_RAM_MB</key><string>${LLM_CACHE_RAM_MB}</string>
<key>LLM_SPEC_TYPE</key><string>${LLM_SPEC_TYPE}</string>
</dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${CURDIR}/log/llama-server.log</string>
<key>StandardErrorPath</key><string>${CURDIR}/log/llama-server.log</string>
</dict></plist>
