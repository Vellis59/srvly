"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

type Server = {
  id: string;
  name: string;
  ip: string;
  status: string;
  os: string | null;
  ram: number | null;
  createdAt: Date | string;
};

function AddServerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const createServer = trpc.server.create.useMutation({
    onSuccess: (data) => {
      utils.server.list.invalidate();
      setCreatedServer(data);
    },
    onError: (err) => {
      alert("Erreur : " + err.message);
    },
  });
  const testConnection = trpc.server.testConnection.useMutation();
  const execute = trpc.server.execute.useMutation();
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [createdServer, setCreatedServer] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string>("");

  if (createdServer) {
    const handleTestConnection = async () => {
      setConnecting(true);
      setConnectStatus("Test de connexion SSH...");
      try {
        const result = await testConnection.mutateAsync({ id: createdServer.id });
        if (result.success) {
          setConnectStatus("✅ Connecté ! Nom du serveur : " + result.output.trim());
        } else {
          setConnectStatus("❌ " + (result.error || "Connexion échouée. Vérifie que la clé a bien été ajoutée au serveur."));
        }
      } catch (err: any) {
        setConnectStatus("❌ Erreur : " + err.message);
      }
      setConnecting(false);
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl">
          <div className="text-center mb-6">
            <p className="text-4xl mb-3">🎉</p>
            <h2 className="text-xl font-bold text-slate-900">Serveur ajouté !</h2>
            <p className="text-sm text-slate-500 mt-1">{createdServer.name}</p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-2">
            <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">
              🔑 Clé publique SSH
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {createdServer.sshPublicKey}
            </pre>
          </div>

          <div className="bg-amber-50 rounded-xl p-4 mb-6 border border-amber-200">
            <p className="text-xs text-amber-700 font-medium mb-2 uppercase tracking-wide">
              📋 Commande à exécuter sur votre serveur
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap">
{`# Copier-coller cette commande sur votre serveur :
# (en SSH ou via votre console)

echo '${createdServer.sshPublicKey}' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
mkdir -p /root/.ssh && chmod 700 /root/.ssh`}
            </pre>
            <p className="text-xs text-amber-600 mt-2">
              💡 Ou utilisez : <code className="bg-amber-100 px-1 rounded">curl -sL https://srvly.app/connect.sh | bash</code>
              (à venir)
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleTestConnection}
              disabled={connecting}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {connecting ? "🔌 Test en cours..." : "🔌 Tester la connexion"}
            </button>
            {connectStatus && (
              <p className="text-sm text-center text-slate-600">{connectStatus}</p>
            )}
            <button onClick={onClose}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              Terminé
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold mb-6">Nouveau serveur</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Nom du serveur
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Mon VPS Hetzner"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Adresse IP
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="123.123.123.123"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800 mb-1">
              Prochaine étape
            </p>
            <p>
              Après la création, un token sera généré. Vous installerez
              l'agent serveur sur votre serveur avec une commande 1-liner.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
            Annuler
          </button>
          <button
            onClick={() => createServer.mutate({ name, ip })}
            disabled={!name || !ip || createServer.isPending}
            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {createServer.isPending ? "Création..." : "Ajouter"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: Server }) {
  const statusColors: Record<string, string> = {
    pending: "bg-yellow-400",
    connected: "bg-emerald-500",
    disconnected: "bg-slate-400",
    error: "bg-red-500",
  };

  const statusLabels: Record<string, string> = {
    pending: "En attente",
    connected: "Connecté",
    disconnected: "Déconnecté",
    error: "Erreur",
  };

  return (
    <Link href={`/servers/${server.id}`}
      className="block bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-emerald-300 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-900">{server.name}</h3>
          <p className="text-sm text-slate-500 font-mono mt-0.5">
            {server.ip}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              statusColors[server.status] || "bg-slate-400"
            }`}
          />
          <span className="text-xs font-medium text-slate-600">
            {statusLabels[server.status] || server.status}
          </span>
        </div>
      </div>

      <div className="flex gap-4 text-sm text-slate-500">
        {server.os && (
          <span className="bg-slate-100 px-2 py-1 rounded-lg">{server.os}</span>
        )}
        {server.ram && (
          <span className="bg-slate-100 px-2 py-1 rounded-lg">
            {server.ram >= 1024
              ? `${(server.ram / 1024).toFixed(1)} Go`
              : `${server.ram} Mo`}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function ServersPage() {
  const { data: session } = useSession();
  const [showAdd, setShowAdd] = useState(false);
  const { data: servers, isLoading } = trpc.server.list.useQuery();

  if (!session) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Serveurs</h1>
          <p className="text-slate-500 mt-1">
            Gérez vos serveurs connectés à la plateforme
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          + Nouveau serveur
        </button>
      </div>

      {isLoading ? (
        <div className="text-slate-400">Chargement...</div>
      ) : servers && servers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-12 text-center">
          <p className="text-5xl mb-4">♝</p>
          <h2 className="text-lg font-semibold text-slate-700 mb-2">
            Aucun serveur
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Ajoutez votre premier VPS pour commencer à déployer des apps.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            + Ajouter un serveur
          </button>
        </div>
      )}

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
