# srvly

Plateforme SaaS pour la gestion de serveurs/VPS.

## Architecture

```
srvly/
├── platform/           # Next.js 14 (dashboard + API + SSH dispatch)
│   ├── src/app/        # Pages : dashboard, servers, catalog
│   ├── src/server/     # DB schema, tRPC routers, auth
│   ├── src/components/ # Sidebar, UI
│   └── src/lib/        # SSH utility, trpc client
├── recipes/            # Catalogue YAML des applications
├── infra/              # Docker Compose (PostgreSQL + app)
└── scripts/            # Utilitaires d'import
```

## Stack

| Couche | Technologie |
|---|---|
| Frontend/API | Next.js 14 + tRPC |
| Base de données | PostgreSQL + Drizzle ORM |
| Auth | NextAuth v5 (GitHub OAuth) |
| Exécution | SSH direct (ssh2) via clé déposée sur le serveur |
| Infra | Docker Compose (Hetzner VPS / Contabo) |

## Principe

**srvly** est un portail de gestion. Chaque utilisateur connecte son VPS en déposant une clé SSH (générée par la plateforme). Les actions mécaniques (sécurité, Docker, Nginx, logs, restart) s'exécutent directement via SSH.

L'installation des applications et le débogage avancé sont gérés par l'**agent IA du client** (Hermes, OpenCLAW, etc.) qui dialogue avec l'utilisateur et appelle l'API srvly pour enregistrer les déploiements.

## Flux de connexion d'un serveur

1. Membre crée un compte (GitHub OAuth)
2. Ajoute son VPS (IP + nom) → clé SSH générée
3. Exécute la commande sur son serveur pour déposer la clé publique
4. (Optionnel) Exécute les actions Sécurité / Docker / Nginx / SSL
5. Le serveur est prêt — les actions du dashboard passent en SSH direct

## Pages principales

- `/dashboard` — Vue d'ensemble
- `/servers` — Liste + ajout de serveurs
- `/servers/[id]` — Actions, apps installées, domaines, SSL
- `/catalog` — Catalogue d'applications
