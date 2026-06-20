"use client";

import { useSession } from "next-auth/react";
import { trpc } from "@/lib/trpc";
import Link from "next/link";

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: servers } = trpc.server.list.useQuery();
  const { data: catalog } = trpc.catalog.list.useQuery();

  const connectedServers =
    servers?.filter((s) => s.status === "connected").length || 0;
  const totalServers = servers?.length || 0;
  const totalApps = catalog?.length || 0;

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Bienvenue{session?.user?.name ? `, ${session.user.name}` : ""} 👋
        </h1>
        <p className="text-slate-500 mt-1">
          Plateforme de déploiement intelligent de services sur vos serveurs.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-600 text-lg">
              ♝
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                {connectedServers}/{totalServers}
              </p>
              <p className="text-xs text-slate-500">Serveurs connectés</p>
            </div>
          </div>
          <Link
            href="/servers"
            className="text-sm text-emerald-600 hover:underline mt-2 inline-block"
          >
            Gérer les serveurs →
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600 text-lg">
              📦
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{totalApps}</p>
              <p className="text-xs text-slate-500">Apps disponibles</p>
            </div>
          </div>
          <Link
            href="/catalog"
            className="text-sm text-emerald-600 hover:underline mt-2 inline-block"
          >
            Voir le catalogue →
          </Link>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-purple-100 rounded-xl flex items-center justify-center text-purple-600 text-lg">
              🧠
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">IA</p>
              <p className="text-xs text-slate-500">Orchestration active</p>
            </div>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <Link
          href="/servers"
          className="bg-gradient-to-br from-emerald-500 to-emerald-700 rounded-2xl p-6 text-white hover:shadow-lg transition-shadow"
        >
          <p className="text-lg font-bold mb-1">➕ Ajouter un serveur</p>
          <p className="text-sm text-emerald-100">
            Connectez votre VPS en 1 clé SSH
          </p>
        </Link>

        <Link
          href="/catalog"
          className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-2xl p-6 text-white hover:shadow-lg transition-shadow"
        >
          <p className="text-lg font-bold mb-1">🚀 Installer une app</p>
          <p className="text-sm text-blue-100">
            Parcourez le catalogue et déployez en 1 clic
          </p>
        </Link>
      </div>

      {/* Recent activity */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-4">
          Activité récente
        </h2>
        {(!servers || servers.length === 0) ? (
          <div className="text-center py-8 text-slate-400">
            <p className="mb-2 text-lg">♜</p>
            <p className="text-sm">
              Commencez par ajouter votre premier serveur.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.slice(0, 5).map((server) => (
              <div
                key={server.id}
                className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {server.name}
                  </p>
                  <p className="text-xs text-slate-500 font-mono">
                    {server.ip}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-lg ${
                    server.status === "connected"
                      ? "bg-emerald-50 text-emerald-700"
                      : server.status === "pending"
                      ? "bg-yellow-50 text-yellow-700"
                      : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {server.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
