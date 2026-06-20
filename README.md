# srvly

Plateforme SaaS IA pour gestion de serveurs/VPS.

Déploiement 1-clic d'applications sur le VPS des membres via un agent Go discret.

## Architecture

```
srvly/
├── platform/           # Next.js 14 (dashboard + API + tRPC)
│   ├── src/app/        # Pages : dashboard, servers, catalog, install
│   ├── src/server/     # DB schema, tRPC routers, auth
│   ├── src/components/ # Sidebar, UI
│   └── src/lib/        # Providers, trpc client
├── agent/              # Go binary (reverse tunnel WSS)
│   ├── cmd/            # agent + tunnel-server entrypoints
│   ├── tunnel/         # WebSocket reverse tunnel + Hub
│   ├── executor/       # Exécution bash/docker
│   └── config/         # Configuration
├── recipes/            # Catalogue YAML des recettes d'installation
├── infra/              # Docker Compose + configs
├── docs/               # Diagrammes, docs
└── PLATFORM-README.md  # Ce fichier
```

## Stack

| Couche | Technologie |
|---|---|
| Frontend/API | Next.js 14 + tRPC |
| Base de données | PostgreSQL + Drizzle ORM |
| Queue / temps réel | Redis + BullMQ |
| Agent membre | Go (static ~5MB, reverse tunnel WSS) |
| Auth | NextAuth v5 (GitHub OAuth) |
| Infra | Docker Compose (Hetzner VPS) |

## Dashboard

Pages principales :
- `/dashboard` — Vue d'ensemble, stats, actions rapides
- `/servers` — Liste + ajout de serveurs (VPS membres)
- `/servers/[id]` — Détail serveur, commande d'installation agent
- `/catalog` — Catalogue d'applications (recettes YAML)
- `/install/[recipe]` — Installation 1-clic

## Flux de déploiement

1. Membre crée un compte (GitHub OAuth)
2. Ajoute son VPS (IP + nom)
3. Un token unique est généré → à installer via l'agent Go
4. L'agent Go se connecte en reverse tunnel WSS
5. Le membre parcourt le catalogue et clique "installer"
6. L'IA (Hermes) vérifie les prérequis, adapte, envoie les commandes
7. L'agent exécute, remonte les logs en temps réel
8. Le membre reçoit les accès (URL, admin, password)
