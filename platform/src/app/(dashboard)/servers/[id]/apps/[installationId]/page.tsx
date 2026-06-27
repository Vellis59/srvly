"use client";

import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

function timeAgo(d: Date | string | null | undefined): string {
  if (!d) return "";
  const n = new Date(), t = new Date(d);
  const m = Math.floor((n.getTime() - t.getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const day = Math.floor(h / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

export default function AppDetailPage() {
  const { id: serverId, installationId } = useParams<{ id: string; installationId: string }>();
  const router = useRouter();
  const { data: app, isLoading } = trpc.install.get.useQuery({ id: installationId });
  const [activeTab, setActiveTab] = useState<string>("actions");

  // Mutations
  const getLogs = trpc.install.logs.useMutation();
  const getEnv = trpc.install.getEnv.useMutation();
  const updateEnv = trpc.install.updateEnv.useMutation();
  const restartApp = trpc.install.restart.useMutation();
  const stopApp = trpc.install.stop.useMutation();
  const startApp = trpc.install.start.useMutation();
  const deleteApp = trpc.install.delete.useMutation({ onSuccess: () => router.push(`/servers/${serverId}`) });
  const backupApp = trpc.backup.appBackup.useMutation();
  const restoreMutation = trpc.backup.restoreApp.useMutation();
  const { data: backups } = trpc.backup.list.useQuery({ serverId, limit: 20 });
  const inspectApp = trpc.install.inspect.useMutation();
  const getStats = trpc.install.containerStats.useMutation();

  const [logLines, setLogLines] = useState(100);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [insp, setInsp] = useState<any>(null);
  const [statsData, setStatsData] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [envData, setEnvData] = useState<string>("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [showAllSecrets, setShowAllSecrets] = useState(false);
  const [editingEnv, setEditingEnv] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [savingEnv, setSavingEnv] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  if (isLoading) return <div className="p-8 text-zinc-400">Loading...</div>;
  if (!app) return <div className="p-8 text-zinc-500">App not found</div>;

  const params = (app.params || {}) as any;
  const status = app.status || "unknown";
  const appName = params.name || app.recipeId || "App";
  const containerName = params.containerName || params.name || app.recipeId;
  const hasUrl = params.domain || (params.port ? `${app.server?.ip || ""}:${params.port}` : null);
  const appIcon = app.recipe?.icon || null;

  const statusColors: Record<string, string> = {
    success: "bg-emerald-500", running: "bg-amber-400", failed: "bg-red-500", stopped: "bg-slate-400",
  };
  const statusLabels: Record<string, string> = {
    success: "Active", running: "Deploying", failed: "Error", stopped: "Stopped",
  };

  const runCmd = async (action: string, fn: any, extra?: any) => {
    setOutput((p) => ({ ...p, [action]: "Running..." }));
    try {
      const r = await fn.mutateAsync({ id: installationId, ...(extra || {}) });
      setOutput((p) => ({ ...p, [action]: r.output || r.message || "Done" }));
    } catch (err: any) {
      setOutput((p) => ({ ...p, [action]: `Error: ${err.message}` }));
    }
  };

  const fetchLogs = async () => {
    setOutput((p) => ({ ...p, logs: "Loading..." }));
    try {
      const r = await getLogs.mutateAsync({ id: installationId, lines: logLines });
      setOutput((p) => ({ ...p, logs: r.output || "No output" }));
    } catch (err: any) {
      setOutput((p) => ({ ...p, logs: `Error: ${err.message}` }));
    }
  };

  const fetchEnv = async () => {
    setOutput((p) => ({ ...p, env: "Loading..." }));
    try {
      const r = await getEnv.mutateAsync({ id: installationId });
      setEnvData(r.output || "");
      setOutput((p) => ({ ...p, env: r.output || "No env" }));
    } catch (err: any) {
      setOutput((p) => ({ ...p, env: `Error: ${err.message}` }));
    }
  };

  const startEditing = () => {
    const env: Record<string, string> = {};
    for (const line of (envData || "").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) env[line.substring(0, eq)] = line.substring(eq + 1);
    }
    setEditValues(env);
    setEditingEnv(true);
  };

  const saveEnvChanges = async () => {
    setSavingEnv(true);
    try {
      const r = await updateEnv.mutateAsync({ id: installationId, env: editValues }) as any;
      setOutput((p) => ({ ...p, "env-save": r.message || r.error || "Done" }));
      setEditingEnv(false);
      setShowAllSecrets(false);
      // Refresh env display
      fetchEnv();
    } catch (err: any) {
      setOutput((p) => ({ ...p, "env-save": `Error: ${err.message}` }));
    }
    setSavingEnv(false);
  };

  const fetchInspect = async () => {
    try {
      const r = await inspectApp.mutateAsync({ id: installationId }) as any;
      setInsp(r);
    } catch (err: any) {
      setInsp({ status: "error", error: err.message });
    }
  };

  const fetchStats = async () => {
    setStatsLoading(true);
    try {
      const result = await getStats.mutateAsync({ serverId }) as any;
      if (result.success && result.stats) {
        const cname = containerName;
        const s = result.stats[cname];
        if (s) {
          setStatsData({ cpu: s.cpu, mem: s.mem, memPct: s.memPct, disk: (result.sizes || {})[cname] || "—" });
        }
      }
    } catch {}
    setStatsLoading(false);
  };

  const handleBackup = async () => {
    setOutput((p) => ({ ...p, backup: "..." }));
    try {
      const r = (await backupApp.mutateAsync({ installationId })) as any;
      setOutput((p) => ({ ...p, backup: r.success ? `✅ ${r.filename}` : `❌ ${r.error || "failed"}` }));
    } catch (err: any) {
      setOutput((p) => ({ ...p, backup: `❌ ${err.message}` }));
    }
  };

  const handleRestore = async (b: any) => {
    if (!confirm(`Restore ${b.filename}?`)) return;
    setRestoreMsg("Restoring...");
    try {
      const r = (await restoreMutation.mutateAsync({ installationId, backupId: b.id })) as any;
      setRestoreMsg(r.success ? "✅ Restored" : `❌ ${r.error}`);
    } catch (err: any) {
      setRestoreMsg(`❌ ${err.message}`);
    }
  };

  const tabs = [
    { id: "actions", label: "⚡ Actions" },
    { id: "monitoring", label: "📊 Monitoring" },
    { id: "logs", label: "📋 Logs" },
    { id: "env", label: "🔑 .env" },
    { id: "backup", label: "💾 Backup" },
    { id: "agent", label: "🤖 Agent" },
    { id: "details", label: "🔍 Details" },
  ];

  const appBackups = (backups || []).filter((b: any) => b.installationId === installationId && b.status === "success");

  return (
    <div>
      {/* Back link */}
      <Link href={`/servers/${serverId}`} className="text-sm text-emerald-600 hover:underline mb-4 inline-block">
        ← Back to {app.server?.name || "server"}
      </Link>

      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
        <div className="flex items-center gap-4">
          {appIcon ? (
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-zinc-800 flex items-center justify-center border border-zinc-700">
              <img src={appIcon} alt={appName} className="w-9 h-9 object-contain" />
            </div>
          ) : (
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold text-white bg-emerald-500`}>
              {(appName || "A")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-zinc-100 truncate">{appName}</h1>
              <span className={`w-3 h-3 rounded-full ${statusColors[status] || "bg-slate-400"}`} />
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                status === "success" ? "bg-zinc-700 text-emerald-400" :
                status === "failed" ? "bg-zinc-700 text-red-400" :
                status === "running" ? "bg-zinc-700 text-amber-400" :
                "bg-zinc-800 text-zinc-300"
              }`}>{statusLabels[status] || status}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-zinc-500">
              <span className="font-mono">Port {params.port || "—"}</span>
              {params.domain && <span>• {params.domain}</span>}
              {params.image && <span>• {params.image.split("/").pop()}</span>}
              <span>• Installed {timeAgo(app.createdAt)}</span>
            </div>
            <div className="flex gap-2 mt-2">
              {(params.domain || params.port) && (
                <a href={`http://${hasUrl}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded-lg font-medium transition-colors inline-flex items-center gap-1">
                  ↗ Open
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 overflow-x-auto">
        {tabs.map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-emerald-600 text-white shadow-sm"
                : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Actions tab ── */}
      {activeTab === "actions" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <h2 className="font-semibold text-zinc-100 mb-4">Container actions</h2>
          <div className="flex flex-wrap gap-3 mb-4">
            <button onClick={() => runCmd("restart", restartApp)}
              className="px-4 py-2 bg-zinc-700 hover:bg-amber-200 text-amber-400 rounded-xl text-sm font-medium">⟳ Restart</button>
            {status !== "stopped" ? (
              <button onClick={() => runCmd("stop", stopApp)}
                className="px-4 py-2 bg-zinc-700 hover:bg-red-200 text-red-400 rounded-xl text-sm font-medium">⏹ Stop</button>
            ) : (
              <button onClick={() => runCmd("start", startApp)}
                className="px-4 py-2 bg-zinc-700 hover:bg-emerald-200 text-emerald-400 rounded-xl text-sm font-medium">▶ Start</button>
            )}
            <button onClick={handleBackup}
              className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl text-sm font-medium">💾 Backup</button>
            <button onClick={() => { if (confirm("Uninstall this app?")) deleteApp.mutate({ id: installationId }); }}
              disabled={deleteApp.isPending}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-red-600 rounded-xl text-sm font-medium">🗑 Delete</button>
          </div>
          {output.restart && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.restart}</pre>}
          {output.stop && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.stop}</pre>}
          {output.start && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.start}</pre>}
          {output.backup && <div className={`text-xs p-3 rounded-xl font-mono ${output.backup.startsWith("✅") ? "bg-zinc-800 text-emerald-400" : "bg-zinc-800 text-red-400"}`}>{output.backup}</div>}
        </div>
      )}

      {/* ── Logs tab ── */}
      {activeTab === "logs" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">Container logs</h2>
            <div className="flex items-center gap-2">
              <select value={logLines} onChange={(e) => setLogLines(Number(e.target.value))}
                className="text-xs px-2 py-1 border border-zinc-700 rounded-lg bg-zinc-900">
                <option value={50}>50 lines</option>
                <option value={100}>100 lines</option>
                <option value={500}>500 lines</option>
              </select>
              <button onClick={fetchLogs}
                className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-medium">↻ Load</button>
            </div>
          </div>
          {output.logs ? (
            <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-xl max-h-96 overflow-y-auto whitespace-pre-wrap">{output.logs}</pre>
          ) : (
            <div className="text-center py-8 text-zinc-400">
              <p>Click "Load" to fetch container logs</p>
            </div>
          )}
        </div>
      )}

      {/* ── Environment tab ── */}
      {activeTab === "env" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">🔑 Environment variables</h2>
            <div className="flex items-center gap-2">
              {output.env && !editingEnv && (
                <>
                  <button onClick={() => setShowAllSecrets((p) => !p)}
                    className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-amber-400 rounded-lg font-medium">
                    {showAllSecrets ? "🔒 Hide secrets" : "👁 Show secrets"}
                  </button>
                  <button onClick={() => startEditing()}
                    className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                    ✏️ Edit
                  </button>
                </>
              )}
              <button onClick={fetchEnv}
                className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium">
                ↻ Load
              </button>
            </div>
          </div>

          {!output.env ? (
            <div className="text-center py-8 text-zinc-400">
              <p>Click "Load" to fetch environment variables</p>
            </div>
          ) : editingEnv ? (
            /* ── Edit mode ── */
            <div>
              <div className="space-y-2 max-h-96 overflow-y-auto mb-4">
                {Object.entries(editValues).map(([k, v]) => {
                  const isSecret = /pass|secret|token|key|auth|credential|private/i.test(k);
                  return (
                    <div key={k} className="flex items-center gap-2 text-xs font-mono bg-zinc-800 rounded-lg px-3 py-1.5">
                      <span className="text-zinc-300 font-medium min-w-[140px] truncate">{k}=</span>
                      <input type={isSecret && !showSecrets[k] ? "password" : "text"}
                        value={v}
                        onChange={(e) => setEditValues((p) => ({ ...p, [k]: e.target.value }))}
                        className="flex-1 px-2 py-1 border border-zinc-700 rounded bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                      {isSecret && (
                        <button onClick={() => setShowSecrets((p) => ({ ...p, [k]: !p[k] }))}
                          className="text-[10px] text-blue-500 hover:text-blue-400 shrink-0">
                          {showSecrets[k] ? "🙈" : "👁️"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setEditingEnv(false); }}
                  className="text-xs px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-zinc-300 rounded-lg font-medium">
                  Cancel
                </button>
                <button onClick={saveEnvChanges}
                  disabled={savingEnv}
                  className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg font-medium">
                  {savingEnv ? "Saving..." : "💾 Save & restart"}
                </button>
              </div>
              {output["env-save"] && (
                <p className="text-xs text-zinc-500 mt-2">{output["env-save"]}</p>
              )}
            </div>
          ) : (
            /* ── Display mode ── */
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {envData.split("\n").filter(l => l.trim()).map((line, i) => {
                const eq = line.indexOf("=");
                if (eq < 0) return <pre key={i} className="text-xs font-mono text-zinc-500">{line}</pre>;
                const key = line.slice(0, eq);
                const val = line.slice(eq + 1);
                const secret = /pass|secret|token|key|auth|credential|private/i.test(key);
                const revealed = showAllSecrets || showSecrets[key];
                return (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono bg-zinc-800 rounded-lg px-3 py-1.5">
                    <span className="text-zinc-300 font-medium shrink-0">{key}</span>
                    <span className="text-zinc-400">=</span>
                    <span className={secret && !revealed ? "text-zinc-300" : "text-zinc-100 break-all"}>
                      {secret && !revealed ? "****" : val}
                    </span>
                    {secret && !showAllSecrets && (
                      <button onClick={() => setShowSecrets(p => ({ ...p, [key]: !p[key] }))}
                        className="text-[10px] text-blue-500 hover:text-blue-400 shrink-0">
                        {revealed ? "Hide" : "Show"}
                      </button>
                    )}
                    {secret && showAllSecrets && (
                      <span className="text-[10px] text-amber-500 shrink-0">🔓</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Monitoring tab ── */}
      {activeTab === "monitoring" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">📊 Container monitoring</h2>
            <div className="flex items-center gap-2">
              <button onClick={fetchStats}
                className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium">
                {statsLoading ? "⟳ Loading..." : "📡 Collect"}
              </button>
              <button onClick={fetchInspect}
                className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg font-medium">
                {insp ? "🔄 Refresh" : "🔍 Inspect"}
              </button>
            </div>
          </div>

          {statsData && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-400 uppercase mb-1">CPU</p>
                <p className="text-lg font-semibold text-zinc-100">{statsData.cpu || "—"}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-400 uppercase mb-1">RAM</p>
                <p className="text-lg font-semibold text-zinc-100">{statsData.mem || "—"}</p>
                <p className="text-[10px] text-zinc-400">{statsData.memPct ? "(" + statsData.memPct + ")" : ""}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-400 uppercase mb-1">Disk</p>
                <p className="text-lg font-semibold text-zinc-100">{statsData.disk || "—"}</p>
              </div>
              <div className="bg-zinc-800 rounded-xl p-3 text-center">
                <p className="text-xs text-zinc-400 uppercase mb-1">Network</p>
                {insp?.ports ? (
                  <>
                    <p className="text-lg font-semibold text-zinc-100">Active</p>
                    {insp.network && <p className="text-[10px] text-zinc-400">{insp.network}</p>}
                  </>
                ) : <p className="text-lg font-semibold text-zinc-100">—</p>}
              </div>
            </div>
          )}

          {insp && insp.status && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-zinc-300">Container info</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Health</p>
                  <p className={"text-sm font-mono font-medium mt-0.5 " + (
                    insp.health === "healthy" ? "text-emerald-400" :
                    insp.health === "unhealthy" ? "text-red-400" :
                    insp.health === "starting" ? "text-amber-400" :
                    "text-zinc-500"
                  )}>{insp.health || (insp.status === "running" ? "—" : insp.status)}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Image</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5 truncate">{(insp.image || "").split("/").pop() || "—"}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Restart</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5">{insp.restartPolicy || "—"}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Network</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5">{insp.network || "—"}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Uptime</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5">{insp.uptime || "—"}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Ports</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5 truncate">{insp.ports || "—"}</p>
                </div>
                <div className="bg-zinc-800 rounded-xl p-3">
                  <p className="text-[10px] text-zinc-400 uppercase">Volumes</p>
                  <p className="text-sm font-mono text-zinc-100 mt-0.5">{insp.volumes ? insp.volumes.split("|").length : "0"}</p>
                </div>
              </div>
            </div>
          )}

          {!statsData && !insp && (
            <div className="text-center py-8 text-zinc-400">
              <p>Click "Collect" to fetch live stats, or "Inspect" for container details</p>
            </div>
          )}
        </div>
      )}

      {/* ── Agent prompts tab ── */}
      {activeTab === "agent" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">🤖 AI agent prompts</h2>
            <p className="text-xs text-zinc-400">Copy a prompt to give your agent context</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              {id:"debug",label:"🐛 Debug",desc:"Diagnose issues with this app",
               prompt:("I need help debugging " + appName + " on server " + (app.server?.name || "my server") + ".\n\nContext:\n- App: " + appName + "\n- Container: " + containerName + "\n- Image: " + (params.image || "unknown") + "\n- Port: " + (params.port || "unknown") + "\n- Domain: " + (params.domain || "none") + "\n- Status: " + status + "\n\nPlease:\n1. SSH into the server and check container logs\n2. Check if the container is running\n3. Check port bindings\n4. Suggest fixes")},
              {id:"migrate",label:"📦 Migrate",desc:"Move this app to another server",
               prompt:("I need to migrate " + appName + " to a new server.\n\nCurrent:\n- App: " + appName + "\n- Container: " + containerName + "\n- Image: " + (params.image || "unknown") + "\n- Port: " + (params.port || "unknown") + "\n- Server: " + (app.server?.name || "unknown") + "\n\nPlease generate a migration plan: backup volumes, setup on new server, transfer, restore.")},
              {id:"update",label:"🔄 Update",desc:"Update to the latest version",
               prompt:("I need to update " + appName + ".\n\nCurrent:\n- Container: " + containerName + "\n- Image: " + (params.image || "unknown") + "\n- Port: " + (params.port || "unknown") + "\n\nPlease: backup volumes, pull the new image, stop old container, start new one, verify.")},
              {id:"backup-prompt",label:"💾 Backup",desc:"Full backup of all app data",
               prompt:("I need to backup " + appName + ".\n\nContainer: " + containerName + "\nPort: " + (params.port || "unknown") + "\n\nPlease: stop the container, backup Docker volumes, restart, verify.")},
              {id:"ssl",label:"🔒 SSL",desc:"Set up or renew SSL",
               prompt:("I need SSL for " + appName + ".\n\nDomain: " + (params.domain || "not set") + "\nPort: " + (params.port || "unknown") + "\n\n" + (params.domain ? "Please set up Let's Encrypt: DNS check, certbot, nginx config, auto-renewal." : "I need a domain configured first."))},
              {id:"config",label:"⚙️ Config",desc:"Modify configuration or env",
               prompt:("I need to modify the configuration of " + appName + ".\n\nContainer: " + containerName + "\n\nPlease: read current env, update variables or config files, restart container, verify.")},
              {id:"domain",label:"🌍 Domain",desc:"Add or change the domain",
               prompt:("I need to configure a domain for " + appName + ".\n\nContainer: " + containerName + "\nPort: " + (params.port || "unknown") + "\n" + (params.domain ? "- Current domain: " + params.domain : "\nPlease: configure DNS A record, set up Nginx/Caddy reverse proxy, enable SSL, verify."))},
            ].map((agent) => (
              <div key={agent.id} className="bg-zinc-800 rounded-xl p-4 border border-zinc-700">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-medium text-sm text-zinc-100">{agent.label}</p>
                  <button onClick={() => function(){try{var t=agent.prompt;if(navigator.clipboard&&window.isSecureContext)navigator.clipboard.writeText(t);else{var ta=document.createElement("textarea");ta.value=t;ta.style.cssText="position:fixed;left:0;top:0;width:0;height:0;opacity:0";document.body.appendChild(ta);ta.focus();ta.select();document.execCommand("copy");document.body.removeChild(ta)}}catch(e){}}()}
                    className="text-[10px] px-2 py-1 bg-zinc-900 border border-zinc-700 rounded-lg hover:bg-zinc-800 text-zinc-300 font-medium transition-colors">
                    Copy
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mb-2">{agent.desc}</p>
                <pre className="text-[10px] font-mono text-zinc-400 bg-zinc-950 rounded-lg p-2 max-h-24 overflow-y-auto whitespace-pre-wrap border border-zinc-700">
                  {agent.prompt.slice(0, 200)}{agent.prompt.length > 200 ? "..." : ""}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Backup tab ── */}
      {activeTab === "backup" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">Backups for this app</h2>
            <button onClick={handleBackup}
              className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg font-medium">💾 Create backup</button>
          </div>
          {output.backup && <div className={`text-xs p-3 rounded-xl mb-4 font-mono ${output.backup.startsWith("✅") ? "bg-zinc-800 text-emerald-400" : "bg-zinc-800 text-red-400"}`}>{output.backup}</div>}
          {restoreMsg && <div className={`text-xs p-3 rounded-xl mb-4 font-mono ${restoreMsg.startsWith("✅") ? "bg-zinc-800 text-emerald-400" : "bg-zinc-800 text-red-400"}`}>{restoreMsg}</div>}
          {appBackups.length === 0 ? (
            <div className="text-center py-8 text-zinc-400">
              <p>No backups yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {appBackups.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-zinc-800 rounded-xl">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-zinc-100 truncate">{b.filename}</p>
                    <p className="text-[11px] text-zinc-400">{new Date(b.createdAt).toLocaleString()}</p>
                  </div>
                  <button onClick={() => handleRestore(b)}
                    className="text-xs bg-zinc-700 hover:bg-emerald-200 text-emerald-400 px-3 py-1.5 rounded-lg font-medium shrink-0 ml-3">
                    ↻ Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Details tab ── */}
      {activeTab === "details" && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl border border-zinc-800 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-zinc-100">Container details</h2>
            <button onClick={fetchInspect}
              className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-lg font-medium">🔍 Inspect</button>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Image</p>
              <p className="text-sm font-mono text-zinc-100 truncate">{params.image || "—"}</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Port</p>
              <p className="text-sm font-mono text-zinc-100">{params.port || "—"}</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Container name</p>
              <p className="text-sm font-mono text-zinc-100 truncate">{containerName}</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Domain</p>
              <p className="text-sm font-mono text-zinc-100 truncate">{params.domain || "—"}</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Recipe</p>
              <p className="text-sm font-mono text-zinc-100 truncate">{app.recipeId || "—"}</p>
            </div>
            <div className="bg-zinc-800 rounded-xl p-3">
              <p className="text-xs text-zinc-400 uppercase mb-0.5">Created</p>
              <p className="text-sm font-mono text-zinc-100">{app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "—"}</p>
            </div>
          </div>

          {/* Inspect result */}
          {insp && insp.status && (
            <div className="border-t border-zinc-700 pt-4">
              <h3 className="text-sm font-medium text-zinc-300 mb-3">Docker inspect</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-xl">
                {insp.health && insp.health !== "none" && <div>Health: <span className={insp.health === "healthy" ? "text-emerald-400" : "text-amber-400"}>{insp.health}</span></div>}
                {insp.image && <div>Image: {insp.image.split("/").pop()}</div>}
                {insp.restartPolicy && <div>Restart: {insp.restartPolicy}</div>}
                {insp.ports && <div>Ports: {insp.ports}</div>}
                {insp.volumes && <div>Volumes: {insp.volumes.split("|").length}</div>}
                {insp.uptime && <div>Uptime: {insp.uptime}</div>}
                {insp.error && <div className="text-red-400">Error: {insp.error}</div>}
                {!insp.health && !insp.image && !insp.error && <div className="text-zinc-500">Inspect data available after clicking button</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
