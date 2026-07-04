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

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function envArrayToObject(env: any[] | undefined): Record<string, string> {
  if (!Array.isArray(env)) return {};
  return env.reduce((acc: Record<string, string>, item: any) => {
    if (item?.key) acc[item.key] = String(item.value ?? "");
    return acc;
  }, {});
}

function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
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

    const recipeData = (recipe as any).recipe || {};
    const docker = recipeData.install?.docker || {};
    const agentPlan = recipeData.agent_install || {};
    const healthcheck = recipeData.healthcheck || {};
    const appName = recipe.name || recipeId;
    const appSlug = slugify(docker.name || appName || recipeId);
    const serverName = selectedServerData?.name || selectedServer;
    const serverIp = selectedServerData?.ip || "";
    const finalPort = port || String(defaultPort);
    const hasDomain = domain.trim().length > 0;
    const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://srvly.app";
    const defaultImage = recipeData.params?.image?.default || docker.image || recipeId;
    const internalPort = String(docker.port || `${finalPort}:${finalPort}`).split(":").pop() || finalPort;
    const network = agentPlan.network || `srvly-${appSlug}`;
    const dockerEnv = envArrayToObject(docker.env);
    const agentEnv = agentPlan.app_env || {};
    const appEnv = { ...dockerEnv, ...agentEnv };
    const volumes = Array.isArray(docker.volumes) ? docker.volumes : [];
    const prerequisites = Array.isArray(agentPlan.prerequisites) ? agentPlan.prerequisites : [];
    const githubLink = recipeData.links?.find?.((l: any) => l.label?.toLowerCase().includes("github"))?.url || recipeData.metadata?.homepage || "";

    if (useCredentials) {
      appEnv.ADMIN_USER = username;
      appEnv.ADMIN_PASSWORD = password;
    }

    const deployPayload: Record<string, any> = {
      serverId: selectedServer,
      name: appSlug,
      image: defaultImage,
      port: parseInt(finalPort, 10) || defaultPort,
      network,
      env: appEnv,
      volumes,
    };
    if (hasDomain) deployPayload.domain = domain.trim();

    let fullPrompt = `Install **${appName}** on server **${serverName}** (${serverIp}).`;
    fullPrompt += hasDomain ? ` Use domain **${domain.trim()}**.\n\n` : ` Use host port **${finalPort}** (http://${serverIp}:${finalPort}).\n\n`;

    fullPrompt += "## Mandatory rules\n";
    fullPrompt += "- Use the srvly REST API. Do not SSH manually unless the API endpoint explicitly executes a command for you.\n";
    fullPrompt += "- Do not modify SSH, firewall, Fail2Ban, sudoers, PAM, systemd, apt packages, or host security settings.\n";
    fullPrompt += "- Do not invent Docker images, variables, ports, or dependencies. Follow the install plan below exactly.\n";
    fullPrompt += "- Generate required secrets at runtime, keep them private, and do not print them in the final answer.\n";
    fullPrompt += "- Do not register the installation as successful until the healthcheck passes.\n\n";

    fullPrompt += "## srvly API context\n";
    fullPrompt += `Base URL: ${baseUrl}\n`;
    fullPrompt += "Authentication: send the srvly API token as a Bearer token on every agent API request.\n";
    fullPrompt += "Use `/api/dispatch` for pre-install host commands such as Docker network creation or prerequisite database/cache containers.\n";
    fullPrompt += "Use `/api/agent/docker/deploy` for the final application container.\n";
    fullPrompt += `Server ID: ${selectedServer}\n\n`;

    fullPrompt += "## Recipe install plan\n";
    fullPrompt += `App ID: ${recipeId}\n`;
    fullPrompt += `Container name: ${appSlug}\n`;
    fullPrompt += `Docker image: ${defaultImage}\n`;
    fullPrompt += `Docker network: ${network}\n`;
    fullPrompt += `Host port: ${finalPort}\n`;
    fullPrompt += `Container port: ${internalPort}\n`;
    if (githubLink) fullPrompt += `Reference docs: ${githubLink}\n`;
    fullPrompt += "\n";

    fullPrompt += "### 1. Preflight\n";
    fullPrompt += `- GET ${baseUrl}/api/agent/servers/${selectedServer}/containers and verify that host port ${finalPort} is free. If it is occupied, choose the next free port and update the deploy payload.\n`;
    fullPrompt += `- GET ${baseUrl}/api/agent/install?serverId=${selectedServer} and avoid duplicate installation records.\n`;
    for (const item of agentPlan.preflight || []) fullPrompt += `- ${item}\n`;
    fullPrompt += "\n";

    fullPrompt += "### 2. Create prerequisites first\n";
    if (prerequisites.length === 0) {
      fullPrompt += "No external database/cache prerequisite is required for this app.\n\n";
    } else {
      fullPrompt += "Create these prerequisites before the app container. Use `POST /api/dispatch` with `{ serverId, script, timeout }` to create networks and prerequisite containers. Use `timeout: 120` by default for Docker pulls or database/cache prerequisites.\n";
      fullPrompt += "Do not use `/api/agent/install/exec` for pre-install prerequisites: it requires an existing installationId.\n";
      fullPrompt += "Generate every value marked `generate` yourself at runtime and reuse it in the app env mapping.\n";
      fullPrompt += `\`\`\`json\n${renderJson(prerequisites)}\n\`\`\`\n\n`;
    }

    fullPrompt += "### 3. Deploy the application container\n";
    fullPrompt += `POST ${baseUrl}/api/agent/docker/deploy\n`;
    fullPrompt += "Use this body, replacing generated placeholders and the port if preflight selected a different one:\n";
    fullPrompt += `\`\`\`json\n${renderJson(deployPayload)}\n\`\`\`\n\n`;

    fullPrompt += "### 4. Post-install actions\n";
    for (const item of agentPlan.post_install || []) fullPrompt += `- ${item}\n`;
    fullPrompt += "\n";

    fullPrompt += "### 5. Healthcheck\n";
    fullPrompt += `Type: ${healthcheck.type || "http"}\n`;
    fullPrompt += `URL: http://${serverIp}:${finalPort}${healthcheck.path || "/"}\n`;
    fullPrompt += `Expected status: ${(healthcheck.expected || [200]).join(", ")}\n`;
    fullPrompt += `Timeout: ${healthcheck.timeout || 60}s\n`;
    fullPrompt += "After docker/deploy returns, run an independent post-deploy healthcheck yourself instead of relying only on the API response. Retry for slow-starting apps.\n";
    if (hasDomain) fullPrompt += `Also verify HTTPS externally: https://${domain.trim()} must return a real HTTP status before reporting success.\n`;
    fullPrompt += "If the healthcheck fails, fetch logs, fix the root cause, retry, and only then report back.\n\n";

    fullPrompt += "## Final response\n";
    fullPrompt += "Tell the user the final access URL, whether the healthcheck passed, and mention any generated credentials only if the app requires the user to save them. Do not expose database passwords.\n";

    return fullPrompt;
  }, [recipe, recipeId, selectedServer, selectedServerData, domain, port, defaultPort, username, password, useCredentials]);

  const copyPrompt = () => {
    if (copyToClipboard(prompt)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) return <div className="text-zinc-400 py-8">Loading...</div>;
  if (!recipe) return <div className="text-zinc-500 py-8">Application not found</div>;

  const recipeData = (recipe as any).recipe || {};

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <button onClick={() => router.push("/catalog")} className="text-sm text-emerald-600 hover:text-emerald-400 mb-2 block">
          ← Back to catalog
        </button>
        <h1 className="text-2xl font-bold text-zinc-100">{recipe.name}</h1>
        <p className="text-sm text-zinc-500 mt-1 leading-relaxed">{recipe.description}</p>
      </div>

      {/* Form */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-700 p-6 mb-6 space-y-5">
        <h2 className="font-semibold text-zinc-100">Installation parameters</h2>

        {/* Server */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Server</label>
          {servers?.filter((s) => s.status === "connected").length === 0 ? (
            <div className="bg-zinc-800 text-amber-400 text-sm p-3 rounded-xl border border-amber-200">
              No connected servers. <a href="/servers" className="underline">Add one first.</a>
            </div>
          ) : (
            <select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="w-full px-4 py-2.5 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-zinc-900"
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
          <label className="block text-sm font-medium text-zinc-300 mb-1">Domain (optional)</label>
          <input
            type="text"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder={`${selectedServerData?.ip || "ip"}:${port || defaultPort} (default)`}
            className="w-full px-4 py-2.5 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-zinc-400 mt-1">Leave empty to use IP and port directly.</p>
        </div>

        {/* Port */}
        <div>
          <label className="block text-sm font-medium text-zinc-300 mb-1">Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder={String(defaultPort)}
            className="w-full px-4 py-2.5 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <p className="text-xs text-zinc-400 mt-1">Default: {defaultPort}. Leave empty to use the default port.</p>
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
          <label htmlFor="useCreds" className="text-sm font-medium text-zinc-300">
            Set a username / password (optional)
          </label>
        </div>

        {useCredentials && (
          <div className="grid grid-cols-2 gap-4 pl-6">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Username</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Password</label>
              <input
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>
        )}

        {/* Links */}
        {(recipeData as any)?.links?.length > 0 && (
          <div className="text-xs text-zinc-400">
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
        <div className="bg-zinc-800 rounded-2xl p-8 text-center border border-dashed border-zinc-700">
          <p className="text-3xl mb-2">👆</p>
          <p className="text-sm text-zinc-500">
            Select a server to generate the installation prompt.
          </p>
        </div>
      )}
    </div>
  );
}
