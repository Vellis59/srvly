"use client";

import { trpc } from "@/lib/trpc";
import { useParams } from "next/navigation";
import { useState } from "react";

const TUNNEL_URL = "http://185.197.251.176:8080";

// Action recipes
const ACTIONS: Record<string, { label: string; desc: string; icon: string; script: string; color: string }> = {
  security: {
    label: "Sécuriser le serveur",
    desc: "Firewall UFW, SSH hardening, fail2ban",
    icon: "🛡️",
    color: "bg-blue-500",
    script: `apt-get update -qq && apt-get install -y -qq ufw fail2ban 2>/dev/null
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose
echo "---SSH HARDENING---"
sed -i 's/#PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
sed -i 's/#PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart sshd
echo "SECURITY DONE"`,
  },
  docker: {
    label: "Installer Docker",
    desc: "Docker Engine + Docker Compose",
    icon: "🐳",
    color: "bg-sky-500",
    script: `curl -fsSL https://get.docker.com | bash
systemctl enable docker
systemctl start docker
docker --version
docker compose version
echo "DOCKER DONE"`,
  },
  nginx: {
    label: "Installer Nginx",
    desc: "Nginx + configuration de base",
    icon: "🌐",
    color: "bg-emerald-500",
    script: `apt-get update -qq && apt-get install -y -qq nginx
systemctl enable nginx
systemctl start nginx
mkdir -p /etc/nginx/sites-enabled
echo 'server {
    listen 80 default_server;
    server_name _;
    root /var/www/html;
    index index.html;
    location / { try_files $uri $uri/ =404; }
}' > /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
echo "NGINX DONE"`,
  },
  ssl: {
    label: "Configurer SSL",
    desc: "Certbot + Let's Encrypt",
    icon: "🔒",
    color: "bg-purple-500",
    script: `apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
echo "SSL TOOLING INSTALLED"
echo "Run: certbot --nginx -d votre-domaine.com"`,
  },
};

function ActionCard({ action, onRun, loading }: {
  action: keyof typeof ACTIONS;
  onRun: (action: keyof typeof ACTIONS) => void;
  loading: boolean;
}) {
  const a = ACTIONS[action];
  return (
    <button
      onClick={() => onRun(action)}
      disabled={loading}
      className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-emerald-300 transition-all text-left disabled:opacity-50 w-full"
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 ${a.color} rounded-xl flex items-center justify-center text-2xl flex-shrink-0`}>
          {a.icon}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900">{a.label}</h3>
          <p className="text-sm text-slate-500 mt-0.5">{a.desc}</p>
        </div>
        {loading && (
          <div className="animate-spin w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full" />
        )}
      </div>
    </button>
  );
}

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: server, isLoading, refetch } = trpc.server.get.useQuery({ id });
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  const runAction = async (action: keyof typeof ACTIONS) => {
    setRunning(action);
    setResults((prev) => ({ ...prev, [action]: "Exécution en cours..." }));

    try {
      const res = await fetch(`${TUNNEL_URL}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: `action-${action}-${Date.now()}`,
          script: ACTIONS[action].script,
          timeout: 120,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setResults((prev) => ({ ...prev, [action]: data.output || "✅ Terminé" }));
      } else {
        setResults((prev) => ({ ...prev, [action]: `❌ Erreur: ${data.error || data.output || "inconnue"}` }));
      }
    } catch (err: any) {
      setResults((prev) => ({ ...prev, [action]: `❌ Erreur de connexion: ${err.message}` }));
    }

    setRunning(null);
  };

  if (isLoading) return <div className="text-slate-400">Chargement...</div>;
  if (!server) return <div className="text-slate-500">Serveur introuvable</div>;

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
    <div>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold text-slate-900">{server.name}</h1>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${statusColors[server.status] || "bg-slate-400"}`} />
            <span className="text-sm font-medium text-slate-600">
              {statusLabels[server.status] || server.status}
            </span>
          </div>
        </div>
        <p className="text-sm text-slate-500 font-mono">{server.ip}</p>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">OS</p>
          <p className="text-sm font-medium">{server.os || "Non détecté"}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">RAM</p>
          <p className="text-sm font-medium">
            {server.ram ? (server.ram >= 1024 ? `${(server.ram / 1024).toFixed(1)} Go` : `${server.ram} Mo`) : "Non détecté"}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Token</p>
          <p className="text-sm font-mono text-emerald-600 text-xs truncate">{server.agentToken}</p>
        </div>
      </div>

      {/* Actions grid */}
      {server.status === "connected" && (
        <>
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Actions disponibles</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
            {(Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).map((action) => (
              <ActionCard
                key={action}
                action={action}
                onRun={runAction}
                loading={running === action}
              />
            ))}
          </div>

          {/* Results */}
          {Object.entries(results).length > 0 && (
            <div className="space-y-4 mb-8">
              <h2 className="text-lg font-semibold text-slate-900">Résultats</h2>
              {Object.entries(results).map(([action, output]) => (
                <div key={action} className="bg-slate-900 rounded-2xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-medium text-slate-400 uppercase">
                      {ACTIONS[action]?.label || action}
                    </span>
                  </div>
                  <pre className="text-xs font-mono text-slate-100 whitespace-pre-wrap overflow-x-auto max-h-60 overflow-y-auto">
                    {output}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {/* Domain section */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">🌐 Domaines</h2>
            <p className="text-sm text-slate-500 mb-4">
              Associez un domaine à votre serveur pour exposer vos apps en HTTPS.
            </p>
            <div className="flex gap-3">
              <input
                type="text"
                placeholder="mon-domaine.com"
                className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <button className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors">
                Ajouter
              </button>
            </div>
          </div>
        </>
      )}

      {/* Not connected message */}
      {server.status !== "connected" && (
        <div className="bg-amber-50 rounded-2xl p-8 text-center border border-amber-200">
          <p className="text-4xl mb-3">⏳</p>
          <h2 className="text-lg font-semibold text-amber-800 mb-1">Serveur en attente</h2>
          <p className="text-sm text-amber-600">
            Installe l'agent Go sur le serveur pour activer les actions.
          </p>
        </div>
      )}
    </div>
  );
}
