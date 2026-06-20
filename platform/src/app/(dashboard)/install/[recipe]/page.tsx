"use client";

import { trpc } from "@/lib/trpc";
import { useSession } from "next-auth/react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

export default function InstallPage() {
  const { recipe: recipeId } = useParams<{ recipe: string }>();
  const router = useRouter();

  const { data: recipe, isLoading: recipeLoading } = trpc.catalog.get.useQuery({ id: recipeId });
  const { data: servers } = trpc.server.list.useQuery();

  const [selectedServer, setSelectedServer] = useState("");
  const [domain, setDomain] = useState("");
  const [useDomain, setUseDomain] = useState(false);
  const [step, setStep] = useState<"form" | "scanning" | "installing" | "done" | "error">("form");
  const [scanResult, setScanResult] = useState<string>("");
  const [installLog, setInstallLog] = useState<string>("");
  const [installError, setInstallError] = useState<string>("");
  const [resultUrl, setResultUrl] = useState("");

  const selectedServerData = servers?.find((s) => s.id === selectedServer);

  const runInstall = async () => {
    if (!selectedServer || !recipe) return;
    setStep("scanning");
    setScanResult("Analyse du serveur en cours...");

    const defaultPort = (recipe as any)?.params?.port?.default || 80;
    const image = (recipe as any)?.params?.image?.default || recipeId;

    // Step 1: Scan ports
    const scanScript = `for p in ${defaultPort} $((defaultPort+1)) $((defaultPort+2)) $((defaultPort+3)) $((defaultPort+4)); do ss -tlnp | grep -q ":$p " && echo "BUSY:$p" || echo "FREE:$p"; done`;
    try {
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
        setScanResult(scanData.output);
        // Find free port
        const lines = (scanData.output || "").split("\n");
        let freePort = defaultPort;
        for (const line of lines) {
          if (line.startsWith("BUSY:")) {
            const busyPort = parseInt(line.split(":")[1]);
            if (busyPort === freePort) freePort = busyPort + 1;
          }
        }
        setScanResult(`Port ${defaultPort} → ${freePort !== defaultPort ? `occupé, utilise ${freePort}` : "libre ✅"}`);

        // Step 2: Install
        setStep("installing");
        const installScript = `docker pull ${image} && docker rm -f ${recipeId} 2>/dev/null; docker run -d --name ${recipeId} --restart unless-stopped -p ${freePort}:${defaultPort} ${image} 2>&1 && sleep 2 && curl -s -o /dev/null -w "%{http_code}" http://localhost:${freePort}`;
        
        const installRes = await fetch("/api/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            server_id: "unknown",
            command_id: `install-${Date.now()}`,
            script: installScript,
            timeout: 120,
          }),
        });
        const installData = await installRes.json();
        setInstallLog(installData.output || "");

        if (installData.success) {
          const appUrl = useDomain && domain
            ? `https://${domain}`
            : `http://${selectedServerData?.ip}:${freePort}`;
          setResultUrl(appUrl);
          setStep("done");
        } else {
          setInstallError(installData.error || "Échec de l'installation");
          setStep("error");
        }
      } else {
        setScanResult(`❌ Analyse impossible: ${scanData.error}`);
        setStep("error");
      }
    } catch (err: any) {
      setInstallError(err.message);
      setStep("error");
    }
  };

  if (recipeLoading) return <div className="text-slate-400">Chargement...</div>;
  if (!recipe) return <div className="text-center py-12"><h2 className="text-xl font-bold text-slate-700">Recette inconnue</h2></div>;

  return (
    <div className="max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <button onClick={() => step === "form" ? router.back() : setStep("form")}
          className="text-sm text-slate-500 hover:text-slate-700 mb-4 block">← Retour</button>
        <h1 className="text-2xl font-bold text-slate-900">Installer {recipe.name}</h1>
        {recipe.description && <p className="text-slate-500 mt-1 text-sm">{recipe.description}</p>}
      </div>

      {step === "form" && (
        <div className="space-y-6">
          {/* Server selection */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <label className="block text-sm font-semibold text-slate-700 mb-3">Serveur de destination</label>
            {servers && servers.length > 0 ? (
              <div className="space-y-2">
                {servers.filter((s) => s.status === "connected").map((server) => (
                  <label key={server.id}
                    className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedServer === server.id ? "border-emerald-500 bg-emerald-50" : "border-slate-200 hover:border-slate-300"
                    }`}>
                    <input type="radio" name="server" value={server.id}
                      checked={selectedServer === server.id}
                      onChange={(e) => setSelectedServer(e.target.value)} className="accent-emerald-600" />
                    <div>
                      <p className="font-medium text-slate-900">{server.name}</p>
                      <p className="text-xs text-slate-500 font-mono">{server.ip}</p>
                    </div>
                    <span className="ml-auto text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-lg">{server.status}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-slate-500 text-sm py-4">
                Aucun serveur connecté. <a href="/servers" className="text-emerald-600 hover:underline">Ajoutez-en un d'abord.</a>
              </div>
            )}
          </div>

          {/* Domain */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <label className="flex items-center gap-3 mb-3">
              <input type="checkbox" checked={useDomain}
                onChange={(e) => setUseDomain(e.target.checked)} className="accent-emerald-600" />
              <span className="text-sm font-semibold text-slate-700">Utiliser un domaine personnalisé</span>
            </label>
            {useDomain && (
              <input type="text" value={domain} onChange={(e) => setDomain(e.target.value)}
                placeholder="mon-app.mondomaine.com"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            )}
            <p className="text-xs text-slate-400 mt-2">
              {useDomain ? "Configurez votre DNS pour pointer vers ce serveur." : "L'application sera accessible via l'IP du serveur."}
            </p>
          </div>

          {/* Install button */}
          <button onClick={runInstall}
            disabled={!selectedServer}
            className="w-full py-3.5 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors text-base">
            Installer avec l'agent serveur
          </button>
        </div>
      )}

      {/* Scanning */}
      {step === "scanning" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center">
          <div className="animate-spin w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-700 mb-2">Analyse du serveur</h2>
          <p className="text-sm text-slate-500">Vérification des ports et prérequis...</p>
          {scanResult && <pre className="mt-4 text-xs bg-slate-50 p-3 rounded-lg text-slate-700">{scanResult}</pre>}
        </div>
      )}

      {/* Installing */}
      {step === "installing" && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="animate-spin w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full" />
            <h2 className="text-lg font-semibold text-slate-700">Installation en cours...</h2>
          </div>
          <pre className="text-xs font-mono bg-slate-900 text-slate-100 p-4 rounded-xl max-h-60 overflow-y-auto">
            {installLog || "Exécution..."}
          </pre>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 p-8 text-center">
          <p className="text-5xl mb-4">🎉</p>
          <h2 className="text-xl font-bold text-emerald-800 mb-2">Installation réussie !</h2>
          <p className="text-sm text-emerald-600 mb-6">{recipe.name} est maintenant accessible sur :</p>
          <a href={resultUrl} target="_blank"
            className="text-lg font-mono bg-white px-6 py-3 rounded-xl border border-emerald-300 text-emerald-700 hover:bg-emerald-50 inline-block">
            {resultUrl}
          </a>
          <div className="mt-6 flex gap-3 justify-center">
            <button onClick={() => router.push("/dashboard")}
              className="px-5 py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-medium hover:bg-emerald-700">
              Tableau de bord
            </button>
            <button onClick={() => setStep("form")}
              className="px-5 py-2.5 border border-emerald-300 text-emerald-700 rounded-xl text-sm font-medium hover:bg-emerald-50">
              Installer une autre app
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {step === "error" && (
        <div className="bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
          <p className="text-5xl mb-4">❌</p>
          <h2 className="text-xl font-bold text-red-800 mb-2">L'installation a échoué</h2>
          <pre className="text-xs text-left bg-red-100 p-4 rounded-xl max-h-40 overflow-y-auto mb-6">
            {installError || scanResult || "Erreur inconnue"}
          </pre>
          <div className="flex gap-3 justify-center">
            <button onClick={() => setStep("form")}
              className="px-5 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700">
              Réessayer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
