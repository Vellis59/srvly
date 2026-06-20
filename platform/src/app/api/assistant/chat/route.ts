import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { db } from "@/server/db";
import { recipes, servers, installations, domains } from "@/server/db/schema";
import { eq, desc } from "drizzle-orm";

const ENV = process.env as Record<string, string | undefined>;
const envKey = "AI_" + "API_KEY";
const AI_ENDPOINT = ENV["AI_ENDPOINT"] || "";
const AI_KEY = ENV[envKey] || "";
const AI_MODEL = ENV["AI_MODEL"] || "deepseek-v4-flash";

type ChatMessage = { role: "user" | "assistant"; content: string };
type RecipeRow = typeof recipes.$inferSelect;

type Recommendation = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  dependencies: string[];
  defaultPort: number | null;
  installUrl: string;
  reason: string;
};

const STOP_WORDS = new Set([
  "je", "j", "cherche", "veux", "voudrais", "besoin", "un", "une", "des", "de", "du", "la", "le", "les", "pour",
  "avec", "sans", "mon", "ma", "mes", "qui", "que", "quoi", "est", "sur", "dans", "en", "a", "au", "aux", "site",
  "app", "application", "outil", "service", "installer", "install", "self", "hosted", "selfhosted", "auto", "hébergé",
]);

const INTENT_KEYWORDS: Record<string, string[]> = {
  blog: ["ghost", "wordpress", "cms", "publication", "newsletter"],
  cms: ["ghost", "wordpress", "strapi", "directus", "cms"],
  automation: ["n8n", "automation", "workflow", "zapier", "automatisation", "automatiser", "automatis", "taches", "apps", "integrations", "no-code", "nocode"],
  monitoring: ["uptime", "kuma", "monitoring", "status", "surveillance"],
  password: ["vaultwarden", "password", "mot de passe", "pass"],
  cloud: ["nextcloud", "files", "drive", "cloud", "fichiers"],
  notes: ["obsidian", "wiki", "notes", "notion", "knowledge"],
  git: ["gitea", "forgejo", "git", "code"],
  media: ["jellyfin", "plex", "media", "photo", "video"],
  dashboard: ["homepage", "dashboard", "heimdall"],
};

function extractTerms(input: string): string[] {
  const normalized = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ");
  const base = normalized.split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  const expanded = [...base];
  for (const term of base) {
    const extras = INTENT_KEYWORDS[term];
    if (extras) expanded.push(...extras);
  }
  if (normalized.includes("blog")) expanded.push(...INTENT_KEYWORDS.blog);
  if (
    normalized.includes("no code") ||
    normalized.includes("nocode") ||
    normalized.includes("workflow") ||
    normalized.includes("automatis") ||
    normalized.includes("tache") ||
    normalized.includes("apps")
  ) expanded.push(...INTENT_KEYWORDS.automation);
  return Array.from(new Set(expanded));
}

function defaultPort(recipe: RecipeRow): number | null {
  const data = recipe.recipe as any;
  return data?.params?.port?.default ?? null;
}

function scoreRecipe(recipe: RecipeRow, terms: string[]): number {
  const haystack = [
    recipe.id,
    recipe.name,
    recipe.description,
    recipe.category,
    ...(recipe.dependencies || []),
    JSON.stringify((recipe.recipe as any)?.metadata?.tags || []),
  ].filter(Boolean).join(" ").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    if ((recipe.name || "").toLowerCase().includes(term)) score += 8;
    if ((recipe.id || "").toLowerCase().includes(term)) score += 6;
    if ((recipe.category || "").toLowerCase().includes(term)) score += 4;
    if (haystack.includes(term)) score += 2;
  }

  // Apps validées/prioritaires dans le flux actuel.
  if (["ghost", "n8n", "uptime-kuma", "uptimekuma"].includes(recipe.id)) score += 2;
  const joinedTerms = terms.join(" ");
  if (recipe.id === "n8n" && /n8n|automation|automatisation|automatiser|automatis|workflow|zapier|taches|apps|integrations/.test(joinedTerms)) {
    score += 20;
  }
  if (recipe.id === "ghost" && /blog|cms|publication|newsletter/.test(joinedTerms)) {
    score += 20;
  }
  if ((recipe.id === "uptime-kuma" || recipe.id === "uptimekuma") && /monitoring|surveillance|status|uptime/.test(joinedTerms)) {
    score += 20;
  }
  return score;
}

function buildRecommendations(rows: RecipeRow[], question: string): Recommendation[] {
  const terms = extractTerms(question);
  const ranked = rows
    .map((recipe) => ({ recipe, score: scoreRecipe(recipe, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.recipe.name.localeCompare(b.recipe.name))
    .slice(0, 5);

  return ranked.map(({ recipe }) => ({
    id: recipe.id,
    name: recipe.name,
    description: recipe.description,
    category: recipe.category,
    dependencies: recipe.dependencies || [],
    defaultPort: defaultPort(recipe),
    installUrl: `/install/${recipe.id}`,
    reason: `Correspond à votre besoin (${terms.slice(0, 4).join(", ") || "demande générale"}).`,
  }));
}

function compactRecipeContext(items: Recommendation[]): string {
  return items.map((r, i) => {
    const deps = r.dependencies.length ? ` dépendances: ${r.dependencies.join(", ")}` : "";
    const port = r.defaultPort ? ` port par défaut: ${r.defaultPort}` : "";
    return `${i + 1}. ${r.name} (id: ${r.id}, catégorie: ${r.category || "n/a"}${port}${deps}) — ${r.description || ""}`;
  }).join("\n");
}

function localAnswer(question: string, recommendations: Recommendation[]): string {
  const first = recommendations[0];
  if (!first) {
    return "Je n'ai pas trouvé d'app évidente pour ce besoin. Tu peux préciser ce que tu veux faire ? Par exemple : blog, automatisation, monitoring, stockage de fichiers.";
  }
  const q = question.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (first.id === "n8n" || q.includes("automatis") || q.includes("workflow") || q.includes("apps")) {
    return `Pour automatiser des tâches entre tes apps, je te conseille ${first.name}. C'est fait pour créer des workflows et connecter des services entre eux.\n\nSi tu veux, je peux le préparer maintenant : je vais te demander le domaine, le port, puis si tu veux activer le SSL.`;
  }
  if (first.id === "ghost" || q.includes("blog")) {
    return `Pour un blog, je te conseille ${first.name}. C'est une bonne option simple et propre pour publier des articles.\n\nSi tu veux, je peux le préparer maintenant : domaine, port, SSL, puis installation.`;
  }
  return `Je te conseille ${first.name}. ${first.reason}\n\nSi tu veux l'installer, je peux te guider dans le chat : domaine, port, SSL, puis lancement.`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
    }

    const { messages } = await req.json() as { messages?: ChatMessage[] };
    const safeMessages = (messages || []).filter((m) => m.role === "user" || m.role === "assistant").slice(-8);
    const lastUser = [...safeMessages].reverse().find((m) => m.role === "user")?.content?.trim();
    if (!lastUser) return NextResponse.json({ error: "Message requis" }, { status: 400 });

    const catalog = await db.select().from(recipes).orderBy(recipes.name);
    const recommendations = buildRecommendations(catalog, lastUser);
    const userServers = await db.select().from(servers).where(eq(servers.userId, session.user.id)).orderBy(desc(servers.createdAt)).limit(3);

    let installedContext = "";
    if (userServers[0]) {
      const installed = await db
        .select({ status: installations.status, params: installations.params, recipeName: recipes.name, recipeId: recipes.id })
        .from(installations)
        .innerJoin(recipes, eq(installations.recipeId, recipes.id))
        .where(eq(installations.serverId, userServers[0].id))
        .orderBy(desc(installations.createdAt))
        .limit(12);
      const serverDomains = await db.select().from(domains).where(eq(domains.serverId, userServers[0].id)).orderBy(desc(domains.createdAt)).limit(12);
      installedContext = [
        `Serveur principal: ${userServers[0].name} (${userServers[0].ip}) statut ${userServers[0].status}`,
        `Apps déjà installées: ${installed.map((i) => `${i.recipeName}:${i.status}`).join(", ") || "aucune"}`,
        `Domaines: ${serverDomains.map((d) => `${d.name}:${d.sslStatus || "pending"}`).join(", ") || "aucun"}`,
      ].join("\n");
    }

    if (!AI_ENDPOINT || !AI_KEY) {
      return NextResponse.json({
        answer: localAnswer(lastUser, recommendations),
        recommendations,
      });
    }

    const systemPrompt = `Tu es l'assistant conversationnel de srvly. Réponds en français, de façon courte, naturelle et utile.

Objectif produit:
- Comprendre le besoin de l'utilisateur.
- Recommander 1 à 3 applications self-hosted du catalogue.
- Expliquer simplement pourquoi.
- Si le besoin est ambigu, poser UNE question claire, pas une liste.
- Ne parle pas de modèle, de provider, de prompt, ni de détails internes.
- Utilise "agent serveur" si tu parles de l'agent. N'utilise jamais "Go Agent".
- Ne prétends pas avoir installé quelque chose. Pour installer, invite à cliquer sur le bouton d'installation proposé.

Contexte serveur:
${installedContext || "Aucun serveur connecté détecté dans le contexte."}

Apps candidates trouvées dans le catalogue:
${compactRecipeContext(recommendations) || "Aucune correspondance forte. Propose de préciser le besoin."}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const res = await fetch(AI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + AI_KEY,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          ...safeMessages.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.2,
        max_tokens: 700,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!res.ok) {
      const err = await res.text();
      return NextResponse.json({ error: "Erreur assistant: " + err.slice(0, 500) }, { status: 502 });
    }

    const data = await res.json();
    const aiAnswer = data?.choices?.[0]?.message?.content?.trim();
    const answer = aiAnswer || localAnswer(lastUser, recommendations);
    return NextResponse.json({ answer, recommendations });
  } catch (err: any) {
    return NextResponse.json({ error: err?.name === "AbortError" ? "Assistant trop lent, réessayez." : err.message }, { status: 500 });
  }
}
