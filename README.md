# srvly

Plateforme SaaS IA pour gestion de serveurs/VPS.

Déploiement 1-clic d'applications sur le VPS des membres via un agent Go discret.

## Architecture

- `platform/` — Next.js 14 (dashboard + API + tRPC)
- `agent/` — Go binary (reverse tunnel WSS)
- `recipes/` — Catalogue YAML des recettes d'installation
- `infra/` — Docker Compose + configs

## Stack

- **Frontend/API**: Next.js 14 + tRPC
- **DB**: PostgreSQL
- **Queue**: Redis + BullMQ
- **Agent**: Go (static binary, ~5MB)
- **Infra**: Docker Compose (VPS Hetzner 16 GB)

