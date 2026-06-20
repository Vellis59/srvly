"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState, useMemo } from "react";

const CATEGORY_MAP: Record<string, string> = {
  "developer-tools": "Développement",
  "project-management": "Gestion de projet",
  "self-hosted": "Auto-hébergement",
  privacy: "Confidentialité",
  security: "Sécurité",
  media: "Média",
  "music-streaming": "Musique",
  finance: "Finance",
  databases: "Bases de données",
  monitoring: "Monitoring",
  analytics: "Analytique",
  automation: "Automatisation",
  cms: "CMS / Sites",
  messaging: "Messagerie",
  collaboration: "Collaboration",
  "file-management": "Fichiers",
  "file-sharing": "Partage",
  "photo-gallery": "Photos",
  bookmark: "Liens",
  wiki: "Wiki",
  forum: "Forum",
  "ci/cd": "CI/CD",
  docker: "Docker",
  "no-code": "No-Code",
  "large-language-models": "IA / LLM",
  ai: "IA",
  "ai-chat": "IA / Chat",
  iot: "IoT",
  gaming: "Jeux",
  backup: "Sauvegarde",
  networking: "Réseau",
  "reverse-proxy": "Reverse Proxy",
  "url-shortener": "Raccourcisseur",
  pastebin: "Pastebin",
  "search-engine": "Moteur de recherche",
  "time-tracking": "Temps",
};

function getBroadCategory(cat: string | null): string {
  if (!cat) return "Autre";
  const lower = cat.toLowerCase();
  if (lower.includes("dev") || lower.includes("code") || lower.includes("tool")) return "Développement";
  if (lower.includes("media") || lower.includes("music") || lower.includes("video") || lower.includes("photo") || lower.includes("image")) return "Média";
  if (lower.includes("data") || lower.includes("sql") || lower.includes("db")) return "Bases de données";
  if (lower.includes("monitor") || lower.includes("analytics") || lower.includes("metric")) return "Monitoring";
  if (lower.includes("security") || lower.includes("privacy") || lower.includes("auth") || lower.includes("vpn")) return "Sécurité";
  if (lower.includes("finance") || lower.includes("account") || lower.includes("budget")) return "Finance";
  if (lower.includes("cms") || lower.includes("blog") || lower.includes("wiki") || lower.includes("forum")) return "CMS / Communication";
  if (lower.includes("file") || lower.includes("storage") || lower.includes("backup") || lower.includes("sync")) return "Fichiers / Stockage";
  if (lower.includes("automation") || lower.includes("workflow") || lower.includes("ci/")) return "Automatisation";
  if (lower.includes("docker") || lower.includes("container")) return "Docker / Infra";
  if (lower.includes("ai") || lower.includes("llm") || lower.includes("chat")) return "IA / LLM";
  if (lower.includes("mail") || lower.includes("email") || lower.includes("message")) return "Email / Messagerie";
  if (lower.includes("note") || lower.includes("bookmark") || lower.includes("link")) return "Notes / Liens";
  return CATEGORY_MAP[lower] || "Autre";
}

export default function CatalogPage() {
  const { data: session } = useSession();
  const { data: recipes, isLoading } = trpc.catalog.list.useQuery();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!recipes) return [];
    if (!search.trim()) return recipes;
    const q = search.toLowerCase();
    return recipes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.description?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
    );
  }, [recipes, search]);

  const grouped = useMemo(() => {
    const map: Record<string, typeof filtered> = {};
    for (const recipe of filtered) {
      const cat = getBroadCategory(recipe.category);
      if (!map[cat]) map[cat] = [];
      map[cat].push(recipe);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div>
      {/* Header + Search */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          Catalogue d'applications
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          {recipes?.length || 0} apps disponibles — Cherchez et installez en 1 clic
        </p>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une app (Nextcloud, Nginx, Vaultwarden...)"
            className="w-full px-5 py-3.5 pl-12 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
          />
          <svg className="absolute left-4 top-4 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {isLoading ? (
        <div className="text-slate-400 py-8 text-center">Chargement...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
          <p className="text-5xl mb-4">🔍</p>
          <h2 className="text-lg font-semibold text-slate-700 mb-2">
            Aucun résultat
          </h2>
          <p className="text-sm text-slate-500">
            Essaie un autre mot-clé
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold text-slate-800">{category}</h2>
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {items.length}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {items.map((recipe) => (
                  <Link
                    key={recipe.id}
                    href={`/install/${recipe.id}`}
                    className="bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-sm transition-all"
                  >
                    <h3 className="font-medium text-sm text-slate-900 truncate">
                      {recipe.name}
                    </h3>
                    {recipe.description && (
                      <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                        {recipe.description}
                      </p>
                    )}
                    {recipe.dependencies && recipe.dependencies.length > 1 && (
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {recipe.dependencies.filter(d => d !== "docker").slice(0, 2).map((dep) => (
                          <span key={dep} className="text-[10px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded">
                            {dep}
                          </span>
                        ))}
                      </div>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
