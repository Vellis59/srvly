"use client";

import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useState, useMemo } from "react";

// ─── Color generator from string ───
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

function AppCard({ app }: { app: { id: string; name: string; description?: string | null } }) {
  const initial = (app.name || app.id).charAt(0).toUpperCase();
  return (
    <Link
      href={`/install/${app.id}`}
      className="group bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-md transition-all flex items-start gap-3"
    >
      <div className={`w-10 h-10 ${getColor(app.id)} rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0`}>
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-sm text-slate-900 group-hover:text-emerald-700 transition-colors truncate">
          {app.name}
        </h3>
        {app.description && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
            {app.description.slice(0, 120)}
          </p>
        )}
      </div>
    </Link>
  );
}

export default function CatalogPage() {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubcategory, setSelectedSubcategory] = useState<string | null>(null);

  // Fetch categories with counts
  const { data: categories } = trpc.catalog.categories.useQuery();

  // Fetch filtered apps
  const { data: apps, isLoading: appsLoading } = trpc.catalog.list.useQuery({
    category: selectedCategory || undefined,
    subcategory: selectedSubcategory || undefined,
    search: search.trim() || undefined,
  });

  // Fetch category detail when selected
  const { data: categoryData } = trpc.catalog.category.useQuery(
    { id: selectedCategory || "" },
    { enabled: !!selectedCategory }
  );

  // Fetch recent apps (newest by created_at)
  const { data: recentApps } = trpc.catalog.list.useQuery({ sort: "recent", limit: 12 });

  // Featured apps
  const FEATURED_IDS = ["nextcloud", "vaultwarden", "jellyfin", "n8n", "actualbudget", "ghost", "homeassistant", "nginx"];
  const { data: allForFeatured } = trpc.catalog.list.useQuery({ limit: 999 });

  const featured = useMemo(() => {
    if (!allForFeatured) return [];
    return FEATURED_IDS.map(id => allForFeatured.find(a => a.id === id)).filter(Boolean);
  }, [allForFeatured]);

  const filtered = useMemo(() => {
    if (!apps) return [];
    if (!search.trim()) return apps;
    const q = search.toLowerCase();
    return apps.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || "").toLowerCase().includes(q)
    );
  }, [apps, search]);

  const totalApps = apps?.length || 0;

  // Subcategory pills from category data
  const subcategories = categoryData?.subcategories || [];
  const hasSubcategories = subcategories.length > 0;

  const handleCategoryClick = (catId: string) => {
    if (selectedCategory === catId) {
      setSelectedCategory(null);
      setSelectedSubcategory(null);
    } else {
      setSelectedCategory(catId);
      setSelectedSubcategory(null);
    }
  };

  const handleSubcategoryClick = (subId: string) => {
    setSelectedSubcategory(selectedSubcategory === subId ? null : subId);
  };

  return (
    <div>
      {/* Search bar */}
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          {selectedCategory
            ? categories?.find((c) => c.id === selectedCategory)?.label || "Catalogue"
            : "Application Catalog"}
        </h1>
        <p className="text-sm text-slate-500 mb-4">
          {selectedCategory
            ? (categories?.find((c) => c.id === selectedCategory)?.description || "")
            : `${totalApps} apps available — Browse by category`}
        </p>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for an app (Nextcloud, Nginx, Vaultwarden...)"
            className="w-full px-5 py-3.5 pl-12 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 shadow-sm"
          />
          <svg className="absolute left-4 top-4 w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Category pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        <button
          onClick={() => { setSelectedCategory(null); setSelectedSubcategory(null); }}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
            !selectedCategory
              ? "bg-emerald-600 text-white shadow-sm"
              : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
          }`}
        >
          <span>📋</span>
          <span>All</span>
          <span className={`text-xs ml-1 ${!selectedCategory ? "text-emerald-200" : "text-slate-400"}`}>
            {categories?.reduce((s, c) => s + (c.count || 0), 0) || 0}
          </span>
        </button>
        {categories?.map((cat) => (
          <button
            key={cat.id}
            onClick={() => handleCategoryClick(cat.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all ${
              selectedCategory === cat.id
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-white border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700"
            }`}
          >
            <span>{cat.icon}</span>
            <span>{cat.label}</span>
            <span className={`text-xs ml-1 ${
              selectedCategory === cat.id ? "text-emerald-200" : "text-slate-400"
            }`}>
              {cat.count}
            </span>
          </button>
        ))}
      </div>

      {/* Subcategory pills */}
      {hasSubcategories && (
        <div className="flex flex-wrap gap-2 mb-4">
          {subcategories.filter((s: any) => s.apps.length > 0).map((sub) => (
            <button
              key={sub.id}
              onClick={() => handleSubcategoryClick(sub.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                selectedSubcategory === sub.id
                  ? "bg-emerald-100 text-emerald-700"
                  : "bg-slate-50 text-slate-500 hover:bg-slate-100"
              }`}
            >
              {sub.label}
              <span className="ml-1 text-[10px] opacity-60">({sub.apps.length})</span>
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      {!selectedCategory && !search.trim() ? (
        <>
          {/* Popular apps */}
          {featured && featured.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-amber-100 rounded-full flex items-center justify-center text-[10px]">⭐</span>
                Popular apps
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {featured.map((app: any) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          )}

          {/* Recent apps */}
          {recentApps && recentApps.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center text-[10px]">✨</span>
                Recently added
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {recentApps.slice(0, 6).map((app) => (
                  <AppCard key={app.id} app={app} />
                ))}
              </div>
            </div>
          )}

          {/* Browse by category */}
          <div>
            <h2 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <span className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-[10px]">📂</span>
              Browse by category
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
              {categories?.filter(c => c.count > 0).map((cat) => (
                <Link
                  key={cat.id}
                  href={`/catalog/${cat.id}`}
                  className="bg-white rounded-xl border border-slate-200 p-4 hover:border-emerald-300 hover:shadow-sm transition-all text-left block"
                >
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl">{cat.icon}</span>
                    <div>
                      <p className="font-medium text-sm text-slate-900">{cat.label}</p>
                      <p className="text-xs text-slate-400">{cat.count} apps</p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 mt-1">
                    {cat.description}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* App grid */}
          {appsLoading ? (
            <div className="text-slate-400 py-8 text-center">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200">
              <p className="text-5xl mb-4">🔍</p>
              <h2 className="text-lg font-semibold text-slate-700 mb-2">No results</h2>
              <p className="text-sm text-slate-500">
                {search ? "Try a different keyword" : "No apps in this category yet"}
              </p>
            </div>
          ) : (
            <>
              {/* Category header */}
              {selectedCategory && categoryData && (
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-slate-500">
                    <strong className="text-slate-700">{filtered.length}</strong> app{filtered.length !== 1 ? "s" : ""}
                    {selectedSubcategory && ` in ${subcategories.find(s => s.id === selectedSubcategory)?.label || selectedSubcategory}`}
                  </p>
                </div>
              )}

              {/* Grouped by subcategory or flat */}
              {selectedCategory && !selectedSubcategory ? (
                <>
                  {subcategories.filter(s => s.apps.length > 0).map((sub) => (
                    <div key={sub.id} className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold text-slate-800">{sub.label}</h3>
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          {sub.apps.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {sub.apps.map((app) => (
                          <AppCard key={app.id} app={app} />
                        ))}
                      </div>
                    </div>
                  ))}
                  {categoryData?.uncategorized && categoryData.uncategorized.length > 0 && (
                    <div className="mb-6">
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold text-slate-800">Other</h3>
                        <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                          {categoryData.uncategorized.length}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {categoryData.uncategorized.map((app: any) => (
                          <AppCard key={app.id} app={app} />
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filtered.map((app) => (
                    <AppCard key={app.id} app={app} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
