[Unit]
Description=Domia core
After=network-online.target llama-server.service

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${WORKDIR}
Environment=PATH=${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=${WORKDIR}/node_modules/.bin/dotenvx run -f ${DOMIA_ENV} -- node build/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
