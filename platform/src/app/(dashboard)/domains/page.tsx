"use client";

import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useT } from "@/lib/i18n";

// ─── Helpers ───

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

// ─── Add Domain Modal ───

function AddDomainModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const _ = useT();
  const { data: servers } = trpc.server.list.useQuery();
  const addDomain = trpc.domain.add.useMutation({
    onSuccess: () => {
      onSuccess();
      onClose();
    },
  });

  const [name, setName] = useState("");
  const [serverId, setServerId] = useState("");
  const [port, setPort] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name.trim()) { setError(_("domains.add.error.required")); return; }
    if (!serverId) { setError(_("domains.add.error.server")); return; }
    setError("");
    try {
      await addDomain.mutateAsync({
        serverId,
        name: name.trim(),
        targetPort: port ? parseInt(port, 10) : undefined,
      });
    } catch (err: any) {
      setError(err.message || "Failed to add domain");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <h2 className="text-lg font-bold text-zinc-100 mb-4">{_("domains.add.title")}</h2>

        <div className="space-y-4">
          {/* Domain name */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">{_("domains.add.name")}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={_("domains.add.name.placeholder")}
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              autoFocus
            />
          </div>

          {/* Server selector */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">{_("domains.add.server")}</label>
            <select
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <option value="">{_("domains.add.server.select")}</option>
              {(servers || []).map((s: any) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.ip})
                </option>
              ))}
            </select>
          </div>

          {/* Port */}
          <div>
            <label className="block text-sm font-medium text-zinc-400 mb-1">{_("domains.add.port")}</label>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={_("domains.add.port.placeholder")}
              className="w-full px-4 py-2.5 bg-zinc-800 border border-zinc-700 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-sm font-medium hover:bg-zinc-700 transition-colors">
              {_("domains.add.cancel")}
            </button>
            <button onClick={handleSubmit} disabled={addDomain.isPending}
              className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
              {addDomain.isPending ? _("domains.add.submitting") : _("domains.add.submit")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Domain Status Cell ───

function DomainStatus({ domain }: { domain: any }) {
  const checkDns = trpc.domain.checkDns.useMutation();
  const checkSsl = trpc.domain.checkSsl.useMutation();
  const deleteDomain = trpc.domain.delete.useMutation();

  const [dnsResult, setDnsResult] = useState<any>(null);
  const [sslResult, setSslResult] = useState<any>(null);
  const [sslEnabled, setSslEnabled] = useState(domain.sslStatus === "active");
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  const handleDnsCheck = async () => {
    setLoading("dns");
    try {
      const r = await checkDns.mutateAsync({ id: domain.id });
      setDnsResult(r);
    } catch {}
    setLoading(null);
  };

  const handleSslCheck = async () => {
    setLoading("ssl");
    try {
      const r = await checkSsl.mutateAsync({ id: domain.id });
      setSslResult(r);
    } catch {}
    setLoading(null);
  };

  const handleEnableSsl = async () => {
    if (!confirm(`Enable SSL on ${domain.name}?`)) return;
    setLoading("ssl-enable");
    try {
      const res = await fetch("/api/domains/enable-ssl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainId: domain.id }),
      });
      const data = await res.json();
      if (data.success || data.url) {
        setSslEnabled(true);
        setSslResult({ ssl: true, daysLeft: 90 });
      }
    } catch {}
    setLoading(null);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete ${domain.name}?`)) return;
    setDeleting(true);
    try {
      await deleteDomain.mutateAsync({ id: domain.id });
    } catch {}
  };

  // Compute DNS badge
  const dnsOk = dnsResult?.status === "ok";
  const hasSsl = sslEnabled || (sslResult?.ssl === true);
  const sslExpiring = sslResult?.expiresSoon;
  const sslExpired = sslResult?.expired;

  return (
    <div className="flex items-center gap-3">
      {/* DNS status */}
      <div className="relative group">
        <button onClick={handleDnsCheck} disabled={loading === "dns"}
          className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold transition-colors ${
            loading === "dns" ? "animate-pulse bg-zinc-700 text-zinc-400" :
            dnsResult === null ? "bg-zinc-800 text-zinc-500 hover:bg-zinc-700" :
            dnsOk ? "bg-emerald-500/20 text-emerald-400" :
            "bg-red-500/20 text-red-400"
          }`}
          title={dnsResult ? `DNS: ${dnsResult.resolved} ${dnsOk ? "✓" : "✗"}` : "Check DNS"}
        >
          {loading === "dns" ? "..." : dnsResult === null ? "🌐" : dnsOk ? "✓" : "✗"}
        </button>
      </div>

      {/* SSL status */}
      {hasSsl ? (
        <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg font-medium ${
          sslExpired ? "bg-red-500/20 text-red-400" :
          sslExpiring ? "bg-amber-500/20 text-amber-400" :
          "bg-emerald-500/20 text-emerald-400"
        }`} title={sslResult?.daysLeft !== null ? `${sslResult.daysLeft}d remaining` : ""}>
          SSL
        </span>
      ) : (
        <button onClick={handleEnableSsl} disabled={loading === "ssl-enable"}
          className={`text-[11px] px-2 py-1 rounded-lg font-medium transition-colors ${
            loading === "ssl-enable" ? "animate-pulse bg-zinc-700 text-zinc-400" :
            "bg-zinc-800 text-zinc-500 hover:bg-emerald-500/20 hover:text-emerald-400"
          }`}>
          {loading === "ssl-enable" ? "..." : "SSL"}
        </button>
      )}

      {/* Actions */}
      {domain.name && (
        <a href={`https://${domain.name}`} target="_blank" rel="noopener noreferrer"
          className="text-[11px] px-2 py-1 rounded-lg font-medium bg-zinc-800 text-blue-400 hover:bg-blue-500/20 transition-colors">
          ↗
        </a>
      )}
      <button onClick={handleDelete} disabled={deleting}
        className="text-[11px] px-2 py-1 rounded-lg font-medium text-red-500 hover:bg-red-500/20 transition-colors">
        {deleting ? "..." : "✕"}
      </button>
    </div>
  );
}

// ─── Main Page ───

export default function DomainsPage() {
  const _ = useT();
  const { data: session } = useSession();
  const { data: domains, isLoading, error, refetch } = trpc.domain.listAll.useQuery();
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">{_("domains.title")}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {domains ? `${domains.length} ${_("domains.count")}` : _("domains.desc")}
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors shadow-sm">
          {_("domains.add")}
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-zinc-400 py-12 text-center">{_("loading")}</div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
          <p className="text-sm text-red-400">Error: {error.message}</p>
        </div>
      )}

      {/* Empty state */}
      {domains && domains.length === 0 && !isLoading && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
          <p className="text-5xl mb-4">🌍</p>
          <h2 className="text-lg font-semibold text-zinc-300 mb-2">{_("domains.empty")}</h2>
          <p className="text-sm text-zinc-500 mb-6">{_("domains.empty.desc")}</p>
          <button onClick={() => setShowModal(true)}
            className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors">
            {_("domains.add")}
          </button>
        </div>
      )}

      {/* Domain table */}
      {domains && domains.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-zinc-800/50 border-b border-zinc-800 text-xs font-medium text-zinc-500 uppercase tracking-wide">
            <div className="col-span-3">{_("domains.column.domain")}</div>
            <div className="col-span-3">{_("domains.column.server")}</div>
            <div className="col-span-2">{_("domains.column.target")}</div>
            <div className="col-span-2">{_("domains.column.status")}</div>
            <div className="col-span-2 text-right">{_("domains.column.actions")}</div>
          </div>

          {/* Table rows */}
          <div className="divide-y divide-zinc-800">
            {domains.map((d: any) => (
              <div key={d.id}
                className="grid grid-cols-12 gap-4 px-6 py-4 items-center hover:bg-zinc-800/30 transition-colors">
                {/* Domain name */}
                <div className="col-span-3">
                  <p className="text-sm font-mono text-zinc-100 truncate" title={d.name}>
                    {d.name}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    added {timeAgo(d.createdAt)}
                  </p>
                </div>

                {/* Server */}
                <div className="col-span-3">
                  <p className="text-sm text-zinc-200 truncate">{d.serverName}</p>
                  <p className="text-[11px] text-zinc-500 font-mono">{d.serverIp}</p>
                </div>

                {/* Target */}
                <div className="col-span-2">
                  {d.targetPort ? (
                    <p className="text-sm text-zinc-300">
                      port <span className="font-mono">{d.targetPort}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-zinc-500">—</p>
                  )}
                  {d.appName && (
                    <p className="text-[11px] text-zinc-500 truncate">{d.appName}</p>
                  )}
                </div>

                {/* Status */}
                <div className="col-span-2">
                  <div className="flex flex-wrap gap-1">
                    <span className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded-lg font-medium ${
                      d.sslStatus === "active"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-zinc-800 text-zinc-500"
                    }`}>
                      {d.sslStatus === "active" ? "SSL ✓" : "SSL pending"}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="col-span-2 flex justify-end">
                  <DomainStatus domain={d} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add domain modal */}
      {showModal && (
        <AddDomainModal
          onClose={() => setShowModal(false)}
          onSuccess={() => refetch()}
        />
      )}
    </div>
  );
}
