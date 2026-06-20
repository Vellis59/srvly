"use client";

import Link from "next/link";
import { FormEvent, useMemo, useRef, useState } from "react";

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

const STARTERS = [
  "Je cherche un blog simple avec SSL",
  "Je veux automatiser des tâches entre mes apps",
  "Il me faut surveiller mes sites",
  "Je veux remplacer Google Drive en self-hosted",
];

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Salut ! Dis-moi ce que tu veux héberger, même en langage simple. Je te propose les bonnes apps et le chemin d'installation.",
    },
  ]);
  const [input, setInput] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const canSend = input.trim().length > 0 && !loading;
  const conversationForApi = useMemo(() => messages.filter((m) => m.content.trim()).slice(-8), [messages]);

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    const nextMessages: Message[] = [...messages, { role: "user", content }];
    setMessages(nextMessages);
    setInput("");
    setError("");
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

      setMessages((prev) => [...prev, { role: "assistant", content: data.answer || "Je n'ai pas trouvé de réponse." }]);
      setRecommendations(data.recommendations || []);
    } catch (err: any) {
      if (err.name !== "AbortError") {
        setError(err.message || "Erreur inconnue");
        setMessages((prev) => [...prev, { role: "assistant", content: "Je n'ai pas réussi à répondre. Réessaie dans un instant." }]);
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
        <h1 className="text-3xl font-bold text-slate-900">Trouver et installer la bonne app</h1>
        <p className="text-slate-500 mt-2 max-w-2xl">
          Décris ton besoin : blog, automatisation, stockage, monitoring… L'assistant recommande les apps du catalogue et prépare l'installation.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1fr_360px] gap-6 min-h-0 flex-1">
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
                  Analyse du catalogue…
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
              placeholder="Ex: je veux créer un blog pour publier des articles..."
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
            <h2 className="font-semibold text-slate-900">Apps proposées</h2>
            <span className="text-xs text-slate-400">Catalogue</span>
          </div>

          {recommendations.length === 0 ? (
            <div className="text-sm text-slate-500 bg-slate-50 border border-dashed border-slate-200 rounded-xl p-4">
              Les recommandations apparaîtront ici après ton message.
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
                  {app.dependencies.length > 1 && (
                    <div className="flex flex-wrap gap-1 mb-3">
                      {app.dependencies.filter((d) => d !== "docker").slice(0, 3).map((dep) => (
                        <span key={dep} className="text-[10px] px-2 py-1 rounded-full bg-slate-100 text-slate-500">{dep}</span>
                      ))}
                    </div>
                  )}
                  <Link href={app.installUrl} className="block text-center text-xs font-semibold bg-slate-900 text-white rounded-lg py-2 hover:bg-slate-800">
                    Préparer l'installation →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
