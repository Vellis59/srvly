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

  const promptText = [
    'Sur srvly, cree un skill "srvly-agent" avec ma configuration :',
    "",
    "Token API : " + (tokenData?.token || ""),
    "API URL : " + baseUrl,
    "",
    "Role: you are my installation agent.",
    "",
    "When I ask you to install an application:",
    "1. Load the srvly-agent skill",
    "2. Execute Docker commands via API SSH",
    "3. Consult the GitHub docs of the app if needed",
    "4. Configure the domain and SSL if requested",
    "5. Register the installation via the REST API",
    "6. Confirm when done",
    "",
    "REST API endpoints:",
    "- POST " + baseUrl + "/api/agent/docker/deploy (RECOMMENDED - complete install in 1 call)",
    "  Body: { serverId, name, image, port, domain?, env?:{}, volumes?:[] }",
    "  Installs + configures nginx + registers, all in one SSH call",
    "- POST " + baseUrl + "/api/agent/install/register",
    "  Body: { serverId, name, port?, domain?, image?, containerName? }",
    "- GET " + baseUrl + "/api/agent/install/list?serverId=xxx",
    "",
    "Le token s envoie dans le header: Authorization: Bearer ***",
  ].join("\n");

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
        </p>

        {isLoading ? (
          <div className="text-sm text-slate-400">Chargement...</div>
        ) : (
          <>
            <div className="bg-slate-900 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm font-mono text-emerald-400 break-all flex-1">
                  {tokenData?.token || "---"}
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
          <pre className="text-sm font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed mb-4">{promptText}</pre>
          <button
            onClick={() => handleCopy(promptText)}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            {copied ? "Copie !" : "Copier le prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
