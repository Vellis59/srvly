"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function InstallPage() {
  const { recipe: recipeId } = useParams<{ recipe: string }>();
  const router = useRouter();
  const { data: session } = useSession();

  const { data: recipe, isLoading: recipeLoading } = trpc.catalog.get.useQuery({
    id: recipeId,
  });
  const { data: servers } = trpc.server.list.useQuery();
  const install = trpc.install.create.useMutation({
    onSuccess: () => {
      router.push("/dashboard");
    },
  });

  const [selectedServer, setSelectedServer] = useState("");
  const [useDefaults, setUseDefaults] = useState(true);

  if (recipeLoading) {
    return <div className="text-slate-400">Chargement...</div>;
  }

  if (!recipe) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold text-slate-700">Recette inconnue</h2>
        <p className="text-slate-500 mt-2">
          Cette application n'est pas dans le catalogue.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button
          onClick={() => router.back()}
          className="text-sm text-slate-500 hover:text-slate-700 mb-4 block"
        >
          ← Retour au catalogue
        </button>
        <h1 className="text-2xl font-bold text-slate-900">
          Installer {recipe.name}
        </h1>
        {recipe.description && (
          <p className="text-slate-500 mt-1">{recipe.description}</p>
        )}
      </div>

      <div className="space-y-6">
        {/* Server selection */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <label className="block text-sm font-semibold text-slate-700 mb-3">
            Serveur de destination
          </label>
          {servers && servers.length > 0 ? (
            <div className="space-y-2">
              {servers
                .filter((s) => s.status === "connected" || s.status === "pending")
                .map((server) => (
                  <label
                    key={server.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedServer === server.id
                        ? "border-emerald-500 bg-emerald-50"
                        : "border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    <input
                      type="radio"
                      name="server"
                      value={server.id}
                      checked={selectedServer === server.id}
                      onChange={(e) => setSelectedServer(e.target.value)}
                      className="accent-emerald-600"
                    />
                    <div>
                      <p className="font-medium text-slate-900">
                        {server.name}
                      </p>
                      <p className="text-xs text-slate-500 font-mono">
                        {server.ip}
                      </p>
                    </div>
                    <span className="ml-auto text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">
                      {server.status}
                    </span>
                  </label>
                ))}
            </div>
          ) : (
            <div className="text-slate-500 text-sm py-4">
              Aucun serveur disponible.{" "}
              <a href="/servers" className="text-emerald-600 hover:underline">
                Ajoutez-en un d'abord.
              </a>
            </div>
          )}
        </div>

        {/* Parameters */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <label className="block text-sm font-semibold text-slate-700 mb-3">
            Configuration
          </label>
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={useDefaults}
              onChange={(e) => setUseDefaults(e.target.checked)}
              className="accent-emerald-600"
            />
            <span className="text-sm text-slate-600">
              Utiliser les paramètres par défaut (l'IA optimisera
              automatiquement)
            </span>
          </label>
        </div>

        {/* Dependencies */}
        {recipe.dependencies && recipe.dependencies.length > 0 && (
          <div className="bg-amber-50 rounded-2xl border border-amber-200 p-6">
            <p className="text-sm font-semibold text-amber-800 mb-2">
              Dépendances détectées
            </p>
            <div className="flex gap-2 flex-wrap">
              {recipe.dependencies.map((dep) => (
                <span
                  key={dep}
                  className="text-sm bg-white text-amber-700 px-3 py-1.5 rounded-xl border border-amber-200"
                >
                  {dep}
                </span>
              ))}
            </div>
            <p className="text-xs text-amber-600 mt-2">
              L'IA vérifiera et installera ces dépendances automatiquement.
            </p>
          </div>
        )}

        {/* Install button */}
        <button
          onClick={() =>
            install.mutate({
              serverId: selectedServer,
              recipeId: recipe.id,
            })
          }
          disabled={!selectedServer || install.isPending}
          className="w-full py-3.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors text-base"
        >
          {install.isPending
            ? "Installation en cours..."
            : `Lancer l'installation en 1 clic`}
        </button>

        {install.isSuccess && (
          <div className="bg-emerald-50 rounded-2xl p-4 text-sm text-emerald-800 text-center">
            ✅ Installation planifiée ! L'IA s'occupe de tout.
          </div>
        )}

        {install.isError && (
          <div className="bg-red-50 rounded-2xl p-4 text-sm text-red-800 text-center">
            ❌ Erreur : {install.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
