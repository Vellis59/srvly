import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { recipes, servers, installations, domains } from "@/server/db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import * as http from "http";
import { execSync } from "child_process";

// ─── Config ───────────────────────────────────────────────────────────

const AI_ENDPOINT = process.env["AI_" + "ENDPOINT"];
const AI_KEY     = process.env["AI_" + "API_KEY"];
const AI_MODEL   = process.env.AI_MODEL || "deepseek-v4-flash";
const TUNNEL_URL = process.env.TUNNEL_URL || "http://tunnel-server:8080";
const MAX_TOOL_ITERS = 15;

type ChatMsg = { role: string; content: string };
type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// ─── Tool definitions ──────────────────────────────────────────────────

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "recommender_catalogue",
      description: "Rechercher des applications dans le catalogue srvly qui correspondent à un besoin exprimé en français",
      parameters: {
        type: "object",
        properties: {
          besoin: {
            type: "string",
            description: "Description du besoin (ex: 'prise de notes', 'automatisation', 'blog')",
          },
        },
        required: ["besoin"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "installer_application",
      description: "Lancer l'installation d'une application sur le serveur. Cette commande crée le conteneur Docker et le configure.",
      parameters: {
        type: "object",
        properties: {
          id_recette: { type: "string", description: "ID de la recette dans le catalogue" },
          port: {
            type: "number",
            description: "Port d'écoute (optionnel, défaut selon la recette)",
          },
        },
        required: ["id_recette"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "verifier_installation",
      description: "Vérifier le statut d'une installation en cours ou terminée",
      parameters: {
        type: "object",
        properties: {
          id_installation: {
            type: "string",
            description: "ID de l'installation retourné par installer_application",
          },
        },
        required: ["id_installation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lire_logs_installation",
      description: "Lire les logs complets d'une installation",
      parameters: {
        type: "object",
        properties: {
          id_installation: {
            type: "string",
            description: "ID de l'installation",
          },
        },
        required: ["id_installation"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "diagnostiquer_conteneur",
      description:
        "Exécuter un diagnostic sur le serveur pour une application donnée : docker ps, logs, test curl. Utile après un échec d'installation.",
      parameters: {
        type: "object",
        properties: {
          nom_app: {
            type: "string",
            description: "Nom de l'application à diagnostiquer (ex: 'otterwiki')",
          },
          port: {
            type: "number",
            description: "Port sur lequel l'app est sensée écouter",
          },
        },
        required: ["nom_app"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "configurer_domaine",
      description:
        "Configurer un nom de domaine pour une application (écrit la config Nginx et redirige le trafic)",
      parameters: {
        type: "object",
        properties: {
          nom_domaine: {
            type: "string",
            description: "Nom de domaine complet (ex: otterwiki.localhosted.io)",
          },
          port_cible: {
            type: "number",
            description: "Port de l'application cible",
          },
          nom_app: {
            type: "string",
            description: "Nom de l'application (pour référence)",
          },
        },
        required: ["nom_domaine", "port_cible"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "activer_ssl",
      description:
        "Activer le certificat SSL Let's Encrypt pour un domaine déjà configuré. Nécessite que le DNS pointe vers le serveur.",
      parameters: {
        type: "object",
        properties: {
          nom_domaine: {
            type: "string",
            description: "Nom de domaine complet",
          },
        },
        required: ["nom_domaine"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lister_serveurs",
      description: "Lister les serveurs connectés au compte",
      parameters: {
        type: "object",
        properties: {},
      },
    },
    },
    {
    type: "function",
    function: {
      name: "lire_documentation_github",
      description:
        "Chercher et lire la documentation d'installation d'une app open-source (GitHub README, site officiel). Utilise ceci quand une installation échoue pour trouver la bonne commande Docker.",
      parameters: {
        type: "object",
        properties: {
          nom_app: { type: "string", description: "Nom de l'application" },
          url_github: { type: "string", description: "URL GitHub optionnelle si connue" },
        },
        required: ["nom_app"],
      },
    },
    },
    {
    type: "function",
    function: {
      name: "executer_commande_docker",
      description:
        "Exécuter une commande Docker arbitraire (pull, run, rm, logs, ps). Utilise ceci pour installer avec des paramètres personnalisés ou diagnostiquer.",
      parameters: {
        type: "object",
        properties: {
          commande: { type: "string", description: "Commande Docker complète" },
        },
        required: ["commande"],
      },
    },
    },
    {
    type: "function",
    function: {
      name: "mettre_a_jour_recette",
      description:
        "Corriger une recette du catalogue avec les bons paramètres (image, port, commande). Après avoir trouvé la bonne installation dans la doc GitHub.",
      parameters: {
        type: "object",
        properties: {
          id_recette: { type: "string", description: "ID de la recette" },
          image: { type: "string", description: "Nouvelle image Docker" },
          port_defaut: { type: "number", description: "Nouveau port par défaut" },
          port_conteneur: { type: "number", description: "Port du conteneur" },
          commande: { type: "string", description: "Commande Docker de remplacement" },
        },
        required: ["id_recette"],
      },
    },
  ],
];

// ─── Tool handlers ─────────────────────────────────────────────────────

async function execTool(
  name: string,
  args: any,
  userId: string,
  serverId: string,
): Promise<string> {
  try {
    switch (name) {
      // ── recommend ───────────────────────────────────────────────
      case "recommender_catalogue": {
        const catalog = await db.select().from(recipes).orderBy(recipes.name);
        const q = (args.besoin || "").toLowerCase();
        const terms = q
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .split(/\s+/)
          .filter((t: string) => t.length > 2);

        const scored = catalog
          .map((r) => {
            let score = 0;
            const haystack = [r.id, r.name, r.category, r.description || ""]
              .join(" ")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "");
            for (const t of terms) {
              if (haystack.includes(t)) score += 1;
            }
            // boost n8n for automation
            if (
              q.includes("automatis") ||
              q.includes("workflow") ||
              q.includes("tache")
            ) {
              if (r.id === "n8n") score += 4;
            }
            // boost ghost for blog
            if (q.includes("blog")) {
              if (r.id === "ghost") score += 3;
            }
            return { ...r, score };
          })
          .filter((r) => r.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6);

        if (scored.length === 0)
          return JSON.stringify({ msg: "Aucune application trouvée pour ce besoin." });

        return JSON.stringify(
          scored.map((r) => ({
            id: r.id,
            nom: r.name,
            categorie: r.category,
            description: r.description?.slice(0, 200),
            port_defaut: ((r.params as any)?.port?.default) || null,
            score: r.score,
          })),
        );
      }

      // ── install ─────────────────────────────────────────────────
      case "installer_application": {
        const userServers = await db
          .select()
          .from(servers)
          .where(and(eq(servers.userId, userId), eq(servers.status, "connected")))
          .orderBy(desc(servers.createdAt))
          .limit(1);
        if (!userServers[0]) return JSON.stringify({ erreur: "Aucun serveur connecté." });
        const sid = serverId || userServers[0].id;
        const srv = userServers.find((s) => s.id === sid) || userServers[0];

        const recipe = await db
          .select()
          .from(recipes)
          .where(eq(recipes.id, args.id_recette))
          .limit(1);
        if (!recipe[0]) return JSON.stringify({ erreur: "Recette introuvable." });

        const port = args.port || ((recipe[0].params as any)?.port?.default) || 80;
        const installId = crypto.randomUUID();
        const containerName = `${args.id_recette}-${installId.slice(0, 8)}`;

        // Build script from recipe
        const recipeParams = (recipe[0].params as any) || {};
        const envVars = recipeParams.env
          ? Object.entries(recipeParams.env)
              .map(([k, v]) => `-e ${k}='${String(v).replace(/\$PORT/g, String(port))}'`)
              .join(" ")
          : "";
        const volumes = recipeParams.volumes
          ? (recipeParams.volumes as string[])
              .map(
                (v: string) =>
                  `-v /opt/srvly/${containerName}-${v.split(":")[0]}:${v.split(":")[1]}`,
              )
              .join(" ")
          : "";
        const image = String(recipeParams.image || recipe[0].id);
        const containerPort = recipeParams.port?.container || recipeParams.port?.default || port;

        const script = [
          `mkdir -p /opt/srvly/${containerName} 2>/dev/null || true`,
          `docker pull ${image}`,
          `docker rm -f ${containerName} 2>/dev/null || true`,
          `docker run -d --name ${containerName} --restart unless-stopped -p ${port}:${containerPort} ${envVars} ${volumes} ${image}`,
          `sleep 3`,
          `curl -s -o /dev/null -w '%{http_code}' http://localhost:${port}/ || echo 'no_response'`,
        ].join(" && ");

        // Create installation record
        await db.insert(installations).values({
          id: installId,
          serverId: srv.id,
          recipeId: args.id_recette,
          status: "running",
          params: JSON.stringify({ port, containerName, image }),
          logs: "",
          createdAt: new Date(),
        });

        // Dispatch via tunnel
        const dispatchBody = JSON.stringify({
          action: "install",
          serverId: srv.id,
          script,
          installationId: installId,
        });
        fetch(`${TUNNEL_URL}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: dispatchBody,
        }).catch(() => {});

        return JSON.stringify({
          id_installation: installId,
          statut: "running",
          message: "Installation lancée sur le serveur.",
          nom_conteneur: containerName,
          port,
        });
      }

      // ── check ──────────────────────────────────────────────────
      case "verifier_installation": {
        const inst = await db
          .select()
          .from(installations)
          .where(eq(installations.id, args.id_installation))
          .limit(1);
        if (!inst[0]) return JSON.stringify({ erreur: "Installation introuvable." });
        const i = inst[0];
        let details = `Statut: ${i.status}`;
        if (i.logs) {
          const logLines = String(i.logs || "").split("\n").filter(Boolean);
          if (logLines.length > 0)
            details += `\nDernières lignes:\n${logLines.slice(-10).join("\n")}`;
        }
        return JSON.stringify({
          id_installation: i.id,
          statut: i.status,
          detail: details,
          params: i.params,
        });
      }

      // ── logs ───────────────────────────────────────────────────
      case "lire_logs_installation": {
        const inst = await db
          .select()
          .from(installations)
          .where(eq(installations.id, args.id_installation))
          .limit(1);
        if (!inst[0]) return JSON.stringify({ erreur: "Installation introuvable." });
        return JSON.stringify({
          id_installation: inst[0].id,
          statut: inst[0].status,
          logs: String(inst[0].logs || "").slice(0, 5000),
        });
      }

      // ── diagnostics ────────────────────────────────────────────
      case "diagnostiquer_conteneur": {
        const appName = args.nom_app || "";
        const port = args.port || 80;
        const results: string[] = [];

        // Try Docker socket
        try {
          const containersRaw = await httpRequest(
            "GET",
            `/containers/json?all=true&filters=${encodeURIComponent(JSON.stringify({ name: [appName] }))}`,
          );
          const containers = JSON.parse(containersRaw);
          if (containers.length > 0) {
            const c = containers[0];
            results.push(
              `Conteneur trouvé: ${c.Names?.[0] || "?"} | Statut: ${c.State} | Ports: ${JSON.stringify(c.Ports)}`,
            );
            const logs = await httpRequest(
              "GET",
              `/containers/${c.Id}/logs?stdout=true&stderr=true&tail=30`,
            );
            results.push(`Logs du conteneur:\n${logs.slice(0, 2000)}`);
          } else {
            results.push(`Aucun conteneur trouvé pour "${appName}".`);
          }
        } catch {
          results.push("Impossible d'interroger Docker (socket non disponible).");
        }

        // Try curl test
        try {
          const curlRes = await fetch(`http://localhost:${port}`, {
            signal: AbortSignal.timeout(5000),
          });
          results.push(`Test HTTP sur port ${port}: ${curlRes.status} ${curlRes.statusText}`);
        } catch {
          results.push(`Test HTTP sur port ${port}: aucune réponse (timeout ou refusé).`);
        }

        return results.join("\n---\n");
      }

      // ── domain ─────────────────────────────────────────────────
      case "configurer_domaine": {
        const userServers2 = await db
          .select()
          .from(servers)
          .where(and(eq(servers.userId, userId), eq(servers.status, "connected")))
          .orderBy(desc(servers.createdAt))
          .limit(1);
        if (!userServers2[0])
          return JSON.stringify({ erreur: "Aucun serveur connecté." });
        const sid2 = serverId || userServers2[0].id;

        const domainId = crypto.randomUUID();
        await db.insert(domains).values({
          id: domainId,
          serverId: sid2,
          name: args.nom_domaine,
          targetPort: args.port_cible,
          targetApp: args.nom_app || "",
          sslStatus: "pending",
          createdAt: new Date(),
        });

        // Dispatch Nginx config
        const nginxConf = [
          `server {`,
          `    listen 80;`,
          `    server_name ${args.nom_domaine};`,
          `    location / {`,
          `        proxy_pass http://127.0.0.1:${args.port_cible};`,
          `        proxy_set_header Host $host;`,
          `        proxy_set_header X-Real-IP $remote_addr;`,
          `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`,
          `        proxy_set_header X-Forwarded-Proto $scheme;`,
          `    }`,
          `}`,
        ].join("\n");

        fetch(`${TUNNEL_URL}/dispatch`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "nginx",
            serverId: sid2,
            domain: args.nom_domaine,
            nginxConf,
            domainId,
          }),
        }).catch(() => {});

        return JSON.stringify({
          id_domaine: domainId,
          nom_domaine: args.nom_domaine,
          statut: "configuring",
          message: `Domaine ${args.nom_domaine} configuré vers le port ${args.port_cible}. SSL pas encore actif.`,
        });
      }

      // ── SSL ─────────────────────────────────────────────────────
      case "activer_ssl": {
        const d = await db
          .select()
          .from(domains)
          .where(eq(domains.name, args.nom_domaine))
          .limit(1);
        if (!d[0]) {
          return JSON.stringify({
            erreur: `Domaine "${args.nom_domaine}" introuvable. Configure-le d'abord avec configurer_domaine.`,
          });
        }

        const domainId = d[0].id;
        const sslRes = await fetch(
          `${process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"}/api/domains/enable-ssl`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId }),
          },
        );
        const sslData = await sslRes.json();

        return JSON.stringify({
          nom_domaine: args.nom_domaine,
          statut: sslRes.ok ? "ssl_actif" : "ssl_echoue",
          detail: sslData.url || sslData.error || "Voir logs pour plus de détails.",
        });
      }

      // ── list servers ────────────────────────────────────────────
      case "lister_serveurs": {
        const userServers3 = await db
          .select({
            id: servers.id,
            nom: servers.name,
            ip: servers.ip,
            statut: servers.status,
          })
          .from(servers)
          .where(eq(servers.userId, userId))
          .orderBy(desc(servers.createdAt));
        return JSON.stringify(userServers3.length ? userServers3 : [{ msg: "Aucun serveur" }]);
      }

      // ── GitHub doc ────────────────────────────────────────────────
      case "lire_documentation_github": {
        const appName = args.nom_app || "";
        const providedUrl = args.url_github || "";

        // Try provided URL first
        if (providedUrl) {
          try {
            // Convert GitHub blob URLs to raw
            const rawUrl = providedUrl
              .replace("github.com", "raw.githubusercontent.com")
              .replace("/blob/", "/");
            const readmeRes = await fetch(rawUrl + "/README.md", { signal: AbortSignal.timeout(8000) });
            if (readmeRes.ok) {
              const text = await readmeRes.text();
              return text.slice(0, 5000);
            }
          } catch {}
        }

        // Try common patterns: github.com/{app}/{app}
        const repoSlugs = [
          appName,
          `${appName}/${appName}`,
          `redimp/${appName}`,
          `n8n-io/${appName}`,
          `activepieces/${appName}`,
        ];

        for (const slug of repoSlugs) {
          try {
            const apiRes = await fetch(
              `https://api.github.com/repos/${slug}/readme`,
              {
                headers: { Accept: "application/vnd.github.raw+json", "User-Agent": "srvly/1.0" },
                signal: AbortSignal.timeout(5000),
              },
            );
            if (apiRes.ok) {
              const text = await apiRes.text();
              return `Documentation GitHub (${slug}):\n${text.slice(0, 5000)}`;
            }
          } catch {}
        }

        // Try DuckDuckGo instant answer as fallback
        try {
          const ddgRes = await fetch(
            `https://api.duckduckgo.com/?q=${encodeURIComponent(appName + " docker install")}&format=json&no_html=1`,
            { signal: AbortSignal.timeout(5000) },
          );
          if (ddgRes.ok) {
            const ddg = await ddgRes.json();
            const results = [ddg.AbstractText, ddg.Answer, (ddg.RelatedTopics?.[0]?.Text || "")].filter(Boolean);
            if (results.length) return `Résultats web pour "${appName}":\n${results.join("\n").slice(0, 3000)}`;
          }
        } catch {}

        return JSON.stringify({ message: `Aucune documentation trouvée pour "${appName}".` });
      }

      // ── custom docker command ──────────────────────────────────────
      case "executer_commande_docker": {
        const cmd = String(args.commande || "").trim();
        if (!cmd) return JSON.stringify({ erreur: "Commande vide." });

        // Only allow docker commands
        if (!cmd.startsWith("docker ")) {
          return JSON.stringify({ erreur: "Seules les commandes docker sont autorisées." });
        }

        try {
          const output = execSync(cmd, {
            timeout: 60000,
            maxBuffer: 10 * 1024 * 1024,
            encoding: "utf-8",
          });
          return `Sortie:\n${(output || "").slice(0, 4000)}\n(Commande terminée avec succès)`;
        } catch (e: any) {
          const stderr = e.stderr?.toString() || "";
          const stdout = e.stdout?.toString() || "";
          return `Erreur:\n${(stderr || stdout || e.message).slice(0, 3000)}`;
        }
      }

      // ── update recipe ──────────────────────────────────────────────
      case "mettre_a_jour_recette": {
        const recipeId = args.id_recette;

        const existing = await db
          .select()
          .from(recipes)
          .where(eq(recipes.id, recipeId))
          .limit(1);
        if (!existing[0]) return JSON.stringify({ erreur: `Recette "${recipeId}" introuvable.` });

        const current = existing[0];
        const currentParams = (current.params as any) || {};

        // Build updated params
        const newParams = {
          ...currentParams,
          ...(args.image ? { image: args.image } : {}),
          ...(args.port_defaut || args.port_conteneur
            ? { port: { default: args.port_defaut || currentParams.port?.default, container: args.port_conteneur || currentParams.port?.container } }
            : {}),
          ...(args.variables_env ? { env: JSON.parse(args.variables_env) } : {}),
          ...(args.commande ? { custom_install: args.commande } : {}),
        };

        await db
          .update(recipes)
          .set({ params: JSON.stringify(newParams) })
          .where(eq(recipes.id, recipeId));

        return JSON.stringify({
          message: `Recette "${recipeId}" mise à jour.`,
          modifications: Object.keys(args).filter((k) => k !== "id_recette"),
        });
      }

      default:
        return JSON.stringify({ erreur: `Outil inconnu: ${name}` });
    }
  } catch (err: any) {
    return JSON.stringify({
      erreur: `Erreur dans ${name}: ${err.message || err}`,
    });
  }
}

// ─── Docker API helper (Unix socket) ───────────────────────────────────

function httpRequest(method: string, path: string, body?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath: "/var/run/docker.sock",
        path: `/v1.41${path}`,
        method,
        headers: body
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
          : {},
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── POST handler ──────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ answer: "Authentification requise." }, { status: 401 });

    const userId = session.user.id;
    const { messages: rawMessages, serverId } = (await req.json()) as {
      messages?: ChatMsg[];
      serverId?: string;
    };

    const safeMessages = (rawMessages || []).filter(
      (m) => m.role === "user" || m.role === "assistant" || m.role === "tool",
    ).slice(-20);

    // Build context
    const userServers = await db
      .select()
      .from(servers)
      .where(and(eq(servers.userId, userId), eq(servers.status, "connected")))
      .orderBy(desc(servers.createdAt))
      .limit(1);

    const sid = serverId || userServers[0]?.id || "";
    let ctxServeur = "Aucun serveur connecté.";
    let ctxInstalle = "(aucune)";
    let ctxDomaines = "(aucun)";

    if (userServers[0]) {
      ctxServeur = `${userServers[0].name} (${userServers[0].ip}) [${userServers[0].status}]`;
      const installed = await db
        .select({
          nom: recipes.name,
          statut: installations.status,
          port: sql`CAST(installations.params->>'port' AS TEXT)`,
        })
        .from(installations)
        .innerJoin(recipes, eq(installations.recipeId, recipes.id))
        .where(eq(installations.serverId, userServers[0].id))
        .orderBy(desc(installations.createdAt))
        .limit(10);
      if (installed.length) {
        ctxInstalle = installed
          .map((i) => `${i.nom}:${i.statut}${i.port ? `:${i.port}` : ""}`)
          .join(", ");
      }
      const doms = await db
        .select()
        .from(domains)
        .where(eq(domains.serverId, userServers[0].id))
        .orderBy(desc(domains.createdAt))
        .limit(10);
      if (doms.length) {
        ctxDomaines = doms.map((d) => `${d.name}:${d.sslStatus || "pending"}`).join(", ");
      }
    }

    const systemPrompt = [
      "Tu es l'opérateur technique de srvly. Tu réponds en français, de façon claire et naturelle.",
      "",
      "RÈGLES :",
      "- Tu PEUX installer, configurer et diagnostiquer des applications via les outils à ta disposition.",
      "- Ne prétends JAMAIS avoir fait quelque chose que tu n'as pas fait. Si un outil échoue, dis-le à l'utilisateur et tente un diagnostic.",
      "- Tu poses les questions une par une. Pas de liste.",
      "- Quand l'utilisateur exprime un besoin, utilise l'outil recommender_catalogue pour trouver les meilleures apps.",
      "- Pour installer : demande le port si l'utilisateur ne le précise pas, puis appelle installer_application.",
      "- Après installation : vérifie avec verifier_installation. Si ok, propose un domaine.",
      "- Si l'installation échoue : utilise diagnostiquer_conteneur et/ou lire_logs_installation pour comprendre pourquoi.",
      "- Tu peux proposer des corrections simples (changer de port, réessayer).",
      "- Si un diagnostic montre un conteneur qui existe mais ne répond pas, propose de lire ses logs.",
      "- Ne parle jamais de modèle, de provider, de prompt, ni de détails internes.",
      "- Tu es un agent serveur, pas un chatbot de recommandations.",
      "",
      "CONTEXTE SERVEUR :",
      `Serveur: ${ctxServeur}`,
      `Apps installées: ${ctxInstalle}`,
      `Domaines: ${ctxDomaines}`,
      "",
      "OUTILS DISPONIBLES :",
      "- recommender_catalogue(besoin) : cherche dans le catalogue",
      "- installer_application(id_recette, port?) : installe l'app",
      "- verifier_installation(id_installation) : vérifie le statut",
      "- lire_logs_installation(id_installation) : logs complets",
      "- diagnostiquer_conteneur(nom_app, port?) : diagnostic Docker",
      "- lire_documentation_github(nom_app, url_github?) : cherche la doc officielle de l'app",
      "- executer_commande_docker(commande) : exécute une commande Docker personnalisée",
      "- mettre_a_jour_recette(id_recette, image?, port?, commande?) : corrige la recette du catalogue",
      "- configurer_domaine(nom_domaine, port_cible, nom_app?) : ajoute un domaine avec Nginx",
      "- activer_ssl(nom_domaine) : active Let's Encrypt",
      "- lister_serveurs() : liste les serveurs connectés",
    ].join("\n");

    // ── Function-calling loop ─────────────────────────────────────
    let currentMessages: any[] = [
      { role: "system", content: systemPrompt },
      ...safeMessages,
    ];

    for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 25000);

      try {
        const res = await fetch(AI_ENDPOINT!, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + AI_KEY,
          },
          body: JSON.stringify({
            model: AI_MODEL,
            messages: currentMessages,
            tools: TOOLS,
            tool_choice: "auto",
            temperature: 0.15,
            max_tokens: 1500,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          const errText = await res.text().catch(() => "err");
          return NextResponse.json(
            { answer: `Erreur API (${res.status}). Je réessaie.` },
            { status: 502 },
          );
        }

        const data = await res.json();
        const choice = data.choices?.[0];

        if (!choice) {
          return NextResponse.json({
            answer:
              "Je n'ai pas reçu de réponse de l'API. Réessaie dans un instant.",
          });
        }

        const msg = choice.message;

        // ── Assistant finished ──
        if (choice.finish_reason === "stop" && msg?.content) {
          return NextResponse.json({
            answer: msg.content,
            recommendations: [],
          });
        }

        // ── Tool call ──
        if (choice.finish_reason === "tool_calls" && msg?.tool_calls) {
          currentMessages.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.tool_calls.map((tc: any) => ({
              id: tc.id,
              type: "function",
              function: tc.function,
            })),
          });

          for (const tc of msg.tool_calls) {
            const fnName = tc.function.name;
            let fnArgs: any = {};
            try {
              fnArgs = JSON.parse(tc.function.arguments);
            } catch {}
            const result = await execTool(fnName, fnArgs, userId, sid);
            currentMessages.push({
              role: "tool",
              tool_call_id: tc.id,
              content: result,
            });
          }
          continue; // next LLM iteration
        }

        // ── Fallback ──
        return NextResponse.json({
          answer: msg?.content || "Je n'ai pas de réponse pour l'instant.",
          recommendations: [],
        });
      } catch (err: any) {
        clearTimeout(timeout);
        if (err.name === "AbortError") {
          return NextResponse.json({
            answer:
              "L'opération a pris trop de temps. On reprend ?",
          });
        }
        return NextResponse.json(
          { answer: `Erreur: ${err.message}` },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      answer:
        "Trop d'étapes ont été nécessaires. Reformule si besoin.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { answer: `Erreur serveur: ${err.message}` },
      { status: 500 },
    );
  }
}
