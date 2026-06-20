"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };
type Recommendation = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  dependencies: string[];
  defaultPort: number | null;
  installUrl: string;
  reason: string;
};

type WizardStep = "domain" | "port" | "ssl" | "confirm" | "running";
type Wizard = {
  app: Recommendation;
  step: WizardStep;
  domain?: string;
  port?: number;
  ssl?: boolean;
};

const STARTERS = [
  "Installe Ghost pour faire un blog",
  "Je veux automatiser des tâches entre mes apps",
  "Installe un outil pour surveiller mes sites",
  "Je veux remplacer Google Drive en self-hosted",
];

function isInstallIntent(text: string) {
  return /\b(installe|installer|lance|déploie|deploie|mets|met moi|crée|cree)\b/i.test(text);
}

function isActionableNeed(text: string) {
  return /\b(je veux|je cherche|j'aimerais|besoin|il me faut)\b/i.test(text) &&
    /\b(automatis|workflow|tâche|tache|apps|blog|surveiller|monitoring|drive|stockage|fichiers)\b/i.test(text);
}

function isYes(text: string) {
  return /^(oui|yes|ok|vas-y|vasy|go|active|avec|ssl|https|confirme|lance|installe)/i.test(text.trim());
}

function isNo(text: string) {
  return /^(non|no|pas|sans|aucun|annule|stop|cancel)/i.test(text.trim());
}

function cleanDomain(text: string) {
  const raw = text.trim().toLowerCase();
  if (!raw || isNo(raw)) return "";
  return raw.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\s+/g, "");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function AssistantPage() {
  const { data: servers } = trpc.server.list.useQuery();
  const utils = trpc.useUtils();
  const installMutation = trpc.install.create.useMutation();
  const domainMutation = trpc.domain.add.useMutation();

  const connectedServers = (servers || []).filter((s) => s.status === "connected");
  const [selectedServer, setSelectedServer] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Salut ! Dis-moi simplement ce que tu veux. Exemple : “installe Ghost pour mon blog”. Je te poserai les questions nécessaires puis je lancerai l'installation.",
    },
  ]);
  const [input, setInput] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [wizard, setWizard] = useState<Wizard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedServer && connectedServers[0]?.id) setSelectedServer(connectedServers[0].id);
  }, [selectedServer, connectedServers]);

  const canSend = input.trim().length > 0 && !loading;
  const conversationForApi = useMemo(() => messages.filter((m) => m.content.trim()).slice(-8), [messages]);
  const selectedServerData = connectedServers.find((s) => s.id === selectedServer);

  function appendAssistant(content: string) {
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }

  function startWizard(app: Recommendation) {
    setWizard({ app, step: "domain", port: app.defaultPort || 80 });
    appendAssistant(
      `Très bien, je prépare l'installation de ${app.name}.\n\nQuel domaine veux-tu utiliser ?\nExemple : ${app.id}.tondomaine.com\n\nRéponds “non” si tu veux installer sans domaine pour l'instant.`
    );
  }

  async function pollInstallation(installationId: string) {
    for (let i = 0; i < 24; i++) {
      await sleep(5000);
      const rows = await utils.install.list.fetch();
      const row = (rows as any[]).find((r: any) =>
        r?.installations?.id === installationId || r?.installation?.id === installationId || r?.id === installationId
      );
      const installation = row?.installations || row?.installation || row;
      if (installation?.status === "success") return { ok: true, logs: installation.logs || "" };
      if (installation?.status === "failed") return { ok: false, logs: installation.logs || JSON.stringify(installation.result || {}) };
    }
    return { ok: false, logs: "L'installation n'a pas confirmé son état après 2 minutes." };
  }

  async function runWizardInstall(current: Wizard) {
    if (!selectedServer) {
      appendAssistant("Je ne vois aucun serveur connecté. Connecte d'abord un serveur, puis je pourrai installer l'app.");
      setWizard(null);
      return;
    }

    const app = current.app;
    const port = current.port || app.defaultPort || 80;
    const domain = current.domain || "";
    const wantsSsl = !!current.ssl && !!domain;

    setWizard({ ...current, step: "running" });
    setLoading(true);

    try {
      appendAssistant(`Étape 1/4 — Installation de ${app.name} sur le port ${port}…`);
      const installRes = await installMutation.mutateAsync({ serverId: selectedServer, recipeId: app.id, port });

      appendAssistant("Étape 2/4 — Je vérifie que le conteneur répond correctement…");
      const check = await pollInstallation(installRes.id);
      if (!check.ok) {
        appendAssistant(
          `L'installation n'est pas validée automatiquement. Je m'arrête ici au lieu de faire semblant que tout va bien.\n\nLogs :\n${check.logs.slice(0, 1200)}\n\nProchaine étape : je dois ajouter le module de diagnostic automatique pour lire les logs Docker/Nginx et tenter une réparation.`
        );
        setWizard(null);
        return;
      }

      let final = `${app.name} est installé et validé sur le port ${port}.`;

      if (domain) {
        appendAssistant(`Étape 3/4 — Configuration du domaine ${domain}…`);
        const domainRow = await domainMutation.mutateAsync({
          serverId: selectedServer,
          name: domain,
          targetPort: port,
          targetApp: app.name,
        });
        final += `\nDomaine configuré : ${domain}`;

        if (wantsSsl) {
          appendAssistant(`Étape 4/4 — Génération du certificat SSL pour ${domain}…`);
          const sslRes = await fetch("/api/domains/enable-ssl", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domainId: domainRow.id }),
          });
          const sslData = await sslRes.json();
          if (!sslRes.ok) throw new Error(sslData.detail || sslData.error || "SSL échoué");
          final += `\nSSL actif : ${sslData.url || `https://${domain}`}`;
        }
      }

      await utils.install.list.invalidate();
      if (selectedServer) await utils.domain.list.invalidate({ serverId: selectedServer });
      appendAssistant(`Terminé ✅\n${final}\n\nJ'ai lancé, vérifié et configuré ce qui était demandé.`);
      setWizard(null);
    } catch (err: any) {
      appendAssistant(
        `Je n'ai pas réussi à terminer l'opération : ${err.message || "erreur inconnue"}\n\nJe ne vais pas inventer un succès. Il faudra que le prochain module lise les logs et tente une réparation automatique.`
      );
      setWizard(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleWizardAnswer(content: string, current: Wizard) {
    const text = content.trim();

    if (isNo(text) && ["domain", "port", "ssl", "confirm"].includes(current.step)) {
      if (current.step === "confirm") {
        appendAssistant("Ok, j'annule cette installation. Dis-moi simplement ce que tu veux faire ensuite.");
        setWizard(null);
        return;
      }
    }

    if (current.step === "domain") {
      const domain = cleanDomain(text);
      const next = { ...current, domain, step: "port" as WizardStep };
      setWizard(next);
      appendAssistant(
        domain
          ? `Parfait. Domaine retenu : ${domain}.\n\nVeux-tu garder le port par défaut ${current.port || 80} ? Réponds “oui” ou donne un autre port.`
          : `Ok, installation sans domaine pour l'instant.\n\nVeux-tu garder le port par défaut ${current.port || 80} ? Réponds “oui” ou donne un autre port.`
      );
      return;
    }

    if (current.step === "port") {
      const parsed = Number.parseInt(text.replace(/[^0-9]/g, ""), 10);
      const port = Number.isFinite(parsed) && parsed > 0 ? parsed : current.port || current.app.defaultPort || 80;
      const next = { ...current, port, step: "ssl" as WizardStep };
      setWizard(next);
      appendAssistant(
        current.domain
          ? `Port retenu : ${port}.\n\nVeux-tu que j'active le SSL automatiquement pour ${current.domain} ?`
          : `Port retenu : ${port}.\n\nPas de domaine, donc pas de SSL pour l'instant. Je passe à la confirmation.\n\nConfirme-tu l'installation de ${current.app.name} sur le port ${port} ?`
      );
      if (!current.domain) setWizard({ ...next, ssl: false, step: "confirm" });
      return;
    }

    if (current.step === "ssl") {
      const ssl = isYes(text) && !!current.domain;
      const next = { ...current, ssl, step: "confirm" as WizardStep };
      setWizard(next);
      appendAssistant(
        `Résumé avant lancement :\n- App : ${current.app.name}\n- Serveur : ${selectedServerData?.name || "serveur connecté"}\n- Port : ${current.port || current.app.defaultPort || 80}\n- Domaine : ${current.domain || "aucun"}\n- SSL : ${ssl ? "oui" : "non"}\n\nTu confirmes ?`
      );
      return;
    }

    if (current.step === "confirm") {
      if (!isYes(text)) {
        appendAssistant("Ok, je ne lance rien. Dis-moi ce que tu veux modifier ou installer.");
        setWizard(null);
        return;
      }
      await runWizardInstall(current);
    }
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setMessages((prev) => [...prev, { role: "user", content }]);
    setInput("");
    setError("");

    if (wizard && wizard.step !== "running") {
      await handleWizardAnswer(content, wizard);
      return;
    }

    setLoading(true);
    setRecommendations([]);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...conversationForApi, { role: "user", content }] }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur assistant");

      const recs: Recommendation[] = data.recommendations || [];
      setRecommendations(recs);
      appendAssistant(data.answer || "Je n'ai pas trouvé de réponse.");

      const shouldStartWizard = (isInstallIntent(content) || isActionableNeed(content)) && recs[0];
      if (shouldStartWizard) {
        setTimeout(() => startWizard(recs[0]), 50);
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Erreur inconnue");
        appendAssistant("Je n'ai pas réussi à répondre. Réessaie dans un instant.");
      }
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    sendMessage();
  }

  function stop() {
    abortRef.current?.abort();
    setLoading(false);
  }

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-3rem)] flex flex-col">
      <div className="mb-6">
        <p className="text-sm text-emerald-600 font-medium mb-1">Assistant srvly</p>
        <h1 className="text-3xl font-bold text-slate-900">Assistant d'installation et d'exploitation</h1>
        <p className="text-slate-500 mt-2 max-w-2xl">
          Parle normalement : l'assistant pose les questions utiles, installe, vérifie, puis te dit clairement si quelque chose bloque.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_390px] gap-6 min-h-0 flex-1">
        <section className="bg-white border border-slate-200 rounded-2xl flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                    message.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-100 text-slate-800 border border-slate-200"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-slate-100 border border-slate-200 rounded-2xl px-4 py-3 text-sm text-slate-500 flex items-center gap-2">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                  {wizard?.step === "running" ? "Opération en cours…" : "Analyse…"}
                </div>
              </div>
            )}
          </div>

          {messages.length <= 1 && (
            <div className="px-5 pb-3 flex flex-wrap gap-2">
              {STARTERS.map((starter) => (
                <button
                  key={starter}
                  onClick={() => sendMessage(starter)}
                  className="text-xs px-3 py-2 rounded-full border border-slate-200 text-slate-600 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50"
                >
                  {starter}
                </button>
              ))}
            </div>
          )}

          {error && <div className="mx-5 mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>}

          <form onSubmit={onSubmit} className="border-t border-slate-200 p-4 flex gap-3">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={wizard ? "Réponds à la question de l'assistant…" : "Ex: installe Ghost pour mon blog"}
              className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
            {loading ? (
              <button type="button" onClick={stop} className="px-4 py-3 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50">
                Stop
              </button>
            ) : (
              <button disabled={!canSend} className="px-5 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
                Envoyer
              </button>
            )}
          </form>
        </section>

        <aside className="bg-white border border-slate-200 rounded-2xl p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Contexte</h2>
            <span className="text-xs text-slate-400">Serveur + apps</span>
          </div>

          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="block text-xs font-semibold text-slate-600 mb-2">Serveur cible</label>
            {connectedServers.length === 0 ? (
              <p className="text-xs text-red-600">Aucun serveur connecté.</p>
            ) : (
              <select
                value={selectedServer}
                onChange={(e) => setSelectedServer(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
              >
                {connectedServers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name} — {server.ip}</option>
                ))}
              </select>
            )}
            {selectedServerData && <p className="text-[11px] text-slate-500 mt-2">Agent serveur connecté sur {selectedServerData.ip}.</p>}
          </div>

          {wizard && (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <p className="font-semibold mb-1">Installation en préparation</p>
              <p>App : {wizard.app.name}</p>
              <p>Étape : {wizard.step}</p>
              <p>Port : {wizard.port || wizard.app.defaultPort || 80}</p>
              <p>Domaine : {wizard.domain || "à définir"}</p>
              <p>SSL : {wizard.ssl ? "oui" : "non / à définir"}</p>
            </div>
          )}

          {recommendations.length === 0 ? (
            <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">
              Les apps candidates apparaîtront ici après ton message.
            </div>
          ) : (
            <div className="space-y-3">
              {recommendations.map((app) => (
                <div key={app.id} className="border border-slate-200 rounded-xl p-4 hover:border-emerald-300 transition-colors">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <h3 className="font-semibold text-slate-900 text-sm">{app.name}</h3>
                      <p className="text-[11px] text-slate-400">{app.category || "self-hosted"}</p>
                    </div>
                    {app.defaultPort && <span className="text-[11px] font-mono bg-slate-100 text-slate-600 px-2 py-1 rounded">:{app.defaultPort}</span>}
                  </div>
                  {app.description && <p className="text-xs text-slate-600 line-clamp-3 mb-3">{app.description}</p>}
                  <p className="text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 mb-3">{app.reason}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => startWizard(app)}
                      disabled={!!wizard || loading}
                      className="text-center text-xs font-semibold bg-emerald-600 text-white rounded-lg py-2 hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Installer par chat
                    </button>
                    <Link href={app.installUrl} className="block text-center text-xs font-semibold bg-slate-900 text-white rounded-lg py-2 hover:bg-slate-800">
                      Mode détaillé →
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
