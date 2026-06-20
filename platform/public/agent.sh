#!/bin/bash
# srvly-agent install script
# Usage: curl -sL https://srvly.app/agent.sh | bash -s -- --token <token> --server <wss-url>

set -e

BINARY_URL="https://srvly.app/srvly-agent"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="srvly-agent"

echo "srvly-agent installer"
echo "====================="

# Detect architecture
MACHINE="$(uname -m)"
case "$MACHINE" in
    x86_64|amd64) ARCH="amd64" ;;
    aarch64|arm64) ARCH="arm64" ;;
    *) echo "Unsupported architecture: $MACHINE"; exit 1 ;;
esac

# Parse arguments
AGENT_TOKEN=""
AGENT_SERVER=""
while [[ $# -gt 0 ]]; do
    ARG=""
    case "$1" in
        --token) AGENT_TOKEN="$2"; shift 2 ;;
        --server) AGENT_SERVER="$2"; shift 2 ;;
        *) echo "Unknown option: $1"; exit 1 ;;
    esac
done

if [ -z "$AGENT_TOKEN" ]; then
    echo "Error: --token is required"
    exit 1
fi

if [ -z "$AGENT_SERVER" ]; then
    AGENT_SERVER="wss://platform.srvly.app/ws"
fi

# Download binary
echo "Downloading srvly-agent for linux/$ARCH..."
curl -sL "$BINARY_URL" -o "/tmp/$BINARY_NAME"
chmod +x "/tmp/$BINARY_NAME"

# Install
sudo mv "/tmp/$BINARY_NAME" "$INSTALL_DIR/$BINARY_NAME"
echo "Installed to $INSTALL_DIR/$BINARY_NAME"

# Create systemd service
sudo tee /etc/systemd/system/srvly-agent.service > /dev/null << SERVICE_END
[Unit]
Description=srvly-agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$INSTALL_DIR/$BINARY_NAME --server $AGENT_SERVER --token $AGENT_TOKEN
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE_END

sudo systemctl daemon-reload
sudo systemctl enable srvly-agent
sudo systemctl start srvly-agent

echo ""
echo " DONE! srvly-agent installed and running!"
echo " Token: $AGENT_TOKEN"
echo " Server: $AGENT_SERVER"
echo ""
echo " Check: sudo systemctl status srvly-agent"
echo " Logs:  sudo journalctl -u srvly-agent -f"
