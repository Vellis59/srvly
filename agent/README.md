Go module for srvly-agent — reverse tunnel WSS to connect member VPS to platform.

## Structure
- `cmd/agent/` — main entry point
- `tunnel/` — WebSocket reverse tunnel client
- `executor/` — command execution (Docker, bash, verify)
- `config/` — config parsing (token, server URL)
