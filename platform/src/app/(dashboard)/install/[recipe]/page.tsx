"use client";

import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useState, useMemo } from "react";

function copyToClipboard(text: string): boolean {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {}
  return false;
}

export default function InstallPage() {
  const { recipe: recipeId } = useParams<{ recipe: string }>();
  const router = useRouter();

  const { data: recipe, isLoading } = trpc.catalog.get.useQuery({ id: recipeId });
  const { data: servers } = trpc.server.list.useQuery();

  const [selectedServer, setSelectedServer] = useState("");
  const [domain, setDomain] = useState("");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("Changeme123");
  const [useCredentials, setUseCredentials] = useState(false);
  const [copied, setCopied] = useState(false);

  const defaultPort = useMemo(() => {
    if (!recipe) return 80;
    const p = (recipe as any).params?.port?.default;
    return p || 80;
  }, [recipe]);

  const selectedServerData = servers?.find((s) => s.id === selectedServer);

  const prompt = useMemo(() => {
    if (!recipe || !selectedServer) return "";

    const appName = recipe.name || recipeId;
    const serverName = selectedServerData?.name || selectedServer;
    const serverIp = selectedServerData?.ip || "";
    const finalPort = port || String(defaultPort);
    const hasDomain = domain.trim().length > 0;
    const hasCreds = useCredentials;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://srvly.app";

    let parts: string[] = [];
    parts.push(`Use srvly skill and install **${appName}** on server **${serverName}** (${serverIp})`);

    if (hasDomain) {
      parts.push(`with domain **${domain.trim()}**`);
    } else {
      parts.push(`on port **${finalPort}** (http://${serverIp}:${finalPort})`);
    }

    if (hasCreds) {
      parts.push(`with username **${username}** and password **${password}**`);
    }

    const ghLink = (recipe as any)?.recipe?.links?.find?.((l: any) => l.label?.toLowerCase().includes("github"))?.url || "";
    const defaultImage = (recipe as any)?.recipe?.params?.image?.default || recipeId;

    let fullPrompt = parts.join(" ") + ".\n\n";
    fullPrompt += "Use the API :\n";
    fullPrompt += `POST ${baseUrl}/api/agent/docker/deploy\n`;
    fullPrompt += `Body: { "serverId": "${selectedServer}", "name": "${appName}", "image": "${defaultImage}", "port": ${finalPort}`;
    if (hasDomain) fullPrompt += `, "domain": "${domain.trim()}"`;
    fullPrompt += ` }\n\n`;
    fullPrompt += `The token is sent in the header: Authorization: Bearer ***`;
    fullPrompt += `\n\n`;
    fullPrompt += `Consult the GitHub docs: ${ghLink || "https://github.com"} for environment-specific variables if needed.`;

    return fullPrompt;
  }, [recipe, recipeId, selectedServer, selectedServerData, domain, port, defaultPort, username, password, useCredentials]);

  const copyPrompt = () => {
    if (copyToClipboard(prompt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) return <div className="text-slate-400 py-8">Loading...</div>;
  if (!recipe) return <div className="text-slate-500 py-8">Application not found</div>;

  const recipeData = (recipe as any).recipe || {};

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push("/catalog")} className="text-sm text-emerald-600 hover:text-emerald-700 mb-2 block">
          ← Back to catalog
        </button>
        <h1 className="text-2xl font-bold text-slate-900">{recipe.name}</h1>
        <p className="text-sm text-slate-500 mt-1">{recipe.description?.slice(0, 200)}</p>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6 space-y-5">
        <h2 className="font-semibold text-slate-900">Installation parameters</h2>

        {/* Server */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Server</label>
          {servers?.filter((s) => s.status === "connected").length === 0 ? (
            <div className="bg-amber-50 text-amber-700 text-sm p-3 rounded-xl border border-amber-200">
              No connected servers. <a href="/servers" className="underline">Add one first.</a>
            </div>
          ) : (
            <select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
            >
              <option value="">Select a server...</option>
              {servers?.filter((s) => s.status === "connected").map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.ip})
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Domain */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Domain (optional)</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={`${selectedServerData?.ip || "ip"}:${port || defaultPort} (default)`}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-slate-400 mt-1">Leave empty to use IP and port directly.</p>
        </div>

        {/* Port */}
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(defaultPort)}
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-slate-400 mt-1">Default: {defaultPort}. Leave empty to use the default port.</p>
        </div>

        {/* Credentials toggle */}
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="useCreds"
            checked={useCredentials}
            onChange={(e) => setUseCredentials(e.target.checked)}
            className="w-4 h-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
          />
          <label htmlFor="useCreds" className="text-sm font-medium text-slate-700">
            Set a username / password (optional)
          </label>
        </div>

        {useCredentials && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}

        {/* Links */}
        {(recipeData as any)?.links?.length > 0 && (
          <div className="text-xs text-slate-400">
            Useful links:{" "}
            {(recipeData as any).links.map((l: any, i: number) => (
              <a key={i} href={l.url} target="_blank" className="text-emerald-600 hover:underline ml-2">
                {l.label || l.url}
              </a>
            ))}
          </div>
        )}
      </div>

      {/* Prompt output */}
      {prompt && (
        <div className="bg-slate-900 rounded-2xl p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-200">Prompt to copy for your agent</h3>
            <button
              onClick={copyPrompt}
              className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <pre className="text-sm font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed">
            {prompt}
          </pre>
        </div>
      )}

      {/* Empty state */}
      {!selectedServer && (
        <div className="bg-slate-50 rounded-2xl p-8 text-center border border-dashed border-slate-200">
          <p className="text-3xl mb-2">👆</p>
          <p className="text-sm text-slate-500">
            Select a server to generate the installation prompt.
          </p>
        </div>
      )}
    </div>
  );
}
