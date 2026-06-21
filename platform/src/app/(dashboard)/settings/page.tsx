"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: tokenData, isLoading, refetch } = trpc.user.getToken.useQuery();
  const regenerate = trpc.user.regenerateToken.useMutation();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://srvly.app";

  if (!session) return null;

  const handleRegenerate = async () => {
    if (!confirm("Regenerer le token ? L'ancien ne fonctionnera plus.")) return;
    setRegenerating(true);
    try {
      await regenerate.mutateAsync();
      await refetch();
    } catch {}
    setRegenerating(false);
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Parametres</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Profil</h2>
        <p className="text-sm text-slate-600">
          Connecte en tant que <strong>{session.user?.name || session.user?.email}</strong>
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-1">Token API</h2>
        <p className="text-sm text-slate-500 mb-4">
          Utilise ce token pour connecter ton agent IA (Hermes, OpenCLAW...) a srvly.
          L agent l utilise dans le header <code className="bg-slate-100 px-1 rounded">Authorization: Bearer &lt;token&gt;</code>.
        </p>

        {isLoading ? (
          <div className="text-sm text-slate-400">Chargement...</div>
        ) : (
          <>
            <div className="bg-slate-900 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm font-mono text-emerald-400 break-all flex-1">
                  {tokenData?.token || "—"}
                </code>
                <button
                  onClick={() => handleCopy(tokenData?.token || "")}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 shrink-0"
                >
                  {copied ? "Copie" : "Copier"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                Ne partage pas ce token. Regener-le si tu penses qu il a fuite.
              </p>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                {regenerating ? "..." : "Regenerer"}
              </button>
            </div>
          </>
        )}
      </div>

      {tokenData?.token && (
        <div className="bg-slate-900 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Prompt pour ton agent</h2>
          <pre className="text-sm font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed mb-4">
{`Sur srvly, cree un skill "srvly-agent" avec ma configuration :

Token API : ${tokenData.token}
API URL : ${baseUrl}

Role : tu es mon agent d installation.

Quand je te demande d installer une application :
1. Charge le skill srvly-agent
2. Execute les commandes Docker via l API (server.execute)
3. Consulte la doc GitHub de l app si besoin
4. Configure le domaine et le SSL si demande
5. Enregistre l installation via l API (install.register)
6. Confirme quand c est fait

Endpoints API (format REST simple) :
- POST /api/agent/install/register
  Body: { serverId, name, port?, domain?, image?, containerName? }
- GET /api/agent/install/list?serverId=xxx

Le token s envoie dans le header: Authorization: Bearer ***          </pre>
          </pre>
          <button
            onClick={() => handleCopy(`Sur srvly, configure mon acces.\n\nToken API : ${tokenData.token}\nAPI URL : ${baseUrl}\n\nRole : tu es mon agent d installation.\n\nQuand je te demande d installer une application :\n1. Execute les commandes Docker via l API SSH\n2. Consulte la doc GitHub de l app si besoin\n3. Configure le domaine et le SSL si demande\n4. Enregistre l installation via l API REST\n5. Confirme quand c est fait\n\nEndpoints API REST :\n- POST /api/agent/install/register\n  Body: { serverId, name, port?, domain?, image?, containerName? }\n\nLe token s envoie dans le header: Authorization: Bearer <token>`)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            {copied ? "Copie !" : "Copier le prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
