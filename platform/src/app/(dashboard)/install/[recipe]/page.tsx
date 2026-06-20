"use client";

import { trpc } from "@/lib/trpc";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function InstallPage() {
  const { recipe: recipeId } = useParams<{ recipe: string }>();
  const router = useRouter();

  const { data: recipe, isLoading } = trpc.catalog.get.useQuery({ id: recipeId });
  const { data: servers } = trpc.server.list.useQuery();
  const install = trpc.install.create.useMutation();

  const [selectedServer, setSelectedServer] = useState("");
  const [domain, setDomain] = useState("");
  const [useDomain, setUseDomain] = useState(false);
  const [step, setStep] = useState<"form" | "preparing" | "result">("form");
  const [result, setResult] = useState<string>("");
  const [error, setError] = useState<string>("");

  const selectedServerData = servers?.find((s) => s.id === selectedServer);

  const r = async () => {
    if (!selectedServer || !recipe) return;
    setStep("preparing");
    setResult("Analyse du serveur...");

    const recipeData = recipe.recipe as any;
    const defaultPort = recipeData?.params?.port?.default || 80;
    let freePort = defaultPort;

    // Step 1: scan ports
    try {
      const scanScript = `for p in ${defaultPort} $((defaultPort+1)) $((defaultPort+2)); do ss -tlnp | grep -q ":$p " && echo "BUSY:$p" || echo "FREE:$p"; done`;
      const scanRes = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          server_id: "unknown",
          command_id: `scan-${Date.now()}`,
          script: scanScript,
          timeout: 15,
        }),
      });
      const scanData = await scanRes.json();
      if (scanData.success) {
        const lines = (scanData.output || "").split("\n");
        for (const line of lines) {
          if (line.startsWith("BUSY:") && parseInt(line.split(":")[1]) === freePort) {
            freePort++;
          }
        }
        setResult(`Port ${defaultPort} → ${freePort !== defaultPort ? `occupé, utilise ${freePort}` : "libre ✅"}`);
      } else {
        setResult(`Scan: ${scanData.error || "échec"}, port par défaut ${defaultPort}`);
      }
    } catch (err: any) {
      setResult(`Scan impossible: ${err.message}, port ${defaultPort}`);
    }

    // Step 2: call mutation
    try {
      const res = await install.mutateAsync({
        serverId: selectedServer,
        recipeId,
        port: freePort,
      });
      setResult(res.message || "Installation lancée !");
      setStep("result");
    } catch (err: any) {
      setError(err.message || "Échec de l'installation");
      setStep("result");
    }
  };

  if (isLoading) return <div className="text-slate-400">Chargement...</div>;
  if (!recipe) return <div className="text-center py-12"><h2 className="text-xl font-bold">Recette introuvable</h2></div>;

  return (
    <div className="max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700 mb-4 block">← Retour</button>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Installer {recipe.name}</h1>
      {recipe.description && <p className="text-slate-500 text-sm mb-6">{recipe.description}</p>}

      {step === "form" && (
        <div className="space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Serveur de destination</h2>
            {servers?.filter(s => s.status === "connected").map(s => (
              <label key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer mb-2 ${selectedServer === s.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200"}`}>
                <input type="radio" name="server" value={s.id} checked={selectedServer === s.id}
                  onChange={e => setSelectedServer(e.target.value)} className="accent-emerald-600" />
                <span className="font-medium text-sm">{s.name}</span>
                <span className="text-xs text-slate-500 font-mono">{s.ip}</span>
              </label>
            ))}
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <label className="flex items-center gap-3 mb-3">
              <input type="checkbox" checked={useDomain} onChange={e => setUseDomain(e.target.checked)} className="accent-emerald-600" />
              <span className="text-sm font-semibold text-slate-700">Utiliser un domaine</span>
            </label>
            {useDomain && (
              <input type="text" value={domain} onChange={e => setDomain(e.target.value)}
                placeholder="app.mondomaine.com" className="w-full px-4 py-2.5 border rounded-xl text-sm" />
            )}
          </div>

          <button onClick={r} disabled={!selectedServer || install.isPending}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {install.isPending ? "Installation..." : "Installer avec l'agent serveur"}
          </button>
        </div>
      )}

      {step === "preparing" && (
        <div className="bg-white rounded-2xl border p-8 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-600 text-sm">{result}</p>
        </div>
      )}

      {step === "result" && (
        <div className={`rounded-2xl border p-8 text-center ${error ? "bg-red-50 border-red-200" : "bg-emerald-50 border-emerald-200"}`}>
          {error ? (
            <>
              <p className="text-4xl mb-3">❌</p>
              <h2 className="text-lg font-bold text-red-800 mb-2">Échec</h2>
              <pre className="text-xs bg-red-100 p-3 rounded-lg max-h-40 overflow-y-auto mb-4">{error}</pre>
              <button onClick={() => setStep("form")} className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm">Réessayer</button>
            </>
          ) : (
            <>
              <p className="text-4xl mb-3">🎉</p>
              <h2 className="text-lg font-bold text-emerald-800 mb-2">Installation lancée !</h2>
              <p className="text-sm text-emerald-600 mb-4">{result}</p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => router.push("/dashboard")} className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm">Dashboard</button>
                <button onClick={() => setStep("form")} className="px-5 py-2.5 border border-emerald-300 text-emerald-700 rounded-xl text-sm">Installer une autre app</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
