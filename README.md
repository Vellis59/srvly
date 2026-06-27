# srvly

**Open-source VPS management platform** — connect your servers, deploy apps with your AI agent, monitor everything from one dashboard.

srvly is a **management portal** that gives you a unified view of all your VPS instances. Each server gets its own SSH key, and you deploy applications via your AI agent (Hermes, OpenCLAW, etc.) which communicates with the srvly API.

## Features

- **Server management** — Add, connect, and monitor your VPS instances from one dashboard
- **SSH key authentication** — srvly generates SSH keys or accepts your own; a cron guard ensures keys stay authorized
- **🔒 SSH keys encrypted at rest** — AES-256-GCM symmetric encryption in the database (auto-fallback for existing keys)
- **One-click deploy** — Server setup script (Docker + UFW + Fail2Ban + SSH hardening) in a single command
- **App catalog** — 900+ open-source apps ready to deploy (via `vellis.cc` catalog)
- **AI agent integration** — Your AI agent handles installations and debugging via the srvly REST API
- **Async job queue** — Deployments and backups are processed via BullMQ + Redis, not blocking the API
- **Real-time monitoring** — CPU, RAM, disk, uptime, and health status for each server
- **Docker management** — View logs, restart, stop/start containers from the dashboard
- **Multi-user ready** — Built-in plan system (free: 1 server) with GitHub OAuth authentication

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                   srvly platform                      │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │  Next.js 14  │  │  tRPC    │  │  Postgres (DB)  │  │
│  │  (dashboard) │──│  (API)   │──│  + Drizzle ORM  │  │
│  └─────────────┘  └──────────┘  └─────────────────┘  │
│         │                                              │
│         ▼                                              │
│  ┌─────────────┐                                       │
│  │  SSH Module  │──→ Direct SSH to your servers        │
│  └─────────────┘                                       │
└──────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────┐   ┌──────────────────┐
│  Your AI Agent   │   │  Your VPS fleet  │
│  (Hermes, etc.)  │──→│  (Docker + apps) │
└──────────────────┘   └──────────────────┘
```

| Layer | Technology |
|---|---|---|
| Frontend / API | Next.js 14 + tRPC |
| Database | PostgreSQL + Drizzle ORM |
| Queue | Redis 7 + BullMQ (async job processing) |
| Auth | NextAuth v5 (GitHub OAuth) |
| Execution | Direct SSH (system `ssh` binary) using per-server key pair |
| Proxy | Caddy (auto HTTPS via Let's Encrypt) |
| Infrastructure | Docker Compose |

## Quick Start (Self-Hosted)

### Prerequisites

- A Linux VPS (Ubuntu 24.04 LTS recommended)
- A domain pointing to your server's IP (e.g., `srvly.example.com`)
- A [GitHub OAuth App](https://github.com/settings/applications/new) (callback URL: `https://YOUR_DOMAIN/api/auth/callback/github`)
- Docker and Docker Compose (or run the all-in-one setup below)

### 1. All-in-one setup (recommended)

SSH into your server and run:

```bash
curl -sL https://YOUR_DOMAIN/connect.sh | bash -s -- 'YOUR_SSH_PUBLIC_KEY'
```

This single command:
- 🔒 Hardens SSH (key-only, no passwords)
- 🔥 Configures UFW firewall (22/80/443)
- 🛡️ Installs Fail2Ban (3 attempts → 1h ban)
- 🐳 Installs Docker + Compose
- 📥 Clones the srvly repository
- 🔑 Sets up your SSH key (with hourly cron guard)
- ⚙️ Generates `.env` and deploys the stack

### 2. Manual setup

```bash
# Clone the repository
git clone https://github.com/YOUR_GITHUB_USER/srvly.git /opt/srvly
cd /opt/srvly

# Configure environment
cp platform/.env.example .env
nano .env   # Fill in your GitHub OAuth credentials, secrets, and domain

# Start the stack
docker compose -f infra/docker-compose.yml up -d --build
```

### 3. Configure your reverse proxy

Edit `infra/Caddyfile` with your domain, then restart:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Caddy automatically provisions Let's Encrypt TLS certificates.

## Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `POSTGRES_PASSWORD` | PostgreSQL password | ✅ |
| `AUTH_SECRET` | NextAuth encryption secret (`openssl rand -base64 32`) | ✅ |
| `NEXT_PUBLIC_BASE_URL` | Your srvly domain (e.g., `https://srvly.example.com`) | ✅ |
| `NEXT_PUBLIC_APP_URL` | Same as BASE_URL | ✅ |
| `NEXTAUTH_URL` | Same as BASE_URL | ✅ |
| `AUTH_TRUST_HOST` | Set to `true` for production | ✅ |
| `GITHUB_CLIENT_ID` | GitHub OAuth App client ID | ✅ |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth App client secret | ✅ |
| `SSH_KEY_PATH` | Path to store generated SSH keys (`/app/ssh_keys`) | ✅ |
| `REDIS_URL` | Redis connection for BullMQ job queue | ❌ (recommended) |
| `SSH_ENCRYPTION_KEY` | Key for AES-256-GCM SSH key encryption (falls back to `AUTH_SECRET`) | ❌ |

### GitHub OAuth Setup

1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/applications/new)
2. Fill in:
   - **Application name**: `srvly` (or your choice)
   - **Homepage URL**: `https://YOUR_DOMAIN`
   - **Authorization callback URL**: `https://YOUR_DOMAIN/api/auth/callback/github`
3. Copy `Client ID` and `Client Secret` to your `.env` file

## Server Connection Flow

1. Sign in with GitHub on your srvly instance
2. Click **Add Server** → enter IP and an optional custom SSH key
3. Copy the one-liner setup command shown on screen
4. Paste and run it on your target server (as root)
5. srvly creates a cron job that re-checks the SSH key hourly
6. Your server appears in the dashboard with live health data

## Development

```bash
# Clone and install
git clone https://github.com/YOUR_GITHUB_USER/srvly.git
cd srvly/platform
npm install

# Setup database
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npx drizzle-kit push

# Run development server
npm run dev
```

## Project Structure

```
srvly/
├── platform/           # Next.js 14 app (dashboard + API + SSH)
│   ├── src/
│   │   ├── app/        # Pages: dashboard, servers, catalog, settings
│   │   ├── server/     # DB schema, tRPC routers, auth config
│   │   ├── components/ # Reusable UI components
│   │   └── lib/        # SSH utility, tRPC client, i18n
│   ├── Dockerfile
│   └── .env.example
├── infra/              # Docker Compose + Caddyfile for self-hosting
│   ├── docker-compose.yml
│   ├── Caddyfile
│   ├── deploy-hetzner.sh
│   └── secure-deploy.sh
└── scripts/            # Import utilities
```

## API

srvly exposes both tRPC and REST endpoints for agent integration.

### REST Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/agent/servers` | GET | List servers accessible to the agent |
| `/api/agent/docker/deploy` | POST | Deploy a Docker app on a server |
| `/api/agent/install/register` | POST | Register an app installation |
| `/api/agent/install` | GET | List installations on a server |
| `/api/agent/install/exec` | POST | Run commands (host or container mode) |
| `/api/agent/install/logs` | POST | Fetch Docker container logs |
| `/api/agent/proxy/configure` | POST | Configure Caddy reverse proxy |
| `/api/domains/enable-ssl` | POST | Enable SSL for a domain |
| `/api/dispatch` | POST | Execute SSH commands on a server |
| `/api/deploy` | GET | Download the all-in-one deployment script |

### Authentication

API requests must include the server's `token` in the `Authorization` header:
```
Authorization: Bearer <server-token>
```

The token is visible on each server's detail page in the dashboard.

## Security

- **SSH key-only authentication** (password auth disabled)
- **SSH private keys encrypted at rest** — AES-256-GCM symmetric encryption before writing to PostgreSQL
- **Input validation** — All API endpoints validated with Zod schemas (types, bounds, regex pattern checks)
- **RCE prevention** — Environment variables use heredoc + `--env-file` instead of inline shell interpolation
- **Host validation** — IP/hostname format verified before SSH connection
- **UFW firewall** (default deny incoming, allow 22/80/443)
- **Fail2Ban** (3 failed SSH attempts → 1-hour ban)
- **Cron-guarded SSH key** (re-authorized hourly)

## License

[MIT](LICENSE)

## Contributing

Contributions are welcome! Open an issue or submit a pull request.

---

**srvly** — Open-source VPS management. Deploy, monitor, and manage your servers with the help of your AI agent.
