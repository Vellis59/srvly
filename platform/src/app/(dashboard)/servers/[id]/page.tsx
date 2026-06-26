"use client";

import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

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
  const executeMut = trpc.server.execute.useMutation();
  const testConnection = trpc.server.testConnection.useMutation();
  const [running, setRunning] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState(false);
  const [scanning, setScanning] = useState(false);

  const runAction = async (action: keyof typeof ACTIONS) => {
    setRunning(action);
    setResults((prev) => ({ ...prev, [action]: "Running..." }));

    try {
      const result = await executeMut.mutateAsync({ id, script: ACTIONS[action].script, timeout: 120 });
      if (result.success) {
        setResults((prev) => ({ ...prev, [action]: result.output || "Done" }));
      } else {
        setResults((prev) => ({ ...prev, [action]: `Error: ${((result as any).error) || result.output || "unknown"}` }));
      }
    } catch (err: any) {
      setResults((prev) => ({ ...prev, [action]: `Connection error: ${err.message}` }));
    }
    setRunning(null);
  };

  const router = useRouter();
  const deleteServer = trpc.server.delete.useMutation({
    onSuccess: () => router.push("/servers"),
    onError: (err) => alert("Error: " + err.message),
  });

  const detectServer = async () => {
    setScanning(true);
    try {
      await testConnection.mutateAsync({ id });
      refetch();
    } catch {}
    setScanning(false);
  };

  if (isLoading) return <div className="text-slate-400">Loading...</div>;
  if (!server) return <div className="text-slate-500">Server not found</div>;

  const sysInfo = (server.systemInfo || {}) as Record<string, any>;

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
        {deleteServer.isPending ? (
          <p className="text-sm text-red-500 mt-2">Deleting...</p>
        ) : (
          <button
            onClick={() => { if (confirm("Delete this server?")) deleteServer.mutate({ id: server.id }); }}
            className="text-sm text-red-500 hover:text-red-700 mt-2 transition-colors"
          >
            Delete this server
          </button>
        )}
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-slate-200 p-4 relative">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">OS</p>
          <p className="text-sm font-medium">{server.os || "Not detected"}</p>
          {!server.os && (
            <button onClick={detectServer} disabled={scanning}
              className="absolute top-2 right-2 text-xs text-emerald-600 hover:text-emerald-800">
              {scanning ? "..." : "Detect"}
            </button>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 relative">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">RAM</p>
          <p className="text-sm font-medium">
            {sysInfo.ramUsed
              ? `${(sysInfo.ramUsed / 1024).toFixed(1)} / ${(sysInfo.ramTotal / 1024).toFixed(1)} GB`
              : server.ram
                ? `${(server.ram / 1024).toFixed(1)} GB`
                : "Not detected"}
          </p>
          {sysInfo.ramUsed && (
            <p className="text-xs text-slate-400 mt-0.5">
              Free: {(sysInfo.ramAvailable / 1024).toFixed(1)} GB
            </p>
          )}
          {!server.ram && (
            <button onClick={detectServer} disabled={scanning}
              className="absolute top-2 right-2 text-xs text-emerald-600 hover:text-emerald-800">
              {scanning ? "..." : "Detect"}
            </button>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 relative">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Disk</p>
          <p className="text-sm font-medium">
            {sysInfo.diskTotal
              ? `${sysInfo.diskUsed} / ${sysInfo.diskTotal} GB`
              : "Not detected"}
          </p>
          {sysInfo.diskTotal && (
            <p className="text-xs text-slate-400 mt-0.5">
              Free: {sysInfo.diskAvailable} GB
            </p>
          )}
          {!sysInfo.diskTotal && (
            <button onClick={detectServer} disabled={scanning}
              className="absolute top-2 right-2 text-xs text-emerald-600 hover:text-emerald-800">
              {scanning ? "..." : "Detect"}
            </button>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Uptime</p>
          <p className="text-sm font-medium">{sysInfo.uptime || "—"}</p>
        </div>
      </div>

      {/* Actions */}
      {server.status === "connected" && (
        <>
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

          <h2 className="text-lg font-semibold text-slate-900 mb-4">Available actions</h2>
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

          {Object.entries(results).length > 0 && (
            <div className="space-y-4 mb-8">
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

          <InstalledApps serverId={server.id} />
          <DomainSection serverId={server.id} />
        </>
      )}

      {/* Not connected message */}
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

          <button
            onClick={async () => {
              setTesting(true);
              try {
                const result = await testConnection.mutateAsync({ id });
                if (result.success) {
                  refetch();
                } else {
                  alert("Failed: " + ((result as any).error || "Connection failed"));
                }
              } catch (err: any) {
                alert("Error: " + err.message);
              }
              setTesting(false);
            }}
            disabled={testing}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
        </div>
      )}
    </div>
  );
}

function DomainSection({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: domains } = trpc.domain.list.useQuery({ serverId });
  const addDomain = trpc.domain.add.useMutation({
    onSuccess: () => utils.domain.list.invalidate({ serverId }),
  });
  const deleteDomain = trpc.domain.delete.useMutation({
    onSuccess: () => utils.domain.list.invalidate({ serverId }),
  });

  const [name, setName] = useState("");
  const [port, setPort] = useState("");

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <h2 className="font-semibold text-slate-900 mb-2">Domains</h2>
      <p className="text-sm text-slate-500 mb-4">
        Add a custom domain pointing to an installed app (automatic Nginx reverse proxy).
      </p>

      {domains && domains.length > 0 && (
        <div className="space-y-2 mb-4">
          {domains.map((d) => (
            <DomainItem
              key={d.id}
              domain={d}
              onDelete={() => { if (confirm("Delete " + d.name + " ?")) deleteDomain.mutate({ id: d.id }); }}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="app.yourdomain.com"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <input
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          placeholder="target port (80, 3000...)"
          className="w-full md:w-48 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <button
          onClick={() => {
            if (!name) return;
            addDomain.mutate({ serverId, name, targetPort: port ? parseInt(port) : undefined });
            setName("");
            setPort("");
          }}
          disabled={addDomain.isPending}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
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
    } catch (err: any) {
      setStatus("Error: " + err.message);
    }
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
            port {domain.targetPort || "—"} • SSL {domain.sslStatus}
          </p>
        </div>
        {domain.sslStatus !== "active" && (
          <button
            onClick={enableSsl}
            disabled={loading}
            className="text-sm bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg hover:bg-emerald-100 disabled:opacity-50"
          >
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

function InstalledApps({ serverId }: { serverId: string }) {
  const utils = trpc.useUtils();
  const { data: installations } = trpc.install.listForServer.useQuery({ serverId });
  const deleteApp = trpc.install.delete.useMutation({
    onSuccess: () => utils.install.listForServer.invalidate({ serverId }),
  });
  const restartApp = trpc.install.restart.useMutation({
    onSuccess: () => utils.install.listForServer.invalidate({ serverId }),
  });
  const stopApp = trpc.install.stop.useMutation({
    onSuccess: () => utils.install.listForServer.invalidate({ serverId }),
  });
  const startApp = trpc.install.start.useMutation({
    onSuccess: () => utils.install.listForServer.invalidate({ serverId }),
  });
  const getLogs = trpc.install.logs.useMutation();
  const getEnv = trpc.install.getEnv.useMutation();
  const [actionOutput, setActionOutput] = useState<Record<string, string>>({});

  const runAction = async (id: string, action: string, fn: any) => {
    setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: "..." }));
    try {
      const result = await fn.mutateAsync({ id });
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: result.output || result.message || "Done" }));
    } catch (err: any) {
      setActionOutput((prev) => ({ ...prev, [`${id}-${action}`]: `Error: ${err.message}` }));
    }
  };

  const apps = installations || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
      <h2 className="font-semibold text-slate-900 mb-4">Installed apps</h2>
      {apps.length === 0 ? (
        <div className="text-sm text-slate-500 text-center py-6 border-2 border-dashed border-slate-200 rounded-xl">
          No installations. Launch an app via the AI assistant.
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

            return (
              <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-slate-50">
                  <span className={`w-2.5 h-2.5 rounded-full ${statusColors[status] || "bg-slate-400"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-slate-900">{params.name || item.recipeId || "App"}</p>
                    <p className="text-xs text-slate-500">
                      {params.port && `Port ${params.port}`}
                      {params.domain && ` • ${params.domain}`}
                      {!params.port && !params.domain && `Status: ${status}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => runAction(item.id, "logs", getLogs)}
                      className="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded-lg">Logs</button>
                    <button onClick={() => runAction(item.id, "restart", restartApp)}
                      disabled={restartApp.isPending}
                      className="text-xs bg-amber-100 hover:bg-amber-200 text-amber-700 px-2 py-1 rounded-lg">↻</button>
                    {status !== "stopped" ? (
                      <button onClick={() => runAction(item.id, "stop", stopApp)}
                        disabled={stopApp.isPending}
                        className="text-xs bg-red-100 hover:bg-red-200 text-red-700 px-2 py-1 rounded-lg">⏹</button>
                    ) : (
                      <button onClick={() => runAction(item.id, "start", startApp)}
                        disabled={startApp.isPending}
                        className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-2 py-1 rounded-lg">▶</button>
                    )}
                    <button onClick={() => runAction(item.id, "env", getEnv)}
                      className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded-lg">.env</button>
                    <button onClick={() => { if (confirm("Uninstall?")) deleteApp.mutate({ id: item.id }); }}
                      disabled={deleteApp.isPending}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1">✕</button>
                  </div>
                </div>
                {actionOutput[`${item.id}-logs`] && (
                  <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 max-h-40 overflow-y-auto border-t border-slate-200">
                    {actionOutput[`${item.id}-logs`]}
                  </pre>
                )}
                {actionOutput[`${item.id}-env`] && (
                  <pre className="text-xs font-mono bg-slate-900 text-emerald-300 p-3 max-h-40 overflow-y-auto border-t border-slate-200">
                    {actionOutput[`${item.id}-env`]}
                  </pre>
                )}
                {(actionOutput[`${item.id}-restart`] || actionOutput[`${item.id}-stop`] || actionOutput[`${item.id}-start`]) && (
                  <p className="text-xs text-slate-500 px-3 py-1 border-t border-slate-100">
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
