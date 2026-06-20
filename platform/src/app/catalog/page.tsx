"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Recipe = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  version: string | null;
  dependencies: string[] | null;
};

const categoryIcons: Record<string, string> = {
  webserver: "🌐",
  database: "🗄️",
  cms: "📝",
  analytics: "📊",
  monitoring: "🔍",
  storage: "💾",
  mail: "✉️",
  media: "🎬",
  security: "🔒",
  docker: "🐳",
  other: "📦",
};

function RecipeCard({ recipe }: { recipe: Recipe }) {
  return (
    <Link
      href={`/install/${recipe.id}`}
      className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-emerald-300 transition-all"
    >
      <div className="text-3xl mb-3">
        {recipe.icon || categoryIcons[recipe.category || ""] || "📦"}
      </div>
      <h3 className="font-semibold text-slate-900 mb-1">{recipe.name}</h3>
      {recipe.description && (
        <p className="text-sm text-slate-500 line-clamp-2">
          {recipe.description}
        </p>
      )}
      <div className="flex gap-2 mt-3 flex-wrap">
        {recipe.category && (
          <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg capitalize">
            {recipe.category}
          </span>
        )}
        {recipe.dependencies?.map((dep) => (
          <span
            key={dep}
            className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg"
          >
            {dep}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default function CatalogPage() {
  const { data: session } = useSession();
  const { data: recipes, isLoading } = trpc.catalog.list.useQuery();

  const categories = recipes
    ? [...new Set(recipes.map((r) => r.category).filter(Boolean))].sort()
    : [];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Catalogue d'applications
        </h1>
        <p className="text-slate-500 mt-1">
          Choisissez une application à installer en 1 clic sur vos serveurs
        </p>
      </div>

      {isLoading ? (
        <div className="text-slate-400">Chargement...</div>
      ) : (
        <>
          {categories.map((cat) => {
            const catRecipes = recipes?.filter((r) => r.category === cat) || [];
            return (
              <div key={cat} className="mb-8">
                <h2 className="text-lg font-semibold text-slate-800 mb-4 capitalize flex items-center gap-2">
                  {categoryIcons[cat!] || "📦"} {cat}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {catRecipes.map((recipe) => (
                    <RecipeCard key={recipe.id} recipe={recipe} />
                  ))}
                </div>
              </div>
            );
          })}

          {(!recipes || recipes.length === 0) && (
            <div className="bg-slate-50 rounded-2xl p-12 text-center">
              <p className="text-5xl mb-4">📦</p>
              <h2 className="text-lg font-semibold text-slate-700 mb-2">
                Catalogue vide
              </h2>
              <p className="text-sm text-slate-500">
                Les recettes d'installation seront bientôt disponibles.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
