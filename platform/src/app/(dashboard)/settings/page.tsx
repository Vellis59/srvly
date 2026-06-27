"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useState } from "react";

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
  const regenerate = trpc.user.regenerateToken.useMutation();
  const [copiedToken, setCopiedToken] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

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
    "4. Install ONLY the specific system prerequisites required by the app (e.g., `apt install nodejs` if the app requires Node.js).",
    "5. Restart the application container only (never system containers or daemons).",
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
    "2. Parse the app requirements (Docker image, port, volumes, env vars)",
    "3. **Prefer POST " + baseUrl + "/api/agent/docker/deploy** (1-call API that pulls, runs, and registers)",
    "4. If the API is unavailable, use direct Docker commands + register via POST " + baseUrl + "/api/agent/install/register",
    "5. Configure domain/SSL if requested (via Caddy, never manually configure nginx)",
    "6. Confirm when done and provide access URL",
    "",
    "## REST API endpoints",
    "",
    "- **POST " + baseUrl + "/api/agent/docker/deploy** (RECOMMENDED — complete install in 1 call)",
    "  Body: { serverId, name, image, port, domain?, env?:{}, volumes?:[] }",
    "  Does: pull → run → register. Can also configure Caddy reverse proxy for the domain.",
    "- **POST " + baseUrl + "/api/agent/install/register**",
    "  Body: { serverId, name, port?, domain?, image?, containerName? }",
    "- **GET " + baseUrl + "/api/agent/install/list?serverId=xxx**",
    "",
    "## Authentication",
    "The token is sent in the header: Authorization: Bearer ***",
    "",
    "## Golden rule",
    "If you are unsure whether a command is safe, ask the user before executing it. It is better to ask than to break server access."
  ].join("\n");

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-4">Profile</h2>
        <p className="text-sm text-slate-600">
          Signed in as <strong>{session.user?.name || session.user?.email}</strong>
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <h2 className="font-semibold text-slate-900 mb-1">API Token</h2>
        <p className="text-sm text-slate-500 mb-4">
          Use this token to connect your AI agent (Hermes, OpenCLAW...) to srvly.
        </p>

        {isLoading ? (
          <div className="text-sm text-slate-400">Loading...</div>
        ) : (
          <>
            <div className="bg-slate-900 rounded-xl p-4 mb-4">
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
              <p className="text-xs text-slate-400">
                Do not share this token. Regenerate it if you think it leaked.
              </p>
              <button
                onClick={handleRegenerate}
                disabled={regenerating}
                className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
              >
                {regenerating ? "..." : "Regenerate"}
              </button>
            </div>
          </>
        )}
      </div>

      {tokenData?.token && (
        <div className="bg-slate-900 rounded-2xl p-6 mb-6">
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
