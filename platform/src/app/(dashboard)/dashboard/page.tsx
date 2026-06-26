"use client";

import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import Link from "next/link";
import { useT } from "@/lib/i18n";

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: servers } = trpc.server.list.useQuery();
  const { data: catalog } = trpc.catalog.list.useQuery();
  const _ = useT();

  const connectedServers = servers?.filter((s) => s.status === "connected").length || 0;
  const pendingServers = servers?.filter((s) => s.status === "pending").length || 0;
  const totalServers = servers?.length || 0;
  const totalApps = catalog?.length || 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          {_("dashboard.welcome")}{session?.user?.name ? `, ${session.user.name}` : ""} 👋
        </h1>
        <p className="text-slate-500 mt-1">{_("app.tagline")}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <Link href="/servers" className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md hover:border-emerald-300 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 text-lg">♝</div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{connectedServers}/{totalServers}</p>
              <p className="text-xs text-slate-500">{_("dashboard.servers.online")}</p>
            </div>
          </div>
        </Link>

        <Link href="/catalog" className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md hover:border-emerald-300 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 text-lg">📦</div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{totalApps}</p>
              <p className="text-xs text-slate-500">{_("dashboard.apps.installed")}</p>
            </div>
          </div>
        </Link>

        <Link href="/servers" className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md hover:border-emerald-300 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center text-amber-600 text-lg">⏳</div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{pendingServers}</p>
              <p className="text-xs text-slate-500">Pending setup</p>
            </div>
          </div>
        </Link>

        <Link href="/settings" className="bg-white rounded-2xl border border-slate-200 p-6 hover:shadow-md hover:border-emerald-300 transition-all">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 text-lg">⚙️</div>
            <div>
              <p className="text-2xl font-bold text-slate-900">API</p>
              <p className="text-xs text-slate-500">Agent token & settings</p>
            </div>
          </div>
        </Link>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link href="/servers" className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-6 text-white hover:shadow-lg transition-shadow">
          <p className="text-lg font-bold mb-1">➕ {_("server.list.add")}</p>
          <p className="text-sm text-emerald-100">Add a new server to manage</p>
        </Link>

        <Link href="/catalog" className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-6 text-white hover:shadow-lg transition-shadow">
          <p className="text-lg font-bold mb-1">🚀 {_("dashboard.view.catalog")}</p>
          <p className="text-sm text-blue-100">{totalApps} apps available</p>
        </Link>
      </div>

      {/* Recent servers */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900">Quick access</h2>
          {servers && servers.length > 0 && (
            <Link href="/servers" className="text-sm text-emerald-600 hover:underline">
              View all →</Link>
          )}
        </div>
        {(!servers || servers.length === 0) ? (
          <div className="text-center py-8 text-slate-400">
            <p className="mb-2 text-lg">♜</p>
            <p className="text-sm">{_("server.list.empty.desc")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {servers.slice(0, 5).map((server) => (
              <Link
                key={server.id}
                href={`/servers/${server.id}`}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    server.status === "connected" ? "bg-emerald-500" :
                    server.status === "pending" ? "bg-yellow-400" :
                    "bg-slate-400"
                  }`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 group-hover:text-emerald-700 transition-colors truncate">
                      {server.name}
                    </p>
                    <p className="text-xs text-slate-400 font-mono truncate">{server.ip}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {server.os && (
                    <span className="text-[11px] text-slate-400 hidden sm:inline">{server.os?.slice(0, 20)}</span>
                  )}
                  <span className={`text-xs px-2 py-1 rounded-lg font-medium ${
                    server.status === "connected" ? "bg-emerald-50 text-emerald-700" :
                    server.status === "pending" ? "bg-yellow-50 text-yellow-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>
                    {server.status === "connected" ? "Live" :
                     server.status === "pending" ? "Pending" : server.status}
                  </span>
                  <span className="text-slate-300 group-hover:text-slate-500 transition-colors">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Recent activity placeholder */}
      {servers && servers.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Getting started</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">🔌</p>
              <p className="text-sm font-medium text-slate-700 mb-1">Connect a server</p>
              <p className="text-xs text-slate-400">Add your VPS and copy the SSH key</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">⚙️</p>
              <p className="text-sm font-medium text-slate-700 mb-1">Install Docker</p>
              <p className="text-xs text-slate-400">Set up Docker, Nginx, and SSL</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4 text-center">
              <p className="text-2xl mb-2">🤖</p>
              <p className="text-sm font-medium text-slate-700 mb-1">Install apps via agent</p>
              <p className="text-xs text-slate-400">Browse catalog and ask your agent</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
