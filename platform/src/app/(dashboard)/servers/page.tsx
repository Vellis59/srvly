"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Link from "next/link";

type Server = {
  id: string;
  name: string;
  ip: string;
  status: string;
  os: string | null;
  ram: number | null;
  createdAt: Date | string;
};

function AddServerModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const createServer = trpc.server.create.useMutation({
    onSuccess: (data) => {
      utils.server.list.invalidate();
      setCreatedServer(data);
    },
    onError: (err) => {
      alert("Error: " + err.message);
    },
  });
  const testConnection = trpc.server.testConnection.useMutation();
  const [name, setName] = useState("");
  const [ip, setIp] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [createdServer, setCreatedServer] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectStatus, setConnectStatus] = useState<string>("");

  if (createdServer) {
    const handleTestConnection = async () => {
      setConnecting(true);
      setConnectStatus("Testing SSH connection...");
      try {
        const result = await testConnection.mutateAsync({ id: createdServer.id });
        if (result.success) {
          setConnectStatus("Connected! Hostname: " + result.output.trim());
        } else {
          setConnectStatus("Failed: " + ((result as any).error || "Check the key was added to your server."));
        }
      } catch (err: any) {
        setConnectStatus("Error: " + err.message);
      }
      setConnecting(false);
    };

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl">
          <div className="text-center mb-6">
            <p className="text-4xl mb-3">🎉</p>
            <h2 className="text-xl font-bold text-slate-900">Server added!</h2>
            <p className="text-sm text-slate-500 mt-1">{createdServer.name}</p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 mb-2">
            <p className="text-xs text-slate-500 mb-1 font-medium uppercase tracking-wide">
              SSH Public Key
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-emerald-400 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
              {createdServer.sshPublicKey}
            </pre>
          </div>

          <div className="bg-amber-50 rounded-xl p-4 mb-6 border border-amber-200">
            <p className="text-xs text-amber-700 font-medium mb-2 uppercase tracking-wide">
              Run this on your server
            </p>
            <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all">
{`# One-command setup (run on your server as root):

curl -sL ${window.location.origin}/connect.sh | bash -s -- '${createdServer.sshPublicKey}'`}
            </pre>
            <p className="text-xs text-amber-600 mt-2">
              This will install the SSH key, set up Docker, UFW, and Fail2Ban.
              The connection is guarded by a cron job that runs hourly.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleTestConnection}
              disabled={connecting}
              className="w-full px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              {connecting ? "Testing..." : "Test connection"}
            </button>
            {connectStatus && (
              <p className="text-sm text-center text-slate-600">{connectStatus}</p>
            )}
            <button onClick={onClose}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <h2 className="text-xl font-bold mb-6">New server</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Server name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Hetzner VPS"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              IP Address
            </label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="123.123.123.123"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              SSH Public Key <span className="text-xs text-slate-400 font-normal">(optional — what's this? 🛈)</span>
            </label>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-2 text-xs text-blue-700">
              <p className="font-medium mb-1">💡 Don't worry if you don't know what this is.</p>
              <p>Leave this field <strong>empty</strong> and srvly will do everything automatically.
              After adding the server, just run the one-line command shown on the next screen.</p>
            </div>
            <textarea
              value={sshKey}
              onChange={(e) => setSshKey(e.target.value)}
              placeholder="Leave empty unless you want to use your own key"
              rows={2}
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              Paste a public key that is already authorized on your server.
              If left empty, srvly will generate a new key pair.
            </p>
          </div>

          <div className="bg-slate-50 rounded-xl p-4 text-sm text-slate-600">
            <p className="font-medium text-slate-800 mb-1">
              Next step
            </p>
            <p>
              After creation, an SSH key will be generated. You will install
              it on your server with a single command.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm font-medium hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={() => createServer.mutate({ name, ip, sshKey: sshKey || undefined })}
            disabled={!name || !ip || createServer.isPending}
            className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors">
            {createServer.isPending ? "Creating..." : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServerCard({ server }: { server: Server }) {
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
    <Link href={`/servers/${server.id}`}
      className="block bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-emerald-300 transition-all">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-slate-900">{server.name}</h3>
          <p className="text-sm text-slate-500 font-mono mt-0.5">
            {server.ip}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              statusColors[server.status] || "bg-slate-400"
            }`}
          />
          <span className="text-xs font-medium text-slate-600">
            {statusLabels[server.status] || server.status}
          </span>
        </div>
      </div>

      <div className="flex gap-4 text-sm text-slate-500">
        {server.os && (
          <span className="bg-slate-100 px-2 py-1 rounded-lg">{server.os}</span>
        )}
        {server.ram && (
          <span className="bg-slate-100 px-2 py-1 rounded-lg">
            {server.ram >= 1024
              ? `${(server.ram / 1024).toFixed(1)} GB`
              : `${server.ram} MB`}
          </span>
        )}
      </div>
    </Link>
  );
}

export default function ServersPage() {
  const { data: session } = useSession();
  const [showAdd, setShowAdd] = useState(false);
  const { data: servers, isLoading } = trpc.server.list.useQuery();

  if (!session) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Servers</h1>
          <p className="text-slate-500 mt-1">
            Manage your servers connected to the platform
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
        >
          + New server
        </button>
      </div>

      {isLoading ? (
        <div className="text-slate-400">Loading...</div>
      ) : servers && servers.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      ) : (
        <div className="bg-slate-50 rounded-2xl p-12 text-center">
          <p className="text-5xl mb-4">♝</p>
          <h2 className="text-lg font-semibold text-slate-700 mb-2">
            No servers yet
          </h2>
          <p className="text-sm text-slate-500 mb-6">
            Add your first VPS to start deploying apps.
          </p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700 transition-colors"
          >
            + Add a server
          </button>
        </div>
      )}

      {showAdd && <AddServerModal onClose={() => setShowAdd(false)} />}
    </div>
  );
}
