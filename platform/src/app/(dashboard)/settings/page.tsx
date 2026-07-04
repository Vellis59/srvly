"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";

function copyToClipboard(text: string): boolean {
  // Fallback for HTTP (navigator.clipboard requires HTTPS)
  try {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  // Fallback: create a hidden textarea
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

export default function SettingsPage() {
  const { data: session } = useSession();
  const { data: tokenData, isLoading, refetch } = trpc.user.getToken.useQuery();
  const { data: plan } = trpc.user.getPlan.useQuery();
  const saveWebhook = trpc.user.saveWebhookUrl.useMutation();
  const regenerate = trpc.user.regenerateToken.useMutation();
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookMention, setWebhookMention] = useState("");
  const [webhookMsg, setWebhookMsg] = useState("");
  const [webhookInit, setWebhookInit] = useState(false);

  // Sync webhookUrl from plan when it loads
  if (plan && !webhookInit) {
    setWebhookUrl(plan.webhookUrl || "");
    setWebhookMention(plan.webhookMention || "");
    setWebhookInit(true);
  }

  const baseUrl = typeof window !== "undefined" ? window.location.origin : "https://srvly.app";

  if (!session) return null;

  const handleRegenerate = async () => {
    if (!confirm("Regenerate the token? The old one will stop working.")) return;
    setRegenerating(true);
    try {
      await regenerate.mutateAsync();
      await refetch();
    } catch {}
    setRegenerating(false);
  };

  const handleSaveWebhook = async () => {
    setWebhookMsg("");
    try {
      await saveWebhook.mutateAsync({ url: webhookUrl.trim() || null, mention: webhookMention.trim() || null });
      setWebhookMsg("Webhook URL saved!");
      setTimeout(() => setWebhookMsg(""), 3000);
    } catch (err: any) {
      setWebhookMsg("Error: " + err.message);
    }
  };

  const handleCopyToken = () => {
    if (copyToClipboard(tokenData?.token || "")) {
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleCopyPrompt = () => {
    if (copyToClipboard(promptText)) {
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    }
  };

  const promptText = [
    'On srvly, create a skill "srvly-agent" with my configuration:',
    "",
    "Token API: " + (tokenData?.token || ""),
    "API URL: " + baseUrl,
    "",
    "## Role",
    "You are my installation and management agent for srvly. You install Docker applications on my servers via the srvly API.",
    "",
    "## 🚫 STRICT RULES — NEVER DO THESE",
    "",
    "1. **NEVER modify SSH configuration** — Do not touch /etc/ssh/sshd_config, ~/.ssh/authorized_keys, ssh keys, or any SSH-related files.",
    "2. **NEVER touch the firewall** — Do not run ufw, iptables, nftables, firewalld, or any firewall command. Never enable/disable/modify firewall rules.",
    "3. **NEVER touch Fail2Ban, PAM, sudoers, or system security** — Do not modify any security configuration files.",
    "4. **NEVER run generic \"server hardening\" or \"setup\" scripts** — These often break SSH access or firewall rules.",
    "5. **NEVER modify systemd services or restart critical system services** (ssh, networking, ufw, fail2ban).",
    "6. **NEVER run a system update/dist-upgrade** unless explicitly requested by the user.",
    "7. **NEVER expose ports other than the application port** — Do not open firewall ports manually.",
    "",
    "## ✅ What you CAN do",
    "",
    "1. Install Docker applications using the srvly API (recommended) or via direct Docker commands.",
    "2. Use `docker pull`, `docker run`, `docker stop`, `docker start`, `docker rm` as needed.",
    "3. Create directories under /opt/srvly/ for app data if needed.",
    "4. Read and write application configuration files (e.g. .env, yaml) using the file endpoints (much safer than cat/echo shell commands).",
    "5. Install ONLY the specific system prerequisites required by the app (e.g., `apt install nodejs` if the app requires Node.js).",
    "6. Restart the application container only (never system containers or daemons).",
    "",
    "## ⚠️ RISK WARNINGS — When installing sensitive apps",
    "",
    "Some applications have elevated risk. Before proceeding, explain the risk to the user:",
    "",
    "- **Apps that bind to privileged ports (<1024):** Explain that the app will listen on a privileged port and may need capabilities.",
    "- **Apps that modify network configuration** (VPN, DNS, proxy, reverse proxy): Explain they can disrupt connectivity.",
    "- **Apps that require host network mode** (--network=host): Explain reduced isolation.",
    "- **Apps with system-level access** (monitoring agents, kernel modules, system tools): Explain they have broad access to the server.",
    "- **Apps that create system users or modify /etc:** Explain the scope.",
    "",
    "When you detect a risky app, output a clear warning like:",
    "\"⚠️ This app requires [specific risk]. This can [impact]. I recommend [mitigation]. Proceed?\"",
    "",
    "## Installation workflow",
    "",
    "When I ask you to install an application:",
    "1. Load the srvly-agent skill",
    "2. Parse the app install plan, especially `agent_install` (network, preflight, prerequisites, app_env, post_install)",
    "3. If the app has prerequisites, create them first with POST " + baseUrl + "/api/dispatch using { serverId, script, timeout }. Use timeout: 120 by default for Docker pulls or database/cache prerequisites.",
    "4. Do NOT use /api/agent/install/exec for pre-install prerequisites because it requires an existing installationId",
    "5. Deploy the final app container with POST " + baseUrl + "/api/agent/docker/deploy using the recipe image, port, env and volumes",
    "6. For Node.js/Sails.js/frontend apps, preserve recipe public URL variables such as BASE_URL, PUBLIC_URL, APP_URL, or similar. Use https://domain when a domain is configured, otherwise http://server-ip:host-port.",
    "7. Run an independent post-deploy healthcheck after docker/deploy returns; do not rely only on the API response",
    "8. If the response is HTML, inspect rendered asset URLs/base URLs and ensure they point to the public URL or relative paths, not localhost/127.0.0.1",
    "9. If a domain is configured, verify HTTPS is reachable after Caddy reload before reporting success",
    "10. Configure domain/SSL if requested (via Caddy, never manually configure nginx)",
    "11. Confirm when done and provide access URL",
    "",
    "## API Documentation",
    "You can retrieve the complete OpenAPI 3.0 specification at: **GET " + baseUrl + "/api/agent/openapi.json**.",
    "Read this spec to discover all requirements for request payloads and response shapes.",
    "",
    "## Core REST API Endpoints",
    "",
    "- **POST " + baseUrl + "/api/agent/docker/deploy** (RECOMMENDED — complete install in 1 call)",
    "  Body: { serverId, name, image, port, domain?, network?, env?:{}, volumes?:[] }",
    "  Does: pull → run → register. Can also configure Caddy reverse proxy for the domain.",
    "- **POST " + baseUrl + "/api/dispatch**",
    "  Body: { serverId, script, timeout? }",
    "  Use before docker/deploy for prerequisite Docker networks, databases, caches, or one-off host commands required by `agent_install`.",
    "- **GET " + baseUrl + "/api/agent/servers/{id}/containers**",
    "  Returns a structured list of containers, active ports, disk space, and memory info.",
    "- **POST " + baseUrl + "/api/agent/files/write**",
    "  Body: { serverId, path, content, mode? } (Writes files safely on the server without shell escaping issues)",
    "- **POST " + baseUrl + "/api/agent/files/read**",
    "  Body: { serverId, path } (Reads files securely and returns text/base64 content)",
    "- **POST " + baseUrl + "/api/agent/install/register**",
    "  Body: { serverId, name, port?, domain?, image?, containerName? }",
    "- **GET " + baseUrl + "/api/agent/install?serverId=xxx**",
    "",
    "## Authentication",
    "All requests must include the header: Authorization: Bearer <Token API>",
    "",
    "## Golden rule",
    "If you are unsure whether a command is safe, ask the user before executing it. It is better to ask than to break server access."
  ].join("\n");

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-zinc-100 mb-6">Settings</h1>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-zinc-100 mb-4">Profile</h2>
        <p className="text-sm text-zinc-500">
          Signed in as <strong>{session.user?.name || session.user?.email}</strong>
        </p>
      </div>

      {/* Plan */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-zinc-100 mb-4">Plan</h2>
        {plan ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-zinc-300">
                <span className="capitalize font-medium text-zinc-100">{plan.plan}</span> plan
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {plan.currentServers} / {plan.maxServers} server{plan.maxServers !== 1 ? "s" : ""} used
              </p>
            </div>
            <Link href="/pricing"
              className="text-xs bg-zinc-800 hover:bg-zinc-700 text-emerald-400 px-3 py-1.5 rounded-lg font-medium transition-colors">
              {plan.plan === "free" && plan.currentServers >= plan.maxServers ? "Upgrade →" : "Compare plans"}
            </Link>
          </div>
        ) : (
          <div className="text-sm text-zinc-400">Loading...</div>
        )}
      </div>

      {/* Agent Webhook */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-6">
        <h2 className="font-semibold text-zinc-100 mb-1">🤖 Agent Integration</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Set a webhook URL to send installation prompts directly to your AI agent (Mattermost, Discord, Slack, or any HTTP endpoint).
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://mattermost.example.com/hooks/xxx"
            className="flex-1 px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <button onClick={handleSaveWebhook} disabled={saveWebhook.isPending}
            className="px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors shrink-0">
            {saveWebhook.isPending ? "Saving..." : webhookUrl === plan?.webhookUrl && webhookMention === plan?.webhookMention ? "Saved ✓" : "Save"}
          </button>
        </div>
        <div className="flex gap-2 mt-2">
          <input
            type="text"
            value={webhookMention}
            onChange={(e) => setWebhookMention(e.target.value)}
            placeholder="Agent username (e.g. my-agent)"
            className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
          <span className="text-xs text-zinc-500 self-center shrink-0 whitespace-nowrap">Will send as @mention</span>
        </div>
        {webhookMsg && <p className={`text-xs mt-2 ${webhookMsg.includes("Error") ? "text-red-400" : "text-emerald-400"}`}>{webhookMsg}</p>}
        <p className="text-xs text-zinc-500 mt-2">
          <a href="https://docs.srvly.app/guide/agent-webhook" target="_blank" className="text-emerald-400 hover:underline">Learn how to set this up →</a>
        </p>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl  p-6 mb-6">
        <h2 className="font-semibold text-zinc-100 mb-1">API Token</h2>
        <p className="text-sm text-zinc-500 mb-4">
          Use this token to connect your AI agent (Hermes, OpenCLAW...) to srvly.
        </p>

        {isLoading ? (
          <div className="text-sm text-zinc-400">Loading...</div>
        ) : (
          <>
            <div className="text-zinc-950 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <code className="text-sm font-mono text-emerald-400 break-all flex-1">
                  {tokenData?.token || "---"}
                </code>
                <button
                  onClick={handleCopyToken}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 shrink-0"
                >
                  {copiedToken ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">
                Do not share this token. Regenerate it if you think it leaked.
              </p>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
              >
                {regenerating ? "..." : "Regenerate"}
              </button>
            </div>
          </>
        )}
      </div>

      {tokenData?.token && (
        <div className="text-zinc-950 rounded-2xl p-6 mb-6">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Prompt for your agent</h2>
          <pre className="text-sm font-mono text-slate-100 whitespace-pre-wrap break-words leading-relaxed mb-4">{promptText}</pre>
          <button
            onClick={handleCopyPrompt}
            className="px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            {copiedPrompt ? "Copied!" : "Copy prompt"}
          </button>
        </div>
      )}
    </div>
  );
}
