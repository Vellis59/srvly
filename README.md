<br clear="both">

<div align="center">
  <br>
  <img src="https://srvly.app/og-image.svg" alt="srvly" width="600">
  <br><br>
  <h1>srvly</h1>
  <p><strong>Open-source AI-powered VPS management platform</strong></p>
  <p>Connect your servers, deploy 1668+ apps with your AI agent, and monitor everything from one dashboard.</p>

  <p>
    <a href="https://srvly.app"><img src="https://img.shields.io/badge/srvly.app-34d399?style=flat-square" alt="Website"></a>
    <a href="https://console.srvly.app"><img src="https://img.shields.io/badge/console-0f172a?style=flat-square" alt="Console"></a>
    <a href="https://docs.srvly.app"><img src="https://img.shields.io/badge/docs-334155?style=flat-square" alt="Docs"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-34d399?style=flat-square" alt="License"></a>
    <a href="https://github.com/Vellis59/srvly/releases"><img src="https://img.shields.io/github/v/release/Vellis59/srvly?style=flat-square&color=34d399" alt="Release"></a>
  </p>

  <br>
</div>

---

**srvly** is a management portal that gives you a unified view of all your VPS instances. Each server gets its own SSH key, and you deploy applications via your AI agent (Hermes, OpenCLAW, etc.) which communicates with the srvly API.

## ✨ Features

| | Feature | Description |
|---|---|---|
| 🖥️ | **Server Dashboard** | CPU, RAM, disk, uptime & health for every server in real time |
| 🔑 | **SSH Key Auth** | Per-server keys with cron guard. Or use your own SSH key |
| 🛡️ | **Auto Security** | UFW, Fail2Ban, SSH hardening in one command |
| 📦 | **App Catalog** | 1668+ open-source apps ready to deploy, browsable by category |
| 🤖 | **AI Agent API** | REST API for your agent — deploy, debug, register via chat |
| 🐳 | **Docker Management** | Logs, restart, stop/start, cleanup from the dashboard |
| 🔌 | **SSH Direct** | No tunnel, no agent on your server. Pure SSH, minimal attack surface |
| 🔒 | **Encrypted Keys** | SSH private keys encrypted at rest (AES-256-GCM) |
| 🏠 | **Self-Hosted** | Deploy on your own server. Full Docker Compose + Caddy setup |
| 💰 | **100% Free** | Open source MIT. Free tier: 1 server. No credit card needed |

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                   srvly platform                      │
│  ┌─────────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │  Next.js 14  │  │  tRPC    │  │  Postgres +     │  │
│  │  (dashboard) │──│  (API)   │──│  Drizzle ORM    │  │
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

### Stack

| Layer | Technology |
|---|---|
| Frontend / API | Next.js 14 + tRPC |
| Database | PostgreSQL + Drizzle ORM |
| Queue | Redis 7 + BullMQ |
| Auth | NextAuth v5 (GitHub + Google OAuth) |
| Execution | Direct SSH using per-server key pair |
| Proxy | Caddy (auto HTTPS via Let's Encrypt) |
| Infrastructure | Docker Compose |

## 🚀 Quick Start

### Try the Cloud Version

The fastest way to get started:

1. Go to **[console.srvly.app](https://console.srvly.app/auth/signin)**
2. Sign in with GitHub or Google
3. Add your first server → copy the one-liner setup command
4. Run it on your VPS as root
5. Your server appears in the dashboard with live health data

> **No credit card required. Free tier: 1 server unlimited.**

### Self-Hosted

#### Prerequisites

- A Linux VPS (Ubuntu 24.04 LTS recommended)
- A domain pointing to your server's IP
- [GitHub OAuth App](https://github.com/settings/applications/new) (callback: `https://YOUR_DOMAIN/api/auth/callback/github`)
- [Google OAuth App](https://console.cloud.google.com/auth/clients) (callback: `https://YOUR_DOMAIN/api/auth/callback/google`)

#### One-Command Setup

```bash
curl -sL https://srvly.app/connect.sh | bash -s -- 'YOUR_SSH_PUBLIC_KEY'
```

This single command:
- 🔒 Hardens SSH (key-only, no passwords)
- 🔥 Configures UFW firewall (22/80/443)
- 🛡️ Installs Fail2Ban (3 attempts → 1h ban)
- 🐳 Installs Docker + Compose
- 📥 Clones the srvly repository
- 🔑 Sets up your SSH key (with hourly cron guard)
- ⚙️ Generates `.env` and deploys the stack

#### Manual Setup

```bash
# Clone
git clone https://github.com/Vellis59/srvly.git /opt/srvly
cd /opt/srvly

# Configure
cp platform/.env.example .env
nano .env   # Fill in your OAuth credentials, secrets, domain

# Start
docker compose -f infra/docker-compose.yml up -d --build
```

#### Configure Reverse Proxy

Edit `infra/Caddyfile` with your domain, then restart:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Caddy automatically provisions Let's Encrypt TLS certificates.

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `POSTGRES_PASSWORD` | PostgreSQL password | ✅ |
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) | ✅ |
| `NEXT_PUBLIC_BASE_URL` | Your srvly domain | ✅ |
| `NEXT_PUBLIC_APP_URL` | Same as BASE_URL | ✅ |
| `NEXTAUTH_URL` | Same as BASE_URL | ✅ |
| `AUTH_TRUST_HOST` | Set to `true` for production | ✅ |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | ✅ |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth client secret | ✅ |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | ✅ |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | ✅ |
| `SSH_KEY_PATH` | Path for SSH keys (`/app/ssh_keys`) | ✅ |
| `REDIS_URL` | Redis connection for BullMQ | ❌ (recommended) |
| `SSH_ENCRYPTION_KEY` | AES-256-GCM key for SSH key encryption | ❌ |

### OAuth Setup

**GitHub:**
1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/applications/new)
2. Authorization callback URL: `https://YOUR_DOMAIN/api/auth/callback/github`
3. Copy `Client ID` and `Client Secret` to `.env`

**Google:**
1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/auth/clients)
2. Add authorized redirect URI: `https://YOUR_DOMAIN/api/auth/callback/google`
3. Copy `Client ID` and `Client Secret` to `.env`

## 📁 Project Structure

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
├── infra/              # Docker Compose + Caddyfile
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── *.sh            # Deployment & security scripts
├── landing/            # Static landing page
├── recipes/            # App installation recipes (1668+)
├── scripts/            # Import & utility scripts
└── docs/               # Documentation sources
```

## 📡 API

srvly exposes both tRPC and REST endpoints for AI agent integration.

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

API requests require a `Bearer` token in the `Authorization` header:

```
Authorization: Bearer <your-server-token>
```

The token is visible on each server's detail page in the dashboard.

## 🔒 Security

- **SSH key-only authentication** — password auth disabled
- **SSH private keys encrypted at rest** — AES-256-GCM before writing to PostgreSQL
- **Input validation** — All API endpoints validated with Zod schemas
- **RCE prevention** — Environment variables use heredoc + `--env-file` instead of inline shell interpolation
- **Host validation** — IP/hostname format verified before SSH connection
- **UFW firewall** — default deny incoming, allow 22/80/443
- **Fail2Ban** — 3 failed SSH attempts → 1-hour ban
- **Cron-guarded SSH key** — re-authorized hourly

## 🧑‍💻 Development

```bash
# Clone and install
git clone https://github.com/Vellis59/srvly.git
cd srvly/platform
npm install

# Database setup
cp .env.example .env
# Edit .env with your PostgreSQL credentials
npx drizzle-kit push

# Run dev server
npm run dev
```

## 📄 License

[MIT](LICENSE) — do what you want, attribution appreciated.

## 🤝 Contributing

Contributions are welcome! Open an issue or submit a pull request.

---

<p align="center">
  <a href="https://srvly.app"><strong>srvly.app</strong></a> ·
  <a href="https://console.srvly.app">Console</a> ·
  <a href="https://docs.srvly.app">Docs</a> ·
  <a href="https://github.com/Vellis59/srvly">GitHub</a>
</p>
