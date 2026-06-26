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
  const restartApp = trpc.install.restart.useMutation();
  const stopApp = trpc.install.stop.useMutation();
  const startApp = trpc.install.start.useMutation();
  const deleteApp = trpc.install.delete.useMutation({ onSuccess: () => router.push(`/servers/${serverId}`) });
  const backupApp = trpc.backup.appBackup.useMutation();
  const restoreMutation = trpc.backup.restoreApp.useMutation();
  const { data: backups } = trpc.backup.list.useQuery({ serverId, limit: 20 });
  const inspectApp = trpc.install.inspect.useMutation();

  const [logLines, setLogLines] = useState(100);
  const [output, setOutput] = useState<Record<string, string>>({});
  const [insp, setInsp] = useState<any>(null);
  const [envData, setEnvData] = useState<string>("");
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [restoreMsg, setRestoreMsg] = useState("");

  if (isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!app) return <div className="p-8 text-slate-500">App not found</div>;

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

  const fetchInspect = async () => {
    try {
      const r = await inspectApp.mutateAsync({ id: installationId }) as any;
      setInsp(r);
    } catch (err: any) {
      setInsp({ status: "error", error: err.message });
    }
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
    { id: "logs", label: "📋 Logs" },
    { id: "env", label: "🔑 .env" },
    { id: "backup", label: "💾 Backup" },
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
      <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
        <div className="flex items-center gap-4">
          {appIcon ? (
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-50 flex items-center justify-center border border-slate-200">
              <img src={appIcon} alt={appName} className="w-9 h-9 object-contain" />
            </div>
          ) : (
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center text-2xl font-bold text-white bg-emerald-500`}>
              {(appName || "A")[0].toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-bold text-slate-900 truncate">{appName}</h1>
              <span className={`w-3 h-3 rounded-full ${statusColors[status] || "bg-slate-400"}`} />
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                status === "success" ? "bg-emerald-100 text-emerald-700" :
                status === "failed" ? "bg-red-100 text-red-700" :
                status === "running" ? "bg-amber-100 text-amber-700" :
                "bg-slate-100 text-slate-600"
              }`}>{statusLabels[status] || status}</span>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-500">
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
                : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
            }`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Actions tab ── */}
      {activeTab === "actions" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <h2 className="font-semibold text-slate-900 mb-4">Container actions</h2>
          <div className="flex flex-wrap gap-3 mb-4">
            <button onClick={() => runCmd("restart", restartApp)}
              className="px-4 py-2 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-xl text-sm font-medium">⟳ Restart</button>
            {status !== "stopped" ? (
              <button onClick={() => runCmd("stop", stopApp)}
                className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-xl text-sm font-medium">⏹ Stop</button>
            ) : (
              <button onClick={() => runCmd("start", startApp)}
                className="px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-xl text-sm font-medium">▶ Start</button>
            )}
            <button onClick={handleBackup}
              className="px-4 py-2 bg-purple-100 hover:bg-purple-200 text-purple-700 rounded-xl text-sm font-medium">💾 Backup</button>
            <button onClick={() => { if (confirm("Uninstall this app?")) deleteApp.mutate({ id: installationId }); }}
              disabled={deleteApp.isPending}
              className="px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl text-sm font-medium">🗑 Delete</button>
          </div>
          {output.restart && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.restart}</pre>}
          {output.stop && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.stop}</pre>}
          {output.start && <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-xl mb-2 max-h-40 overflow-y-auto">{output.start}</pre>}
          {output.backup && <div className={`text-xs p-3 rounded-xl font-mono ${output.backup.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{output.backup}</div>}
        </div>
      )}

      {/* ── Logs tab ── */}
      {activeTab === "logs" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Container logs</h2>
            <div className="flex items-center gap-2">
              <select value={logLines} onChange={(e) => setLogLines(Number(e.target.value))}
                className="text-xs px-2 py-1 border border-slate-200 rounded-lg bg-white">
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
            <div className="text-center py-8 text-slate-400">
              <p>Click "Load" to fetch container logs</p>
            </div>
          )}
        </div>
      )}

      {/* ── Environment tab ── */}
      {activeTab === "env" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Environment variables</h2>
            <button onClick={fetchEnv}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-lg font-medium">↻ Load</button>
          </div>
          {output.env ? (
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {envData.split("\n").filter(l => l.trim()).map((line, i) => {
                const eq = line.indexOf("=");
                if (eq < 0) return <pre key={i} className="text-xs font-mono text-slate-500">{line}</pre>;
                const key = line.slice(0, eq);
                const val = line.slice(eq + 1);
                const secret = /pass|secret|token|key|auth|credential|private/i.test(key);
                const revealed = showSecrets[key];
                return (
                  <div key={i} className="flex items-center gap-2 text-xs font-mono bg-slate-50 rounded-lg px-3 py-1.5">
                    <span className="text-slate-700 font-medium shrink-0">{key}</span>
                    <span className="text-slate-400">=</span>
                    <span className={secret && !revealed ? "text-slate-300" : "text-slate-900 break-all"}>
                      {secret && !revealed ? "****" : val}
                    </span>
                    {secret && (
                      <button onClick={() => setShowSecrets(p => ({ ...p, [key]: !revealed }))}
                        className="text-[10px] text-blue-500 hover:text-blue-700 shrink-0">
                        {revealed ? "Hide" : "Show"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-400">
              <p>Click "Load" to fetch environment variables</p>
            </div>
          )}
        </div>
      )}

      {/* ── Backup tab ── */}
      {activeTab === "backup" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Backups for this app</h2>
            <button onClick={handleBackup}
              className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg font-medium">💾 Create backup</button>
          </div>
          {output.backup && <div className={`text-xs p-3 rounded-xl mb-4 font-mono ${output.backup.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{output.backup}</div>}
          {restoreMsg && <div className={`text-xs p-3 rounded-xl mb-4 font-mono ${restoreMsg.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{restoreMsg}</div>}
          {appBackups.length === 0 ? (
            <div className="text-center py-8 text-slate-400">
              <p>No backups yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {appBackups.map((b: any) => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-slate-900 truncate">{b.filename}</p>
                    <p className="text-[11px] text-slate-400">{new Date(b.createdAt).toLocaleString()}</p>
                  </div>
                  <button onClick={() => handleRestore(b)}
                    className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-1.5 rounded-lg font-medium shrink-0 ml-3">
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
        <div className="bg-white rounded-2xl border border-slate-200 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Container details</h2>
            <button onClick={fetchInspect}
              className="text-xs px-3 py-1.5 bg-slate-600 text-white rounded-lg font-medium">🔍 Inspect</button>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Image</p>
              <p className="text-sm font-mono text-slate-900 truncate">{params.image || "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Port</p>
              <p className="text-sm font-mono text-slate-900">{params.port || "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Container name</p>
              <p className="text-sm font-mono text-slate-900 truncate">{containerName}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Domain</p>
              <p className="text-sm font-mono text-slate-900 truncate">{params.domain || "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Recipe</p>
              <p className="text-sm font-mono text-slate-900 truncate">{app.recipeId || "—"}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 uppercase mb-0.5">Created</p>
              <p className="text-sm font-mono text-slate-900">{app.createdAt ? new Date(app.createdAt).toLocaleDateString() : "—"}</p>
            </div>
          </div>

          {/* Inspect result */}
          {insp && insp.status && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="text-sm font-medium text-slate-700 mb-3">Docker inspect</h3>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-xl">
                {insp.health && insp.health !== "none" && <div>Health: <span className={insp.health === "healthy" ? "text-emerald-400" : "text-amber-400"}>{insp.health}</span></div>}
                {insp.image && <div>Image: {insp.image.split("/").pop()}</div>}
                {insp.restartPolicy && <div>Restart: {insp.restartPolicy}</div>}
                {insp.ports && <div>Ports: {insp.ports}</div>}
                {insp.volumes && <div>Volumes: {insp.volumes.split("|").length}</div>}
                {insp.uptime && <div>Uptime: {insp.uptime}</div>}
                {insp.error && <div className="text-red-400">Error: {insp.error}</div>}
                {!insp.health && !insp.image && !insp.error && <div className="text-slate-500">Inspect data available after clicking button</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
