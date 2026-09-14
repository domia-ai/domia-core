[Unit]
Description=NeMo-Speech.cpp server (Domia STT)
After=network-online.target

[Service]
Type=simple
ExecStart=${NEMO_BIN} serve --asr-model ${NEMO_MODEL_PATH} --host 127.0.0.1 --port ${NEMO_PORT} --no-ui --no-warmup --asr.backend.gpu 0 --asr.streaming.rnnt_right_context 1 ${NEMO_EXTRA_FLAGS}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
