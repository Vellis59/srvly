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
  prune: { label: "🧹 Docker cleanup", cmd: "echo 'Cleaning build cache...' && docker builder prune -af 2>&1 && echo '---' && echo 'Removing dangling images...' && docker image prune -f 2>&1 && echo '---' && echo 'Removing stopped containers...' && docker container prune -f 2>&1 && echo '---' && df -h / | tail -1 && echo 'DONE'" },
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

      {/* ── Monitoring ── */}
      {server.status === "connected" && (
        <MonitoringSection serverId={id} />
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
      <BackupSection serverId={server.id} />
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

// ─── MonitoringSection ───

function Sparkline({ values, maxVal, color }: { values: number[]; maxVal: number; color: string }) {
  const h = 32;
  const w = 120;
  if (values.length < 2) return <div className="text-[10px] text-slate-400">—</div>;
  const max = Math.max(...values, maxVal);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h}`).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MonitoringSection({ serverId }: { serverId: string }) {
  const { data: metricsData, isLoading, refetch } = trpc.server.metrics.useQuery({ id: serverId, limit: 24 });
  const collectMetrics = trpc.server.collectMetrics.useMutation();
  const [collecting, setCollecting] = useState(false);
  const [collected, setCollected] = useState(false);

  const handleCollect = async () => {
    setCollecting(true);
    try {
      await collectMetrics.mutateAsync({ id: serverId });
      setCollected(true);
      refetch();
    } catch {}
    setCollecting(false);
  };

  const metrics = metricsData?.metrics || [];
  const warnings = metricsData?.warnings || [];
  const latest = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  const ramPct = latest ? Math.round((latest.ramUsed / (latest.ramTotal || 1)) * 100) : 0;
  const diskPct = latest ? parseFloat(latest.diskUsePct || "0") : 0;

  const ramHistory = metrics.map((m: any) => Math.round((m.ramUsed / (m.ramTotal || 1)) * 100));
  const diskHistory = metrics.map((m: any) => parseFloat(m.diskUsePct || "0"));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900">📊 Monitoring</h2>
        <button onClick={handleCollect} disabled={collecting}
          className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1 ${
            collected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}>
          <span className={collecting ? "animate-pulse" : ""}>📡</span>
          {collecting ? "Collecting..." : collected ? "Collected ✓" : "Collect metrics"}
        </button>
      </div>

      {/* Warning alerts */}
      {warnings.length > 0 && (
        <div className="space-y-2 mb-4">
          {warnings.map((w, i) => (
            <div key={i} className={`text-xs px-3 py-2 rounded-lg flex items-center gap-2 ${
              w.includes("⚠") ? "bg-red-50 text-red-700 border border-red-200" :
              w.includes("⚡") ? "bg-amber-50 text-amber-700 border border-amber-200" :
              "bg-blue-50 text-blue-700 border border-blue-200"
            }`}>
              {w}
            </div>
          ))}
        </div>
      )}

      {metrics.length === 0 ? (
        <div className="text-center py-6 text-slate-400">
          <p className="text-sm">No metrics collected yet</p>
          <p className="text-xs text-slate-300 mt-1">Click "Collect metrics" to take the first snapshot</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* CPU Load */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">CPU Load</p>
            <div className="flex items-end gap-3 mb-2">
              <p className="text-lg font-bold text-slate-900">{(latest.cpuLoad1 || 0).toFixed(2)}</p>
              <div className="flex gap-2 text-[10px] text-slate-400">
                <span>5m: {(latest.cpuLoad5 || 0).toFixed(2)}</span>
                <span>15m: {(latest.cpuLoad15 || 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${
                (latest.cpuLoad1 || 0) > 2.0 ? "bg-red-500" :
                (latest.cpuLoad1 || 0) > 1.0 ? "bg-amber-500" : "bg-blue-500"
              }`} style={{ width: `${Math.min(100, ((latest.cpuLoad1 || 0) / 4) * 100)}%` }} />
            </div>
            <p className="text-[10px] text-slate-400 mt-1">Cores: {Math.round((latest.cpuLoad1 || 0))}/4</p>
          </div>

          {/* RAM with sparkline */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">RAM</p>
            <div className="flex items-end gap-3 mb-1">
              <p className={`text-lg font-bold ${ramPct > 85 ? "text-red-600" : ramPct > 70 ? "text-amber-600" : "text-slate-900"}`}>
                {latest ? `${Math.round(latest.ramUsed / 1024 * 10) / 10} / ${Math.round(latest.ramTotal / 1024 * 10) / 10} GB` : "—"}
              </p>
              <span className={`text-xs font-medium ${ramPct > 85 ? "text-red-600" : ramPct > 70 ? "text-amber-600" : "text-slate-500"}`}>
                {ramPct}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
              <div className={`h-full rounded-full ${ramPct > 85 ? "bg-red-500" : ramPct > 70 ? "bg-amber-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(100, ramPct)}%` }} />
            </div>
            <Sparkline values={ramHistory} maxVal={100} color={ramPct > 70 ? "#f59e0b" : "#3b82f6"} />
          </div>

          {/* Disk with sparkline */}
          <div className="bg-slate-50 rounded-xl p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide font-medium mb-2">Disk</p>
            <div className="flex items-end gap-3 mb-1">
              <p className={`text-lg font-bold ${diskPct > 85 ? "text-red-600" : diskPct > 70 ? "text-amber-600" : "text-slate-900"}`}>
                {latest ? `${latest.diskUsed} / ${latest.diskTotal} GB` : "—"}
              </p>
              <span className={`text-xs font-medium ${diskPct > 85 ? "text-red-600" : diskPct > 70 ? "text-amber-600" : "text-slate-500"}`}>
                {diskPct}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden mb-1">
              <div className={`h-full rounded-full ${diskPct > 85 ? "bg-red-500" : diskPct > 70 ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${Math.min(100, diskPct)}%` }} />
            </div>
            <Sparkline values={diskHistory} maxVal={100} color={diskPct > 70 ? "#f59e0b" : "#10b981"} />
          </div>
        </div>
      )}

      {metrics.length > 1 && (
        <p className="text-[10px] text-slate-400 mt-3 text-center">
          {metrics.length} snapshots collected · {metrics.length > 1 ? `Spanning ${Math.min(metrics.length, 48)} observations` : ""}
        </p>
      )}
    </div>
  );
}

// ─── DomainSection (Phase 5) ───

function DomainSection({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: domains, isLoading: domainsLoading, error: domainsError } = trpc.domain.list.useQuery({ serverId });
  const { data: installations } = trpc.install.listForServer.useQuery({ serverId });
  const addDomain = trpc.domain.add.useMutation({
    onSuccess: () => {
      utils.domain.list.invalidate({ serverId });
    },
    onError: (err: any) => {
      setAddError(err.message || "Failed to add domain");
    },
  });
  const deleteDomain = trpc.domain.delete.useMutation({ onSuccess: () => utils.domain.list.invalidate({ serverId }) });

  const [name, setName] = useState("");
  const [port, setPort] = useState("");
  const [selectedApp, setSelectedApp] = useState("");
  const [addError, setAddError] = useState("");

  const handleAdd = async () => {
    if (!name) {
      setAddError("Please enter a domain name");
      return;
    }
    setAddError("");
    try {
      await addDomain.mutateAsync({
        serverId,
        name,
        targetPort: port ? parseInt(port) : undefined,
        targetApp: selectedApp || undefined,
      });
      setName("");
      setPort("");
      setSelectedApp("");
    } catch (err: any) {
      setAddError(err.message || "Failed to add domain");
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-semibold text-slate-900">🌍 Domains</h2>
        {domains && domains.length > 0 && (
          <span className="text-xs text-slate-500">{domains.length} domain{domains.length > 1 ? "s" : ""}</span>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-4">
        Add a custom domain pointing to an installed app (automatic Nginx reverse proxy).
      </p>

      {domainsLoading && (
        <div className="text-sm text-slate-400 mb-4">Loading domains...</div>
      )}

      {domainsError && (
        <div className="text-sm text-red-500 mb-4">Error loading domains: {domainsError.message}</div>
      )}

      {domains && domains.length > 0 && (
        <div className="space-y-3 mb-4">
          {domains.map((d: any) => (
            <DomainItem key={d.id} domain={d} onDelete={() => { if (confirm("Delete " + d.name + " ?")) deleteDomain.mutate({ id: d.id }); }} />
          ))}
        </div>
      )}

      {domains && domains.length === 0 && !domainsLoading && (
        <div className="text-sm text-slate-400 text-center py-4 mb-4 border-2 border-dashed border-slate-200 rounded-xl">
          No domains configured yet
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="app.yourdomain.com"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
        <input type="number" value={port} onChange={(e) => setPort(e.target.value)}
          placeholder="port"
          className="w-full md:w-24 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }} />
        <select value={selectedApp} onChange={(e) => setSelectedApp(e.target.value)}
          className="w-full md:w-44 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
          <option value="">No app linked</option>
          {(installations || []).map((inst: any) => {
            const params = (inst.params || {}) as any;
            return (
              <option key={inst.id} value={inst.id}>
                {params.name || inst.recipeId || "App"}
              </option>
            );
          })}
        </select>
        <button onClick={handleAdd}
          disabled={addDomain.isPending}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
          {addDomain.isPending ? "Adding..." : "Add"}
        </button>
      </div>

      {addError && (
        <p className="text-xs text-red-500 mt-2">{addError}</p>
      )}
      <p className="text-xs text-slate-400 mt-3">
        Configure your DNS (A record) to point to the server IP before SSL can be enabled.
      </p>
    </div>
  );
}

function DomainItem({ domain, onDelete }: { domain: any; onDelete: () => void }) {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState<string | null>(null);
  const [dnsStatus, setDnsStatus] = useState<any>(null);
  const [httpStatus, setHttpStatus] = useState<any>(null);
  const [sslStatus, setSslStatus] = useState<any>(null);
  const [proxyResult, setProxyResult] = useState<string>("");

  const checkDns = trpc.domain.checkDns.useMutation();
  const checkHttp = trpc.domain.checkHttp.useMutation();
  const checkSsl = trpc.domain.checkSsl.useMutation();
  const generateProxy = trpc.domain.generateProxy.useMutation();

  const runDnsCheck = async () => {
    setLoading("dns");
    try {
      const r = await checkDns.mutateAsync({ id: domain.id });
      setDnsStatus(r);
    } catch (err: any) { setDnsStatus({ status: "error", resolved: err.message }); }
    setLoading(null);
  };

  const runHttpCheck = async () => {
    setLoading("http");
    try {
      const r = await checkHttp.mutateAsync({ id: domain.id });
      setHttpStatus(r);
    } catch (err: any) { setHttpStatus({ http: null, https: null }); }
    setLoading(null);
  };

  const runSslCheck = async () => {
    setLoading("ssl");
    try {
      const r = await checkSsl.mutateAsync({ id: domain.id });
      setSslStatus(r);
    } catch (err: any) { setSslStatus({ ssl: false }); }
    setLoading(null);
  };

  const runGenerateProxy = async () => {
    setLoading("proxy");
    setProxyResult("Generating...");
    try {
      const r = await generateProxy.mutateAsync({ id: domain.id });
      setProxyResult(r.proxyType + ": " + ((r as any).output || "done"));
    } catch (err: any) { setProxyResult("Error: " + err.message); }
    setLoading(null);
  };

  const enableSsl = async () => {
    if (!confirm("Enable SSL on " + domain.name + "? (Your DNS must point to the server)")) return;
    setLoading("ssl-enable");
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
    setLoading(null);
  };

  const hasChecks = dnsStatus || httpStatus || sslStatus || proxyResult;

  return (
    <div className="p-3 bg-slate-50 rounded-xl">
      <div className="flex items-start gap-3">
        <span className="text-lg mt-0.5">🌍</span>
        <div className="flex-1 min-w-0">
          <p className="font-mono text-sm text-slate-900 truncate">{domain.name}</p>
          <p className="text-xs text-slate-500">
            {domain.appName && <span>{domain.appName} → </span>}
            port {domain.targetPort || "—"} • SSL: {domain.sslStatus}
          </p>
          {/* Status badges */}
          {dnsStatus && (
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium mt-1 mr-1 ${
              dnsStatus.status === "ok" ? "bg-emerald-100 text-emerald-700" :
              dnsStatus.status === "no_dns" ? "bg-red-100 text-red-700" :
              "bg-amber-100 text-amber-700"
            }`}>
              DNS: {dnsStatus.status === "ok" ? "✓" : dnsStatus.status === "no_dns" ? "✗" : "⚠"}
            </span>
          )}
          {httpStatus && httpStatus.https && (
            <span className="inline-block text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-medium mt-1 mr-1">
              HTTPS {httpStatus.https}
            </span>
          )}
          {httpStatus && httpStatus.http && !httpStatus.https && (
            <span className="inline-block text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium mt-1 mr-1">
              HTTP {httpStatus.http}
            </span>
          )}
          {sslStatus && sslStatus.ssl && (
            <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-medium mt-1 mr-1 ${
              sslStatus.expired ? "bg-red-100 text-red-700" :
              sslStatus.expiresSoon ? "bg-amber-100 text-amber-700" :
              "bg-emerald-100 text-emerald-700"
            }`}>
              SSL: {sslStatus.daysLeft !== null ? `${sslStatus.daysLeft}d` : "✓"}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1 shrink-0">
          <button onClick={runDnsCheck} disabled={loading === "dns"}
            className="text-[11px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1 rounded-lg font-medium transition-colors">
            {loading === "dns" ? "..." : "DNS"}
          </button>
          <button onClick={runHttpCheck} disabled={loading === "http"}
            className="text-[11px] bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded-lg font-medium transition-colors">
            {loading === "http" ? "..." : "HTTP"}
          </button>
          <button onClick={runSslCheck} disabled={loading === "ssl"}
            className="text-[11px] bg-purple-50 hover:bg-purple-100 text-purple-600 px-2 py-1 rounded-lg font-medium transition-colors">
            {loading === "ssl" ? "..." : "SSL"}
          </button>
          <button onClick={runGenerateProxy} disabled={loading === "proxy"}
            className="text-[11px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded-lg font-medium transition-colors">
            {loading === "proxy" ? "..." : "🔄 Proxy"}
          </button>
          {domain.sslStatus !== "active" && (
            <button onClick={enableSsl} disabled={loading === "ssl-enable"}
              className="text-[11px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium transition-colors">
              {loading === "ssl-enable" ? "..." : "🔒 SSL"}
            </button>
          )}
          <button onClick={onDelete} className="text-[11px] text-red-500 hover:text-red-700 px-2 py-1">
            ✕
          </button>
        </div>
      </div>

      {/* Results */}
      {dnsStatus && (
        <p className={`text-[11px] mt-1.5 ${dnsStatus.match ? "text-emerald-600" : "text-amber-600"}`}>
          DNS: {dnsStatus.resolved} {dnsStatus.match ? "✓ matches server" : `✗ (server: ${dnsStatus.serverIp})`}
        </p>
      )}
      {httpStatus && (
        <p className="text-[11px] text-slate-500 mt-0.5">
          HTTP: {httpStatus.http || "—"} · HTTPS: {httpStatus.https || "—"}
        </p>
      )}
      {sslStatus && sslStatus.ssl && (
        <p className={`text-[11px] mt-0.5 ${sslStatus.expired ? "text-red-600" : sslStatus.expiresSoon ? "text-amber-600" : "text-emerald-600"}`}>
          SSL: {sslStatus.subject?.slice(0, 40)} · expires {sslStatus.daysLeft !== null ? `in ${sslStatus.daysLeft}d` : "?"}
        </p>
      )}
      {proxyResult && (
        <p className="text-[11px] text-slate-500 mt-0.5">{proxyResult}</p>
      )}
      {status && <p className="text-[11px] mt-0.5 text-slate-500">{status}</p>}
    </div>
  );
}

// ─── InstalledApps (Phase 3) ───

function InstalledApps({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: installations } = trpc.install.listForServer.useQuery({ serverId });
  const backupAppMutation = trpc.backup.appBackup.useMutation();
  const [backupBusy, setBackupBusy] = useState<Record<string, boolean>>({});
  const [backupMsg, setBackupMsg] = useState<Record<string, string>>({});
  const deleteApp = trpc.install.delete.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const restartApp = trpc.install.restart.useMutation();
  const stopApp = trpc.install.stop.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const startApp = trpc.install.start.useMutation({ onSuccess: () => utils.install.listForServer.invalidate({ serverId }) });
  const getLogs = trpc.install.logs.useMutation();
  const getEnv = trpc.install.getEnv.useMutation();
  const getStats = trpc.install.containerStats.useMutation();
  const inspectApp = trpc.install.inspect.useMutation();
  const updateEnv = trpc.install.updateEnv.useMutation();

  const [actionOutput, setActionOutput] = useState<Record<string, string>>({});
  const [openPanels, setOpenPanels] = useState<Record<string, string>>({}); // id-panel → "open" | "loading" | "loaded"
  const [containerStats, setContainerStats] = useState<Record<string, any> | null>(null);
  const [containerSizes, setContainerSizes] = useState<Record<string, string> | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [logLines, setLogLines] = useState<number>(100);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [editingEnv, setEditingEnv] = useState<Record<string, string> | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingEnv, setSavingEnv] = useState(false);
  const [inspectData, setInspectData] = useState<Record<string, any>>({});
  const [inspectLoading, setInspectLoading] = useState<Record<string, boolean>>({});

  const runAction = async (id: string, action: string, fn: any) => {
    setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: "..." }));
    try {
      const result = await fn.mutateAsync({ id });
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: result.output || result.message || "Done" }));
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: `Error: ${err.message}` }));
    }
  };

  const refreshStats = async () => {
    setStatsLoading(true);
    try {
      const result = await getStats.mutateAsync({ serverId });
      if (result.success) {
        setContainerStats((result as any).stats || {});
        setContainerSizes((result as any).sizes || {});
      }
    } catch {}
    setStatsLoading(false);
  };

  const backupApp = async (item: any) => {
    setBackupBusy((prev) => ({ ...prev, [item.id]: true }));
    setBackupMsg((prev) => ({ ...prev, [item.id]: "..." }));
    try {
      const result = (await backupAppMutation.mutateAsync({ installationId: item.id })) as any;
      if (result.success) {
        setBackupMsg((prev) => ({ ...prev, [item.id]: `✓ ${result.filename}` }));
        utils.backup.list.invalidate({ serverId });
      } else {
        setBackupMsg((prev) => ({ ...prev, [item.id]: `✗ ${result.error || "failed"}` }));
      }
    } catch (err: any) {
      setBackupMsg((prev) => ({ ...prev, [item.id]: `✗ ${err.message}` }));
    }
    setBackupBusy((prev) => ({ ...prev, [item.id]: false }));
  };

  const fetchLogs = async (id: string, lines?: number) => {
    const key = `${id}-logs`;
    setOpenPanels((prev) => ({ ...prev, [key]: "loading" }));
    try {
      const result = await getLogs.mutateAsync({ id, lines: lines || logLines });
      setActionOutput((prev) => ({ ...prev, [key]: result.output || "No output" }));
      setOpenPanels((prev) => ({ ...prev, [key]: "loaded" }));
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [key]: `Error: ${err.message}` }));
      setOpenPanels((prev) => ({ ...prev, [key]: "loaded" }));
    }
  };

  const fetchInspect = async (item: any) => {
    const id = item.id;
    if (inspectData[id]) return; // already loaded
    setInspectLoading((prev) => ({ ...prev, [id]: true }));
    try {
      const result = await inspectApp.mutateAsync({ id });
      if (result.success) setInspectData((prev) => ({ ...prev, [id]: result }));
    } catch {}
    setInspectLoading((prev) => ({ ...prev, [id]: false }));
  };

  const fetchEnv = async (id: string) => {
    const key = `${id}-env`;
    setOpenPanels((prev) => ({ ...prev, [key]: "loading" }));
    try {
      const result = await getEnv.mutateAsync({ id });
      setActionOutput((prev) => ({ ...prev, [key]: result.output || "No output" }));
      setOpenPanels((prev) => ({ ...prev, [key]: "loaded" }));
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [key]: `Error: ${err.message}` }));
      setOpenPanels((prev) => ({ ...prev, [key]: "loaded" }));
    }
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  };

  const startEditEnv = (item: any) => {
    // Parse the env output into a record
    const raw = actionOutput[`${item.id}-env`] || "";
    const env: Record<string, string> = {};
    for (const line of raw.split("\n")) {
      const eqIdx = line.indexOf("=");
      if (eqIdx > 0) {
        env[line.substring(0, eqIdx)] = line.substring(eqIdx + 1);
      }
    }
    setEditingEnv(item.id);
    setEditValues(env);
  };

  const saveEnvChanges = async (itemId: string) => {
    setSavingEnv(true);
    try {
      const result = await updateEnv.mutateAsync({ id: itemId, env: editValues });
      setActionOutput((prev) => ({ ...prev, [`${itemId}-env-save`]: (result as any).message || (result as any).error || "Done" }));
      setEditingEnv(null);
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [`${itemId}-env-save`]: `Error: ${err.message}` }));
    }
    setSavingEnv(false);
  };

  const isSecret = (key: string): boolean => {
    const lower = key.toLowerCase();
    return /pass|secret|token|key|auth|credential|private|salt/i.test(lower);
  };

  const maskValue = (val: string): string => {
    if (val.length <= 4) return "****";
    return val.slice(0, 2) + "****" + val.slice(-2);
  };

  const apps = installations || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900">📦 Installed apps</h2>
        <div className="flex items-center gap-2">
          {apps.length > 0 && (
            <button onClick={refreshStats} disabled={statsLoading}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1">
              <span className={`${statsLoading ? "animate-pulse" : ""}`}>📊</span>
              {statsLoading ? "Loading..." : "Live stats"}
            </button>
          )}
          {apps.length > 0 && (
            <span className="text-xs text-slate-500">{apps.length} app{apps.length > 1 ? "s" : ""}</span>
          )}
        </div>
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
            const params = (item.params || {}) as any;
            const status = item.status || "unknown";
            const insp = inspectData[item.id] || {};
            const isOpen = openPanels[`${item.id}-logs`] === "loaded" || openPanels[`${item.id}-env`] === "loaded";
            const ip = actionOutput[`${item.id}-logs`] && openPanels[`${item.id}-logs`] === "loaded";

            const statusColors: Record<string, string> = {
              success: "bg-emerald-500", running: "bg-amber-400",
              failed: "bg-red-500", stopped: "bg-slate-400",
            };
            const statusBgs: Record<string, string> = {
              success: "bg-emerald-50 border-emerald-200",
              running: "bg-amber-50 border-amber-200",
              failed: "bg-red-50 border-red-200",
              stopped: "bg-slate-50 border-slate-200",
            };

            // Derive app URL
            let appUrl = "";
            if (params.domain) appUrl = `https://${params.domain}`;
            else if (params.port) appUrl = `http://${inspectData[item.id]?.ports?.split(":")[0] || "server-ip"}:${params.port}`;

            return (
              <div key={item.id} className={`border rounded-xl overflow-hidden transition-all ${statusBgs[status] || "border-slate-200"}`}>
                {/* ── Header bar ── */}
                <div className="flex items-center gap-3 p-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status] || "bg-slate-400"} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm text-slate-900">
                        {params.name || item.recipeId || "App"}
                      </p>
                      {/* Container status badge */}
                      {insp.status && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          insp.status === "running" ? "bg-emerald-100 text-emerald-700" :
                          insp.status === "exited" ? "bg-slate-100 text-slate-600" :
                          "bg-amber-100 text-amber-700"
                        }`}>
                          {insp.status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">
                      {params.port && `Port ${params.port}`}
                      {params.domain && ` • ${params.domain}`}
                      {params.image && ` • ${params.image.split("/").pop()}`}
                      {!params.port && !params.domain && !params.image && `Status: ${status}`}
                    </p>
                    {/* Live stats row */}
                    {containerStats && containerSizes && (() => {
                      const cname = params.containerName || params.name || item.recipeId;
                      const s = containerStats[cname];
                      const size = containerSizes[cname];
                      if (!s && !size) return null;
                      return (
                        <div className="flex items-center gap-3 mt-1.5">
                          {s && <span className="text-[11px] font-mono text-slate-500">🧠 {s.mem}</span>}
                          {s && <span className="text-[11px] font-mono text-slate-400">CPU {s.cpu}</span>}
                          {size && <span className="text-[11px] font-mono text-slate-500">💾 {size}</span>}
                        </div>
                      );
                    })()}
                    {/* Container uptime */}
                    {insp.uptime && insp.uptime !== "unknown" && (
                      <p className="text-[11px] text-slate-400 mt-0.5">⏱ Uptime: {insp.uptime}</p>
                    )}
                  </div>

                  <div className="flex gap-1 shrink-0">
                    {/* Open URL */}
                    {appUrl && (
                      <a href={appUrl} target="_blank" rel="noopener noreferrer"
                        className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1">
                        ↗ Open
                      </a>
                    )}
                    {/* Details / Inspect */}
                    <button onClick={() => fetchInspect(item)}
                      disabled={inspectLoading[item.id]}
                      className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                      {inspectLoading[item.id] ? "..." : insp.status ? "🔄 Refresh" : "🔍 Details"}
                    </button>
                    {/* Logs toggle */}
                    <button onClick={() => {
                      if (openPanels[`${item.id}-logs`]) {
                        setOpenPanels((prev) => ({ ...prev, [`${item.id}-logs`]: "" }));
                      } else {
                        fetchLogs(item.id);
                      }
                    }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                        openPanels[`${item.id}-logs`] ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      }`}>
                      📋 Logs
                    </button>
                    {/* Restart */}
                    <button onClick={() => runAction(item.id, "restart", restartApp)}
                      disabled={restartApp.isPending}
                      className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                      ⟳ Restart
                    </button>
                    {/* Stop/Start */}
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
                    {/* Env toggle */}
                    <button onClick={() => {
                      if (openPanels[`${item.id}-env`]) {
                        setOpenPanels((prev) => ({ ...prev, [`${item.id}-env`]: "" }));
                      } else {
                        fetchEnv(item.id);
                      }
                    }}
                      className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${
                        openPanels[`${item.id}-env`] ? "bg-blue-100 text-blue-700" : "bg-blue-50 text-blue-600 hover:bg-blue-100"
                      }`}>
                      🔑 .env
                    </button>
                    {/* Backup */}
                    <button onClick={() => backupApp(item)}
                      disabled={backupBusy[item.id]}
                      className="text-xs bg-purple-50 hover:bg-purple-100 text-purple-700 px-2.5 py-1.5 rounded-lg font-medium transition-colors">
                      {backupBusy[item.id] ? "..." : "💾 Backup"}
                    </button>
                    {/* Delete */}
                    <button onClick={() => { if (confirm("Uninstall this app?")) deleteApp.mutate({ id: item.id }); }}
                      disabled={deleteApp.isPending}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1.5 font-medium">
                      ✕
                    </button>
                  </div>
                </div>

                {/* ── Backup result message ── */}
                {backupMsg[item.id] && (
                  <div className={`border-t border-slate-200 px-3 py-1.5 text-[11px] font-mono ${
                    backupMsg[item.id].startsWith("✓")
                      ? "bg-emerald-50 text-emerald-700"
                      : backupMsg[item.id].startsWith("✗")
                      ? "bg-red-50 text-red-700"
                      : "bg-blue-50 text-blue-700"
                  }`}>
                    {backupMsg[item.id]}
                  </div>
                )}

                {/* ── Details panel (status, health, uptime, image, ports, volumes) ── */}
                {insp.status && !openPanels[`${item.id}-logs`] && !openPanels[`${item.id}-env`] && (
                  <div className="border-t border-slate-200 px-3 py-2 bg-slate-50/50">
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      {insp.health && insp.health !== "none" && (
                        <span>Health: <span className={insp.health === "healthy" ? "text-emerald-600 font-medium" : "text-amber-600"}>{insp.health}</span></span>
                      )}
                      {insp.image && <span>Image: <span className="font-mono">{insp.image.split("/").pop()}</span></span>}
                      {insp.restartPolicy && <span>Restart: {insp.restartPolicy}</span>}
                      {insp.ports && <span>Ports: <span className="font-mono">{insp.ports}</span></span>}
                      {insp.volumes && <span>Volumes: {insp.volumes.split("|").length}</span>}
                    </div>
                  </div>
                )}

                {/* ── Logs panel ── */}
                {openPanels[`${item.id}-logs`] && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 font-medium uppercase">Container logs</span>
                        <select value={logLines} onChange={(e) => setLogLines(Number(e.target.value))}
                          className="text-[11px] bg-white border border-slate-200 rounded px-1 py-0.5">
                          <option value={50}>50 lines</option>
                          <option value={100}>100 lines</option>
                          <option value={500}>500 lines</option>
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => fetchLogs(item.id, logLines)}
                          className="text-[11px] text-emerald-600 hover:underline">↻ Refresh</button>
                        <button onClick={() => copyToClipboard(actionOutput[`${item.id}-logs`] || "")}
                          className="text-[11px] text-blue-600 hover:underline">📋 Copy</button>
                      </div>
                    </div>
                    {openPanels[`${item.id}-logs`] === "loading" ? (
                      <div className="text-xs text-slate-400 text-center py-4">Loading logs...</div>
                    ) : (
                      <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 max-h-64 overflow-y-auto whitespace-pre-wrap">
                        {actionOutput[`${item.id}-logs`] || "No output"}
                      </pre>
                    )}
                  </div>
                )}

                {/* ── Environment panel ── */}
                {openPanels[`${item.id}-env`] && (
                  <div className="border-t border-slate-200">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100">
                      <span className="text-[11px] text-slate-500 font-medium uppercase">Environment variables</span>
                      <div className="flex items-center gap-2">
                        <button onClick={() => setShowSecrets((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                          className="text-[11px] text-amber-600 hover:underline">
                          {showSecrets[item.id] ? "🔒 Hide secrets" : "👁 Show secrets"}
                        </button>
                        <button onClick={() => fetchEnv(item.id)}
                          className="text-[11px] text-emerald-600 hover:underline">↻ Refresh</button>
                      </div>
                    </div>

                    {openPanels[`${item.id}-env`] === "loading" ? (
                      <div className="text-xs text-slate-400 text-center py-4">Loading env...</div>
                    ) : editingEnv === item.id ? (
                      /* ── Edit mode ── */
                      <div className="p-3 space-y-2">
                        {Object.entries(editValues).map(([k, v]) => (
                          <div key={k} className="flex items-center gap-2">
                            <span className="text-xs font-mono text-slate-600 min-w-[120px] truncate">{k}=</span>
                            <input type={isSecret(k) && !showSecrets[item.id] ? "password" : "text"}
                              value={v}
                              onChange={(e) => setEditValues((prev) => ({ ...prev, [k]: e.target.value }))}
                              className="flex-1 text-xs font-mono px-2 py-1 border border-slate-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                          </div>
                        ))}
                        <div className="flex gap-2 pt-2">
                          <button onClick={() => saveEnvChanges(item.id)} disabled={savingEnv}
                            className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50">
                            {savingEnv ? "Saving..." : "💾 Save & restart"}
                          </button>
                          <button onClick={() => setEditingEnv(null)}
                            className="text-xs px-3 py-1.5 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300">
                            Cancel
                          </button>
                        </div>
                        {actionOutput[`${item.id}-env-save`] && (
                          <p className="text-xs text-slate-600">{actionOutput[`${item.id}-env-save`]}</p>
                        )}
                      </div>
                    ) : (
                      /* ── Display mode ── */
                      <div>
                        <div className="max-h-64 overflow-y-auto">
                          {(actionOutput[`${item.id}-env`] || "").split("\n").map((line, i) => {
                            const eqIdx = line.indexOf("=");
                            if (eqIdx < 1) return null;
                            const key = line.substring(0, eqIdx);
                            const val = line.substring(eqIdx + 1);
                            const secret = isSecret(key);
                            return (
                              <div key={i} className="flex items-center gap-2 px-3 py-1 hover:bg-slate-50 text-xs font-mono border-b border-slate-100 last:border-0">
                                <span className="text-slate-600 min-w-[140px] truncate">{key}</span>
                                <span className="text-slate-400">=</span>
                                <span className={`flex-1 truncate ${secret ? "text-slate-400" : "text-slate-800"}`}>
                                  {secret && !showSecrets[item.id] ? maskValue(val) : val}
                                </span>
                                {secret && !showSecrets[item.id] && (
                                  <span className="text-[10px] text-amber-500 shrink-0">🔒</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200">
                          <button onClick={() => startEditEnv(item)}
                            className="text-[11px] text-blue-600 hover:underline">
                            ✏️ Edit environment variables
                          </button>
                        </div>
                      </div>
                    )}
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

// ─── BackupSection (Phase 6) ───

function BackupSection({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: backups, isLoading } = trpc.backup.list.useQuery({ serverId });
  const discover = trpc.backup.discoverTargets.useMutation();
  const volumeBackup = trpc.backup.volumeBackup.useMutation();
  const dbBackup = trpc.backup.dbBackup.useMutation();
  const restoreVolume = trpc.backup.restoreVolume.useMutation();
  const restoreDb = trpc.backup.restoreDb.useMutation();
  const deleteBackup = trpc.backup.delete.useMutation();

  const [targets, setTargets] = useState<any>(null);
  const [actionMsg, setActionMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [selectedVolume, setSelectedVolume] = useState("");
  const [selectedDb, setSelectedDb] = useState({ container: "", type: "postgres", dbName: "" });
  const [restoreOpen, setRestoreOpen] = useState<string | null>(null);

  const handleDiscover = async () => {
    setActionMsg(null);
    try {
      const result = await discover.mutateAsync({ serverId });
      setTargets(result);
      if (result.success && result.volumes.length > 0 && !selectedVolume) {
        setSelectedVolume(result.volumes[0]);
      }
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message });
    }
  };

  const handleVolumeBackup = async () => {
    if (!selectedVolume) return;
    setActionMsg({ type: "success", text: "Starting backup..." });
    try {
      const result = (await volumeBackup.mutateAsync({ serverId, volumeName: selectedVolume })) as any;
      if (result.success) {
        setActionMsg({ type: "success", text: `Backup created: ${result.filename}` });
        utils.backup.list.invalidate({ serverId });
      } else {
        setActionMsg({ type: "error", text: "Backup failed" });
      }
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message });
    }
  };

  const handleDbBackup = async () => {
    if (!selectedDb.container) return;
    setActionMsg({ type: "success", text: "Starting database backup..." });
    try {
      const result = (await dbBackup.mutateAsync({
        serverId,
        containerName: selectedDb.container,
        dbType: selectedDb.type as any,
        dbName: selectedDb.dbName,
      })) as any;
      if (result.success) {
        setActionMsg({ type: "success", text: `Database backup created: ${result.filename}` });
        utils.backup.list.invalidate({ serverId });
      } else {
        setActionMsg({ type: "error", text: "Database backup failed" });
      }
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message });
    }
  };

  const handleRestore = async (backup: any) => {
    if (!confirm(`Restore ${backup.filename}? This will overwrite current data.`)) return;
    setActionMsg({ type: "success", text: "Restoring..." });
    try {
      let result;
      if (backup.type === "volume") {
        // Extract volume name from targetName
        result = await restoreVolume.mutateAsync({
          serverId,
          volumeName: backup.targetName,
          backupFilename: backup.filename,
        });
      } else {
        result = await restoreDb.mutateAsync({
          serverId,
          containerName: backup.targetName.split(":")[0],
          dbType: backup.type as any,
          backupFilename: backup.filename,
        });
      }
      if (result.success) {
        setActionMsg({ type: "success", text: `Restored successfully` });
      } else {
        setActionMsg({ type: "error", text: `Restore failed: ${(result as any).error || "unknown"}` });
      }
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this backup? The file on the server will also be removed.")) return;
    try {
      await deleteBackup.mutateAsync({ id });
      utils.backup.list.invalidate({ serverId });
    } catch (err: any) {
      setActionMsg({ type: "error", text: err.message });
    }
  };

  const formatSize = (bytes: number): string => {
    if (!bytes) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  };

  const formatDate = (d: Date | string) => new Date(d).toLocaleString();

  const typeIcons: Record<string, string> = {
    volume: "💾",
    postgres: "🐘",
    mysql: "🐬",
    mongodb: "🍃",
    redis: "🟥",
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-slate-900">🗄️ Backups</h2>
        <button onClick={handleDiscover} disabled={discover.isPending}
          className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1">
          <span className={discover.isPending ? "animate-pulse" : ""}>🔍</span>
          {discover.isPending ? "Scanning..." : "Discover"}
        </button>
      </div>

      {/* Create backup */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Volume backup */}
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-sm font-medium text-slate-700 mb-2">💾 Backup a volume</p>
          {targets && targets.volumes.length > 0 ? (
            <>
              <select value={selectedVolume} onChange={(e) => setSelectedVolume(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white mb-2">
                {targets.volumes.map((v: string) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              <button onClick={handleVolumeBackup}
                disabled={volumeBackup.isPending || !selectedVolume}
                className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
                {volumeBackup.isPending ? "Backing up..." : "Backup"}
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-400">Click Discover to scan volumes</p>
          )}
        </div>

        {/* DB backup */}
        <div className="bg-slate-50 rounded-xl p-4">
          <p className="text-sm font-medium text-slate-700 mb-2">🐘 Backup a database</p>
          {targets && targets.dbContainers.length > 0 ? (
            <>
              <select value={selectedDb.container}
                onChange={(e) => setSelectedDb((p) => ({ ...p, container: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white mb-2">
                <option value="">Select container</option>
                {targets.dbContainers.map((c: any) => (
                  <option key={c.name} value={c.name}>{c.name} ({c.image})</option>
                ))}
              </select>
              <select value={selectedDb.type}
                onChange={(e) => setSelectedDb((p) => ({ ...p, type: e.target.value }))}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white mb-2">
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL / MariaDB</option>
                <option value="mongodb">MongoDB</option>
                <option value="redis">Redis</option>
              </select>
              <input type="text" value={selectedDb.dbName}
                onChange={(e) => setSelectedDb((p) => ({ ...p, dbName: e.target.value }))}
                placeholder="DB name (optional)"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white mb-2" />
              <button onClick={handleDbBackup}
                disabled={dbBackup.isPending || !selectedDb.container}
                className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors">
                {dbBackup.isPending ? "Backing up..." : "Backup"}
              </button>
            </>
          ) : (
            <p className="text-xs text-slate-400">
              {targets ? "No DB containers found (postgres/mysql/mongo/redis)" : "Click Discover to scan containers"}
            </p>
          )}
        </div>
      </div>

      {/* Action message */}
      {actionMsg && (
        <div className={`text-xs px-3 py-2 rounded-lg mb-4 ${
          actionMsg.type === "success"
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-red-50 text-red-700 border border-red-200"
        }`}>
          {actionMsg.text}
        </div>
      )}

      {/* History */}
      <div>
        <h3 className="text-sm font-medium text-slate-700 mb-2">History</h3>
        {isLoading && <div className="text-sm text-slate-400 text-center py-3">Loading backups...</div>}
        {!isLoading && (!backups || backups.length === 0) && (
          <div className="text-sm text-slate-400 text-center py-4 border-2 border-dashed border-slate-200 rounded-xl">
            No backups yet. Discover volumes or DB containers and click Backup.
          </div>
        )}
        {backups && backups.length > 0 && (
          <div className="space-y-2">
            {backups.map((b: any) => {
              const isRunning = b.status === "running";
              const isFailed = b.status === "failed";
              return (
                <div key={b.id} className={`border rounded-xl overflow-hidden ${
                  isFailed ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"
                }`}>
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-base">{typeIcons[b.type] || "💾"}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {b.humanName || b.targetName}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                        {b.filename}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        {formatSize(b.sizeBytes)} · {formatDate(b.createdAt)}
                        {isRunning && <span className="ml-2 text-blue-600">⏳ Running</span>}
                        {isFailed && <span className="ml-2 text-red-600">❌ Failed</span>}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      {!isRunning && (
                        <button onClick={() => handleRestore(b)}
                          className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-2 py-1 rounded-lg font-medium">
                          ↻ Restore
                        </button>
                      )}
                      <button onClick={() => handleDelete(b.id)}
                        disabled={deleteBackup.isPending}
                        className="text-xs text-red-500 hover:text-red-700 px-2 py-1">
                        ✕
                      </button>
                    </div>
                  </div>
                  {isFailed && b.errorMessage && (
                    <div className="border-t border-red-200 px-3 py-2 text-xs text-red-700 font-mono break-words">
                      {b.errorMessage}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
