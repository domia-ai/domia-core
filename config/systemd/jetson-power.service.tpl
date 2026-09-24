[Unit]
Description=Jetson power mode and pinned clocks (Domia hub)
DefaultDependencies=no
After=local-fs.target nvpmodel.service
Before=llama-server.service domia.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/env bash ${JETSON_POWER_SCRIPT} ${NVPMODEL_MODE}

[Install]
WantedBy=multi-user.target
