"use client";

import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

const ACTIONS: Record<string, { label: string; desc: string; icon: string; script: string; color: string }> = {
  security: {
    label: "Secure server",
    desc: "UFW firewall, SSH hardening, fail2ban",
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
    label: "Install Docker",
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
    label: "Install Nginx",
    desc: "Nginx + basic configuration",
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
    label: "Configure SSL",
    desc: "Certbot + Let's Encrypt",
    icon: "🔒",
    color: "bg-purple-500",
    script: `apt-get update -qq && apt-get install -y -qq certbot python3-certbot-nginx
echo "SSL TOOLING INSTALLED"
echo "Run: certbot --nginx -d your-domain.com"`,
  },
};

const QUICK_COMMANDS: Record<string, { label: string; cmd: string }> = {
  docker_ps: { label: "🐳 docker ps", cmd: "docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>&1 | head -30" },
  disk: { label: "💾 df -h", cmd: "df -h / && echo '---' && lsblk 2>/dev/null | head -10 || true" },
  memory: { label: "📊 free -h", cmd: "free -h && echo '---' && uptime" },
  all_apps: { label: "📦 All containers", cmd: "docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>&1 | head -40" },
  compose: { label: "📋 docker compose ps", cmd: "cd /opt 2>/dev/null && find . -name 'docker-compose*' -maxdepth 3 2>/dev/null | head -5; docker compose ls 2>/dev/null || true" },
  nginx_test: { label: "🌐 nginx -t", cmd: "nginx -t 2>&1 || true" },
};

// ─── Helper components ───

function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `${diffD}d ago`;
  return `${Math.floor(diffD / 30)}mo ago`;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-yellow-400",
    connected: "bg-emerald-500",
    installed: "bg-emerald-500",
    missing: "bg-slate-400",
    running: "bg-amber-400",
    success: "bg-emerald-500",
    failed: "bg-red-500",
    stopped: "bg-slate-400",
    loading: "bg-blue-400 animate-pulse",
  };
  return <span className={`w-2.5 h-2.5 rounded-full ${colors[status] || "bg-slate-400"} shrink-0`} />;
}

// ─── ActionCard ───

function ActionCard({ action, onRun, loading, done }: {
  action: keyof typeof ACTIONS;
  onRun: (action: keyof typeof ACTIONS) => void;
  loading: boolean;
  done?: boolean;
}) {
  const a = ACTIONS[action];
  return (
    <button
      onClick={() => onRun(action)}
      disabled={loading}
      className={`bg-white rounded-2xl border p-5 transition-all text-left w-full ${
        done
          ? "border-emerald-200 opacity-80"
          : "border-slate-200 hover:shadow-md hover:border-emerald-300"
      } disabled:opacity-50`}
    >
      <div className="flex items-start gap-4">
        <div className={`w-12 h-12 ${a.color} rounded-xl flex items-center justify-center text-2xl flex-shrink-0 relative`}>
          {a.icon}
          {done && (
            <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm">
              ✓
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">{a.label}</h3>
            {done && (
              <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
                Done
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{a.desc}</p>
        </div>
        {loading && (
          <div className="animate-spin w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full" />
        )}
      </div>
    </button>
  );
}

// ─── Stat card with bar ───

function StatBar({ label, used, total, unit, colorLow = "emerald", colorMid = "amber", colorHigh = "red" }: {
  label: string;
  used: number;
  total: number;
  unit: string;
  colorLow?: string;
  colorMid?: string;
  colorHigh?: string;
}) {
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const barColor = pct > 85 ? colorHigh : pct > 70 ? colorMid : colorLow;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-400 uppercase tracking-wide font-medium">{label}</p>
        <p className="text-xs text-slate-500">
          {pct}%
        </p>
      </div>
      <p className="text-sm font-semibold text-slate-900 mb-2">
        {unit === "GB" ? `${used} / ${total} GB` : `${used} / ${total}`}
      </p>
      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 bg-${barColor}-500`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
    </div>
  );
}

// ─── Main page ───

export default function ServerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: server, isLoading, refetch } = trpc.server.get.useQuery({ id });
  const executeMut = trpc.server.execute.useMutation();
  const testConnection = trpc.server.testConnection.useMutation();
  const checkServices = trpc.server.checkServices.useMutation();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [servicesData, setServicesData] = useState<any>(null);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [quickCmd, setQuickCmd] = useState<string | null>(null);
  const [quickOutput, setQuickOutput] = useState<string>("");

  const router = useRouter();
  const deleteServer = trpc.server.delete.useMutation({
    onSuccess: () => router.push("/servers"),
    onError: (err) => alert("Error: " + err.message),
  });

  const { data: installations } = trpc.install.listForServer.useQuery({ serverId: id });

  const runAction = async (action: keyof typeof ACTIONS) => {
    setRunning(action);
    setResults((prev) => ({ ...prev, [action]: "Running..." }));
    try {
      const result = await executeMut.mutateAsync({ id, script: ACTIONS[action].script, timeout: 120 });
      setResults((prev) => ({ ...prev, [action]: result.output || "Done" }));
    } catch (err: any) {
      setResults((prev) => ({ ...prev, [action]: `Error: ${err.message}` }));
    }
    setRunning(null);
  };

  const detectServer = async () => {
    setScanning(true);
    try {
      await testConnection.mutateAsync({ id });
      refetch();
    } catch {}
    setScanning(false);
  };

  const refreshServices = async () => {
    setServicesLoading(true);
    try {
      const result = await checkServices.mutateAsync({ id });
      setServicesData(result);
      refetch();
    } catch (err: any) {
      setServicesData({ success: false, error: err.message });
    }
    setServicesLoading(false);
  };

  const runQuickCmd = async (cmdLabel: string, script: string) => {
    setQuickCmd(cmdLabel);
    setQuickOutput("Running...");
    try {
      const result = await executeMut.mutateAsync({ id, script, timeout: 30 });
      setQuickOutput(result.output || "Done");
    } catch (err: any) {
      setQuickOutput(`Error: ${err.message}`);
    }
  };

  if (isLoading) return <div className="text-slate-400 p-8">Loading...</div>;
  if (!server) return <div className="text-slate-500 p-8">Server not found</div>;

  const sysInfo = (server.systemInfo || {}) as Record<string, any>;
  const setupSteps = (sysInfo.setupSteps || {}) as Record<string, boolean>;
  const allSetupDone = setupSteps.security && setupSteps.docker && setupSteps.nginx && setupSteps.ssl;
  const serverServices = (sysInfo.services || {}) as Record<string, string>;

  const statusColors: Record<string, string> = {
    pending: "bg-yellow-400",
    connected: "bg-emerald-500",
    disconnected: "bg-slate-400",
    error: "bg-red-500",
  };
  const statusLabels: Record<string, string> = {
    pending: "Pending",
    connected: "Connected",
    disconnected: "Disconnected",
    error: "Error",
  };

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-slate-900">{server.name}</h1>
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${statusColors[server.status] || "bg-slate-400"}`} />
              <span className="text-sm font-medium text-slate-600">
                {statusLabels[server.status] || server.status}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className="font-mono">{server.ip}</span>
            {server.os && <span>• OS: {server.os.slice(0, 30)}</span>}
            {server.lastSeen && (
              <span>• Last seen: {timeAgo(server.lastSeen)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {server.status === "connected" && (
            <button onClick={refreshServices} disabled={servicesLoading}
              className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1">
              <span className={`${servicesLoading ? "animate-spin" : ""}`}>⟳</span>
              {servicesLoading ? "Scanning..." : "Scan services"}
            </button>
          )}
          <button onClick={detectServer} disabled={scanning}
            className="text-sm bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg transition-colors">
            {scanning ? "Detecting..." : "Detect OS / connect"}
          </button>
          <button onClick={() => { if (confirm("Delete this server?")) deleteServer.mutate({ id: server.id }); }}
            disabled={deleteServer.isPending}
            className="text-sm text-red-500 hover:text-red-700 px-3 py-1.5 transition-colors">
            {deleteServer.isPending ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>

      {/* ── RAM / Disk gauges ── */}
      {sysInfo.ramTotal > 0 || sysInfo.diskTotal > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          {sysInfo.ramTotal > 0 && (
            <StatBar
              label="RAM"
              used={Math.round(sysInfo.ramUsed / 1024 * 10) / 10}
              total={Math.round(sysInfo.ramTotal / 1024 * 10) / 10}
              unit="GB"
            />
          )}
          {sysInfo.diskTotal && sysInfo.diskTotal > 0 && (
            <StatBar
              label="Disk"
              used={sysInfo.diskUsed}
              total={sysInfo.diskTotal}
              unit="GB"
            />
          )}
          {sysInfo.uptime && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Uptime</p>
              <p className="text-sm font-semibold text-slate-900">⏱ {sysInfo.uptime}</p>
              {server.lastSeen && (
                <p className="text-xs text-slate-400 mt-1">Checked {timeAgo(server.lastSeen)}</p>
              )}
            </div>
          )}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-1">Container count</p>
            <p className="text-sm font-semibold text-slate-900">
              🐳 {servicesData?.containers ?? "—"}
            </p>
            {!servicesData && (
              <button onClick={refreshServices} disabled={servicesLoading}
                className="text-xs text-emerald-600 hover:text-emerald-800 mt-1">
                {servicesLoading ? "Scanning..." : "Scan →"}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Minimal info cards when no data yet */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">OS</p>
            <p className="text-sm font-medium">{server.os || "Not detected"}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">RAM</p>
            <p className="text-sm font-medium">Run detection</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Disk</p>
            <p className="text-sm font-medium">Run detection</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Uptime</p>
            <p className="text-sm font-medium">—</p>
          </div>
        </div>
      )}

      {/* ── Service status cards ── */}
      {server.status === "connected" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          {(["docker", "nginx", "caddy", "ufw", "fail2ban"] as const).map((svc) => {
            const detected = serverServices[svc] === "installed";
            const fromScan = servicesData?.services?.[svc] === "installed";
            const active = detected || fromScan;
            const icons: Record<string, string> = {
              docker: "🐳", nginx: "🌐", caddy: "🟢", ufw: "🛡️", fail2ban: "🚫"
            };
            return (
              <div key={svc} className={`rounded-xl border p-3 text-center transition-all ${
                active ? "bg-white border-emerald-200" : "bg-slate-50 border-slate-200 opacity-70"
              }`}>
                <p className="text-lg mb-1">{icons[svc] || "❓"}</p>
                <p className="text-xs font-medium text-slate-700 capitalize">{svc}</p>
                <p className={`text-[11px] ${active ? "text-emerald-600" : "text-slate-400"}`}>
                  {active ? "Installed" : servicesLoading ? "..." : "Not found"}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Setup / Configuration section ── */}
      {server.status === "connected" && (
        <>
          {allSetupDone ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex items-center gap-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-xl">✅</div>
              <div className="flex-1">
                <h3 className="font-semibold text-emerald-800">Server fully configured</h3>
                <p className="text-sm text-emerald-600">Security, Docker, Nginx, and SSL tooling are all installed.</p>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-2xl p-6 mb-6 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold mb-1">Configure automatically</h2>
                  <p className="text-sm text-emerald-100">Security → Docker → Nginx → SSL in one command</p>
                </div>
                <button onClick={() => {
                  const steps = ["security", "docker", "nginx", "ssl"];
                  steps.reduce(async (prev, step) => {
                    await prev;
                    await runAction(step as keyof typeof ACTIONS);
                  }, Promise.resolve());
                }}
                  className="px-6 py-3 bg-white text-emerald-700 rounded-xl font-semibold hover:bg-emerald-50 transition-colors">
                  {running ? "Running..." : "Configure"}
                </button>
              </div>
            </div>
          )}

          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {allSetupDone ? "Setup steps" : "Available actions"}
          </h2>
          <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 mb-6 ${allSetupDone ? "opacity-60" : ""}`}>
            {(Object.keys(ACTIONS) as Array<keyof typeof ACTIONS>).map((action) => (
              <ActionCard key={action} action={action} onRun={runAction} loading={running === action} done={!!setupSteps[action]} />
            ))}
          </div>
          {allSetupDone && (
            <p className="text-xs text-slate-400 text-center -mt-4 mb-6">
              All setup steps completed. Click a card to re-run if needed.
            </p>
          )}

          {/* Results from setup */}
          {Object.entries(results).length > 0 && (
            <div className="space-y-4 mb-6">
              <h2 className="text-lg font-semibold text-slate-900">Results</h2>
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
        </>
      )}

      {/* ── Row: Quick commands + Action history ── */}
      {server.status === "connected" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

          {/* Quick commands */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">⚡ Quick commands</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(QUICK_COMMANDS).map(([key, cmd]) => (
                <button key={key} onClick={() => runQuickCmd(cmd.label, cmd.cmd)}
                  disabled={quickCmd === cmd.label}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                    quickCmd === cmd.label
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}>
                  {quickCmd === cmd.label ? "..." : cmd.label}
                </button>
              ))}
            </div>
            {quickOutput && (
              <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl max-h-48 overflow-y-auto whitespace-pre-wrap">
                {quickOutput}
              </pre>
            )}
          </div>

          {/* Action history */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="font-semibold text-slate-900 mb-4">📋 Recent activity</h2>
            {!installations || installations.length === 0 ? (
              <div className="text-sm text-slate-400 text-center py-6">
                <p>No activity yet</p>
                <p className="text-xs text-slate-300 mt-1">Install an app from the catalog</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {installations.slice().reverse().map((inst) => {
                  const params = (inst.params || {}) as any;
                  const name = params.name || inst.recipeId || "App";
                  const status = inst.status || "pending";
                  const statusIcons: Record<string, string> = {
                    success: "✅", running: "🔄", failed: "❌", stopped: "⏹️",
                  };
                  return (
                    <div key={inst.id} className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                      <span className="text-base mt-0.5">{statusIcons[status] || "❓"}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900 truncate">{name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                          <span className="capitalize">{status}</span>
                          {params.port && <span>· port {params.port}</span>}
                          {params.domain && <span>· {params.domain}</span>}
                          <span>· {timeAgo(inst.updatedAt || inst.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Installed apps ── */}
      <InstalledApps serverId={server.id} />

      {/* ── Domains ── */}
      <DomainSection serverId={server.id} />

      {/* ── Not connected state ── */}
      {server.status !== "connected" && (
        <div className="bg-amber-50 rounded-2xl p-8 text-center border border-amber-200">
          <p className="text-4xl mb-3">🔑</p>
          <h2 className="text-lg font-semibold text-amber-800 mb-1">Server pending</h2>
          <p className="text-sm text-amber-600 mb-4">
            Add the SSH public key to your server to enable actions.
          </p>

          <div className="max-w-xl mx-auto text-left bg-white rounded-xl p-4 border border-amber-200 mb-4">
            <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
              Command to run on your server
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
{`echo '${server.sshPublicKey || "..."}' >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys`}
            </pre>
          </div>

          <button onClick={async () => {
            setTesting(true);
            try {
              const result = await testConnection.mutateAsync({ id });
              if (result.success) refetch();
              else alert("Failed: " + ((result as any).error || "Connection failed"));
            } catch (err: any) { alert("Error: " + err.message); }
            setTesting(false);
          }} disabled={testing}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {testing ? "Testing..." : "Test connection"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── DomainSection ───

function DomainSection({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: domains } = trpc.domain.list.useQuery({ serverId });
  const addDomain = trpc.domain.add.useMutation({ onSuccess: () => utils.domain.list.invalidate({ serverId }) });
  const deleteDomain = trpc.domain.delete.useMutation({ onSuccess: () => utils.domain.list.invalidate({ serverId }) });

  const [name, setName] = useState("");
  const [port, setPort] = useState("");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <h2 className="font-semibold text-slate-900 mb-2">🌍 Domains</h2>
      <p className="text-sm text-slate-500 mb-4">
        Add a custom domain pointing to an installed app (automatic Nginx reverse proxy).
      </p>

      {domains && domains.length > 0 && (
        <div className="space-y-2 mb-4">
          {domains.map((d) => (
            <DomainItem key={d.id} domain={d} onDelete={() => { if (confirm("Delete " + d.name + " ?")) deleteDomain.mutate({ id: d.id }); }} />
          ))}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="app.yourdomain.com"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <input type="number" value={port} onChange={(e) => setPort(e.target.value)}
          placeholder="target port (80, 3000...)"
          className="w-full md:w-48 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
        <button onClick={() => {
          if (!name) return;
          addDomain.mutate({ serverId, name, targetPort: port ? parseInt(port) : undefined });
          setName(""); setPort("");
        }} disabled={addDomain.isPending}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {addDomain.isPending ? "Adding..." : "Add"}
        </button>
      </div>

      <p className="text-xs text-slate-400 mt-3">
        Configure your DNS (A record) to point to the server IP before SSL can be enabled.
      </p>
    </div>
  );
}

function DomainItem({ domain, onDelete }: { domain: any; onDelete: () => void }) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const enableSsl = async () => {
    if (!confirm("Enable SSL on " + domain.name + "? (Your DNS must point to the server)")) return;
    setLoading(true);
    setStatus("DNS check + certificate generation...");
    try {
      const res = await fetch("/api/domains/enable-ssl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: domain.id }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("SSL active → " + data.url);
        setTimeout(() => window.location.reload(), 1500);
      } else {
        setStatus("Error: " + (data.detail || data.error || "unknown"));
      }
    } catch (err: any) { setStatus("Error: " + err.message); }
    setLoading(false);
  };

  return (
    <div className="p-3 bg-slate-50 rounded-xl">
      <div className="flex items-center gap-3">
        <span className="text-lg">🌍</span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-slate-900 truncate">{domain.name}</p>
          <p className="text-xs text-slate-500">
            {domain.targetApp && <span>{domain.targetApp} → </span>}
            port {domain.targetPort || "—"} • SSL: {domain.sslStatus}
          </p>
        </div>
        {domain.sslStatus !== "active" && (
          <button onClick={enableSsl} disabled={loading}
            className="text-sm bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50">
            {loading ? "..." : "Enable SSL"}
          </button>
        )}
        <button onClick={onDelete} className="text-sm text-red-500 hover:text-red-700">
          Delete
        </button>
      </div>
      {status && <p className="text-xs mt-2 text-slate-600 break-words">{status}</p>}
    </div>
  );
}

// ─── InstalledApps (improved) ───

function InstalledApps({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: installations } = trpc.install.listForServer.useQuery({ serverId });
  const deleteApp = trpc.install.delete.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const restartApp = trpc.install.restart.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const stopApp = trpc.install.stop.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const startApp = trpc.install.start.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const getLogs = trpc.install.logs.useMutation();
  const getEnv = trpc.install.getEnv.useMutation();
  const [actionOutput, setActionOutput] = useState<Record<string, string>>({});
  const [openPanels, setOpenPanels] = useState<Record<string, boolean>>({});

  const runAction = async (id: string, action: string, fn: any) => {
    setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: "..." }));
    try {
      const result = await fn.mutateAsync({ id });
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: result.output || result.message || "Done" }));
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: `Error: ${err.message}` }));
    }
  };

  const togglePanel = (id: string, panel: string, fn: any) => {
    const key = `${id}-${panel}`;
    if (openPanels[key]) {
      setOpenPanels((prev) => ({ ...prev, [key]: false }));
      return;
    }
    setOpenPanels((prev) => ({ ...prev, [key]: true }));
    runAction(id, panel, fn);
  };

  const apps = installations || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900">📦 Installed apps</h2>
        {apps.length > 0 && (
          <span className="text-xs text-slate-500">{apps.length} app{apps.length > 1 ? "s" : ""}</span>
        )}
      </div>

      {apps.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-8 border-2 border-dashed border-slate-200 rounded-xl">
          <p className="text-2xl mb-2">📭</p>
          No installations yet.
          <br />
          <span className="text-xs text-slate-400">Install an app via the catalog or ask your AI agent.</span>
        </div>
      ) : (
        <div className="space-y-3">
          {apps.map((item: any) => {
            const params = item.params || {};
            const status = item.status || "unknown";
            const statusColors: Record<string, string> = {
              success: "bg-emerald-500",
              running: "bg-amber-400",
              failed: "bg-red-500",
              stopped: "bg-slate-400",
            };
            const statusBgs: Record<string, string> = {
              success: "bg-emerald-50 border-emerald-200",
              running: "bg-amber-50 border-amber-200",
              failed: "bg-red-50 border-red-200",
              stopped: "bg-slate-50 border-slate-200",
            };

            return (
              <div key={item.id} className={`border rounded-xl overflow-hidden transition-all ${statusBgs[status] || "border-slate-200"}`}>
                {/* Header */}
                <div className="flex items-center gap-3 p-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status] || "bg-slate-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900">
                      {params.name || item.recipeId || "App"}
                    </p>
                    <p className="text-xs text-slate-500">
                      {params.port && `Port ${params.port}`}
                      {params.domain && ` • ${params.domain}`}
                      {params.image && ` • ${params.image.split("/").pop()}`}
                      {!params.port && !params.domain && `Status: ${status}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => togglePanel(item.id, "logs", getLogs)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                        openPanels[`${item.id}-logs`]
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}>
                      📋 Logs
                    </button>
                    <button onClick={() => runAction(item.id, "restart", restartApp)}
                      disabled={restartApp.isPending}
                      className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                      ⟳ Restart
                    </button>
                    {status !== "stopped" ? (
                      <button onClick={() => runAction(item.id, "stop", stopApp)}
                        disabled={stopApp.isPending}
                        className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                        ⏹ Stop
                      </button>
                    ) : (
                      <button onClick={() => runAction(item.id, "start", startApp)}
                        disabled={startApp.isPending}
                        className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                        ▶ Start
                      </button>
                    )}
                    <button onClick={() => togglePanel(item.id, "env", getEnv)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                        openPanels[`${item.id}-env`]
                          ? "bg-blue-100 text-blue-700"
                          : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                      }`}>
                      🔑 .env
                    </button>
                    <button onClick={() => { if (confirm("Uninstall?")) deleteApp.mutate({ id: item.id }); }}
                      disabled={deleteApp.isPending}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 font-medium">
                      ✕
                    </button>
                  </div>
                </div>

                {/* Logs panel */}
                {openPanels[`${item.id}-logs`] && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                      <span className="text-[11px] text-slate-500 font-medium uppercase">Container logs</span>
                      <button onClick={() => runAction(item.id, "logs", getLogs)}
                        className="text-[11px] text-emerald-600 hover:underline">↻ Refresh</button>
                    </div>
                    <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {actionOutput[`${item.id}-logs`] || "Loading..."}
                    </pre>
                  </div>
                )}

                {/* Env panel */}
                {openPanels[`${item.id}-env`] && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                      <span className="text-[11px] text-slate-500 font-medium uppercase">Environment variables</span>
                      <button onClick={() => runAction(item.id, "env", getEnv)}
                        className="text-[11px] text-emerald-600 hover:underline">↻ Refresh</button>
                    </div>
                    <pre className="text-xs font-mono bg-slate-900 text-emerald-300 p-3 max-h-48 overflow-y-auto whitespace-pre-wrap">
                      {actionOutput[`${item.id}-env`] || "Loading..."}
                    </pre>
                  </div>
                )}

                {/* Restart/stop/start result */}
                {(actionOutput[`${item.id}-restart`] || actionOutput[`${item.id}-stop`] || actionOutput[`${item.id}-start`]) && (
                  <p className="text-xs text-slate-500 px-3 py-1.5 border-t border-slate-100">
                    {actionOutput[`${item.id}-restart`] || actionOutput[`${item.id}-stop`] || actionOutput[`${item.id}-start`]}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
