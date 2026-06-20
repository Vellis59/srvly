"use client";

import { trpc } from "@/lib/trpc";
import { useParams } from "next/navigation";

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: server, isLoading } = trpc.server.get.useQuery({ id });

  if (isLoading) return <div className="text-slate-400">Chargement...</div>;
  if (!server)
    return <div className="text-slate-500">Serveur introuvable</div>;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{server.name}</h1>
        <p className="text-slate-500 font-mono text-sm mt-1">{server.ip}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Informations</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Statut</dt>
              <dd className="text-sm font-medium">{server.status}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">OS</dt>
              <dd className="text-sm font-medium">{server.os || "—"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">RAM</dt>
              <dd className="text-sm font-medium">
                {server.ram ? `${server.ram} Mo` : "—"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-sm text-slate-500">Token agent</dt>
              <dd className="text-sm font-mono text-emerald-600 text-xs max-w-[200px] truncate">
                {server.agentToken}
              </dd>
            </div>
          </dl>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">
            Installation agent
          </h2>
          <p className="text-sm text-slate-600 mb-3">
            Exécutez cette commande sur votre serveur :
          </p>
          <pre className="bg-slate-900 text-slate-100 p-4 rounded-xl text-xs overflow-x-auto">
            {`curl -sL http://185.197.251.176:3000/agent.sh | bash -s -- \\\n  --token ${server.agentToken} \\\n  --server ws://185.197.251.176:8080/ws`}
          </pre>
        </div>
      </div>
    </div>
  );
}
