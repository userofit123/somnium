#!/bin/sh
# Installs scripts/dev-nudge.mjs as a user service, so saved files always reach the dev containers
# (see the comment at the top of dev-nudge.mjs). Safe to run again.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT="$HOME/.config/systemd/user/somnium-dev-nudge.service"
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<UNIT
[Unit]
Description=Somnium dev: make saved files show up in the Docker Desktop containers

[Service]
ExecStart=$(command -v node) $ROOT/scripts/dev-nudge.mjs
Restart=always
RestartSec=2

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now somnium-dev-nudge.service
systemctl --user --no-pager status somnium-dev-nudge.service | head -3
