"use client";

import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useT } from "@/lib/i18n";

function formatBytes(mb: number): string {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + " Go";
  return mb + " Mo";
}

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "À l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  return `Il y a ${diffD}j`;
}

function statusIcon(status: string): string {
  switch (status) {
    case "success": return "✅";
    case "running": return "🔄";
    case "failed": return "❌";
    case "stopped": return "⏹️";
    default: return "❓";
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "success": return "Actif";
    case "running": return "En cours";
    case "failed": return "Erreur";
    case "stopped": return "Arrêté";
    default: return status;
  }
}

function statusBadge(status: string): string {
  switch (status) {
    case "success": return "bg-emerald-100 text-emerald-700";
    case "running": return "bg-blue-100 text-blue-700";
    case "failed": return "bg-red-100 text-red-700";
    case "stopped": return "bg-slate-100 text-slate-600";
    default: return "bg-slate-100 text-slate-600";
  }
}

// ─── Stat card component ───

function StatCard({
  href,
  icon,
  iconBg,
  iconColor,
  value,
  label,
  sub,
  trend,
}: {
  href: string;
  icon: string;
  iconBg: string;
  iconColor: string;
  value: string | number;
  label: string;
  sub?: string;
  trend?: { up?: boolean; value: string };
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-emerald-300 transition-all group"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 ${iconBg} rounded-xl flex items-center justify-center ${iconColor} text-lg`}>
          {icon}
        </div>
        {trend && (
          <span className={`text-xs font-medium ${trend.up ? "text-emerald-600" : "text-amber-600"}`}>
            {trend.up ? "↑" : "↓"} {trend.value}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-1 truncate">{sub}</p>}
    </Link>
  );
}

// ─── Main dashboard page ───

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: stats, isLoading: statsLoading } = trpc.dashboard.stats.useQuery();
  const { data: servers } = trpc.server.list.useQuery();
  const { data: activity } = trpc.dashboard.recentActivity.useQuery();
  const _ = useT();

  // Servers in error (? no recent connection)
  const errorServers = servers?.filter((s) => s.status !== "connected") || [];
  const healthyServers = servers?.filter((s) => s.status === "connected") || [];

  return (
    <div>
      {/* ── Header ── */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          {_("dashboard.welcome")}{session?.user?.name ? `, ${session.user.name}` : ""} 👋
        </h1>
        <p className="text-slate-500 mt-1">{_("app.tagline")}</p>
      </div>

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard
          href="/servers"
          icon="♝"
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
          value={statsLoading ? "…" : `${stats?.connectedServers || 0}/${stats?.totalServers || 0}`}
          label="Serveurs connectés"
          sub={stats?.totalServers ? `Total: ${stats.totalServers} serveur${stats.totalServers > 1 ? "s" : ""}` : "Aucun serveur"}
        />
        <StatCard
          href="/dashboard"
          icon="📦"
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
          value={statsLoading ? "…" : (stats?.totalApps || 0)}
          label="Apps installées"
          sub={
            stats && stats.totalApps > 0
              ? `${stats.installSuccess} active${stats.installSuccess > 1 ? "s" : ""} · ${stats.installFailed} en erreur`
              : "Aucune app installée"
          }
        />
        <StatCard
          href="/dashboard"
          icon="💾"
          iconBg="bg-amber-100"
          iconColor="text-amber-600"
          value={
            statsLoading
              ? "…"
              : stats?.totalDiskTotal
              ? `${Math.round((stats.totalDiskUsed / stats.totalDiskTotal) * 100)}%`
              : "—"
          }
          label="Disque utilisé"
          sub={
            stats?.totalDiskTotal
              ? `${stats.totalDiskUsed} / ${stats.totalDiskTotal} Go`
              : "Détection en attente"
          }
        />
        <StatCard
          href="/catalog"
          icon="🛠️"
          iconBg="bg-purple-100"
          iconColor="text-purple-600"
          value={statsLoading ? "…" : (stats?.totalCatalog || "—")}
          label="Catalogue disponible"
          sub={stats?.totalDomains ? `${stats.totalDomains} domaine${stats.totalDomains > 1 ? "s" : ""} configuré${stats.totalDomains > 1 ? "s" : ""}` : ""}
        />
      </div>

      {/* ── Row: Servers + Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

        {/* ── Serveurs ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">♝ Serveurs</h2>
            <Link href="/servers" className="text-sm text-emerald-600 hover:underline">
              Voir tout →
            </Link>
          </div>

          {!servers || servers.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <p className="mb-2 text-lg">♜</p>
              <p className="text-sm mb-3">Aucun serveur connecté</p>
              <Link
                href="/servers"
                className="inline-block px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
              >
                + Ajouter un serveur
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {/* Summary bar */}
              <div className="flex items-center gap-4 text-xs text-slate-500 mb-3 pb-3 border-b border-slate-100">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" /> {healthyServers.length} actif{healthyServers.length > 1 ? "s" : ""}
                </span>
                {errorServers.length > 0 && (
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-400" /> {errorServers.length} en attente
                  </span>
                )}
                <span className="ml-auto">{stats?.totalApps || 0} app{(stats?.totalApps || 0) > 1 ? "s" : ""}</span>
              </div>

              {servers.slice(0, 5).map((server) => {
                const info = (server.systemInfo || {}) as Record<string, any>;
                return (
                  <Link
                    key={server.id}
                    href={`/servers/${server.id}`}
                    className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                          server.status === "connected"
                            ? "bg-emerald-500"
                            : server.status === "pending"
                            ? "bg-yellow-400"
                            : "bg-slate-400"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900 group-hover:text-emerald-700 transition-colors truncate">
                          {server.name}
                        </p>
                        <p className="text-xs text-slate-400 font-mono truncate">{server.ip}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* OS badge */}
                      {server.os && (
                        <span className="text-[11px] text-slate-400 hidden md:inline max-w-[100px] truncate">
                          {server.os.slice(0, 20)}
                        </span>
                      )}
                      {/* RAM / Disk mini */}
                      {info.ramTotal && info.ramUsed && (
                        <span className="text-[11px] text-slate-400 hidden lg:inline">
                          💾 {Math.round((info.ramUsed / info.ramTotal) * 100)}%
                        </span>
                      )}
                      {/* Uptime */}
                      {info.uptime && (
                        <span className="text-[11px] text-slate-400 hidden sm:inline">
                          ⏱ {info.uptime.slice(0, 15)}
                        </span>
                      )}
                      <span
                        className={`text-xs px-2 py-1 rounded-lg font-medium ${
                          server.status === "connected"
                            ? "bg-emerald-50 text-emerald-700"
                            : server.status === "pending"
                            ? "bg-yellow-50 text-yellow-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {server.status === "connected"
                          ? "Live"
                          : server.status === "pending"
                          ? "Pending"
                          : server.status}
                      </span>
                      <span className="text-slate-300 group-hover:text-slate-500 transition-colors">→</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Activité récente ── */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">📋 Activité récente</h2>
          </div>

          {!activity || activity.length === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <p className="mb-2 text-lg">📭</p>
              <p className="text-sm">Aucune activité récente</p>
              <p className="text-xs text-slate-300 mt-1">
                Installez une app depuis le catalogue pour voir l'activité
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activity.map((ev) => (
                <Link
                  key={ev.id}
                  href={`/servers/${ev.serverId}`}
                  className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors group"
                >
                  <span className="text-base mt-0.5">{statusIcon(ev.status)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate group-hover:text-emerald-700 transition-colors">
                      {ev.recipeName || ev.recipeId}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                      <span className="truncate">{ev.serverName || ev.serverId}</span>
                      <span className="shrink-0">·</span>
                      <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${statusBadge(ev.status)}`}>
                        {statusLabel(ev.status)}
                      </span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{timeAgo(ev.updatedAt || ev.createdAt)}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Apps en erreur / Quick actions ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Erreurs */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="font-semibold text-slate-900">⚠️ Apps en erreur</h2>
            {(stats?.installFailed || 0) > 0 && (
              <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                {stats?.installFailed}
              </span>
            )}
          </div>

          {(stats?.installFailed || 0) === 0 ? (
            <div className="text-center py-6 text-slate-400">
              <p className="text-lg mb-1">✅</p>
              <p className="text-sm">Aucune app en erreur</p>
              <p className="text-xs text-slate-300 mt-1">Tout va bien</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              {stats?.installFailed} app{(stats?.installFailed || 0) > 1 ? "s" : ""} en échec — voir les logs
            </p>
          )}

          {servers && servers.length === 0 && (
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-sm font-medium text-blue-800 mb-1">🚀 Bienvenue sur srvly</p>
              <p className="text-xs text-blue-600">
                Ajoutez votre premier serveur pour commencer
              </p>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">🚀 Actions rapides</h2>
          <div className="space-y-3">
            <Link
              href="/servers"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-emerald-100 rounded-lg flex items-center justify-center text-emerald-600 text-sm">
                ➕
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Ajouter un serveur</p>
                <p className="text-xs text-slate-400">Connecter un VPS</p>
              </div>
            </Link>
            <Link
              href="/catalog"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center text-blue-600 text-sm">
                📦
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Installer une app</p>
                <p className="text-xs text-slate-400">Depuis le catalogue</p>
              </div>
            </Link>
            <Link
              href="/settings"
              className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition-colors"
            >
              <div className="w-9 h-9 bg-purple-100 rounded-lg flex items-center justify-center text-purple-600 text-sm">
                ⚙️
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">Configuration agent</p>
                <p className="text-xs text-slate-400">Token API et prompt</p>
              </div>
            </Link>
          </div>
        </div>

        {/* Infra santé */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">📊 Santé de l'infra</h2>
          {stats && stats.totalServers > 0 ? (
            <div className="space-y-4">
              {/* RAM aggregate */}
              {stats.totalRamTotal > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-600">RAM totale</span>
                    <span className="text-slate-900 font-medium">
                      {formatBytes(stats.totalRamUsed)} / {formatBytes(stats.totalRamTotal)}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.round((stats.totalRamUsed / stats.totalRamTotal) * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Disk aggregate */}
              {stats.totalDiskTotal > 0 && (
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-slate-600">Disque total</span>
                    <span className="text-slate-900 font-medium">
                      {stats.totalDiskUsed} Go / {stats.totalDiskTotal} Go
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        (stats.totalDiskUsed / stats.totalDiskTotal) > 0.85
                          ? "bg-red-500"
                          : (stats.totalDiskUsed / stats.totalDiskTotal) > 0.7
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                      }`}
                      style={{ width: `${Math.min(100, Math.round((stats.totalDiskUsed / stats.totalDiskTotal) * 100))}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Health badges */}
              <div className="flex flex-wrap gap-2 pt-2">
                <span className="flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  {healthyServers.length}/{stats.totalServers} serveurs actifs
                </span>
                {stats.installFailed > 0 && (
                  <span className="flex items-center gap-1 text-xs bg-red-50 text-red-700 px-2.5 py-1 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                    {stats.installFailed} app(s) en erreur
                  </span>
                )}
                {stats.installRunning > 0 && (
                  <span className="flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    {stats.installRunning} en cours
                  </span>
                )}
              </div>

              {!stats.totalRamTotal && !stats.totalDiskTotal && (
                <p className="text-sm text-slate-400 text-center py-4">
                  Lancez la détection sur vos serveurs pour voir les métriques
                </p>
              )}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-400">
              <p className="text-lg mb-1">📊</p>
              <p className="text-sm">Ajoutez d'abord un serveur</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
