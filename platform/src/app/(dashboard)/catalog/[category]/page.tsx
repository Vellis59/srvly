"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useMemo } from "react";

const COLORS = [
  "bg-emerald-500", "bg-blue-500", "bg-purple-500", "bg-rose-500",
  "bg-amber-500", "bg-cyan-500", "bg-pink-500", "bg-violet-500",
  "bg-teal-500", "bg-orange-500", "bg-indigo-500", "bg-lime-500",
];

function getColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function AppCard({ app }: { app: { id: string; name: string; description?: string | null; icon?: string | null } }) {
  const initial = (app.name || app.id).charAt(0).toUpperCase();
  const hasIcon = app.icon && (app.icon.startsWith("http") || app.icon.startsWith("data:"));
  return (
    <Link
      href={`/install/${app.id}`}
      className="group bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all flex items-start gap-3"
    >
      {hasIcon ? (
        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-slate-50 flex items-center justify-center">
          <img src={app.icon!} alt={app.name} className="w-7 h-7 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        </div>
      ) : (
        <div className={`w-10 h-10 ${getColor(app.id)} rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
          {initial}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-zinc-100 group-hover:text-emerald-700 transition-colors truncate">
          {app.name}
        </h3>
        {app.description && (
          <p className="text-xs text-zinc-400 mt-0.5 line-clamp-2 leading-relaxed">
            {app.description.slice(0, 120)}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function CategoryPage() {
  const { category: categoryId } = useParams<{ category: string }>();
  const router = useRouter();
  const [selectedSub, setSelectedSub] = useState<string | null>(null);

  const { data: catPage, isLoading } = trpc.catalog.category.useQuery({ id: categoryId });
  const { data: categories } = trpc.catalog.categories.useQuery();

  const catDef = categories?.find((c) => c.id === categoryId);

  const subcategories = useMemo(() => {
    if (!catPage) return [];
    return catPage.subcategories.filter((s: any) => s.apps.length > 0);
  }, [catPage]);

  const uncategorized = catPage?.uncategorized || [];

  // Filter apps by selected subcategory
  const selectedSubData = selectedSub
    ? catPage?.subcategories.find((s: any) => s.id === selectedSub)
    : null;
  const filteredApps = selectedSubData?.apps || null;

  if (isLoading) return <div className="text-zinc-400 py-8">Loading...</div>;
  if (!catPage) return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center border border-slate-200">
      <p className="text-5xl mb-4">🔍</p>
      <h2 className="text-lg font-semibold text-slate-700 mb-2">Category not found</h2>
      <Link href="/catalog" className="text-sm text-emerald-600 hover:underline">← Back to catalog</Link>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link href="/catalog" className="text-sm text-emerald-600 hover:underline mb-2 inline-block">
          ← Back to catalog
        </Link>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-emerald-100 rounded-2xl flex items-center justify-center text-3xl">
            {catDef?.icon || "📦"}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">{catDef?.label || categoryId}</h1>
            <p className="text-sm text-zinc-500 mt-0.5">{catDef?.description || ""}</p>
            <p className="text-xs text-zinc-400 mt-1">
              <strong>{catPage.total}</strong> app{catPage.total !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Subcategory pills */}
      {subcategories.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => setSelectedSub(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !selectedSub
                ? "bg-emerald-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300"
            }`}
          >
            All ({catPage.total})
          </button>
          {subcategories.map((sub: any) => (
            <button
              key={sub.id}
              onClick={() => setSelectedSub(sub.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedSub === sub.id
                  ? "bg-emerald-600 text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300"
              }`}
            >
              {sub.label} ({sub.apps.length})
            </button>
          ))}
        </div>
      )}

      {/* Apps */}
      {selectedSubData ? (
        <div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {selectedSubData.apps.map((app: any) => (
              <AppCard key={app.id} app={app} />
            ))}
          </div>
        </div>
      ) : (
        <>
          {subcategories.map((sub: any) => (
            <div key={sub.id} className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-800">{sub.label}</h3>
                <span className="text-xs bg-slate-100 text-zinc-500 px-2 py-0.5 rounded-full">
                  {sub.apps.length}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {sub.apps.map((app: any) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          ))}
          {uncategorized.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <h3 className="text-sm font-semibold text-slate-800">Other</h3>
                <span className="text-xs bg-slate-100 text-zinc-500 px-2 py-0.5 rounded-full">
                  {uncategorized.length}
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {uncategorized.map((app: any) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
