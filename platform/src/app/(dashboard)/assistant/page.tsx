"use client";

import { trpc } from "@/lib/trpc";
import { FormEvent, useRef, useState } from "react";

type Role = "user" | "assistant";
type Message = { role: Role; content: string };

const STARTERS = [
  "Installe Ghost pour faire un blog",
  "Je veux automatiser des tâches entre mes apps",
  "Je cherche une application de prise de notes",
  "Installe un outil pour surveiller mes sites",
];

export default function AssistantPage() {
  const { data: servers } = trpc.server.list.useQuery();
  const connectedServers = (servers || []).filter((s) => s.status === "connected");
  const [selectedServer, setSelectedServer] = useState("");
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Salut ! Dis-moi ce que tu veux. Je peux installer des apps, configurer des domaines, activer le SSL, et diagnostiquer des problèmes.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const canSend = input.trim().length > 0 && !loading;

  function appendAssistant(content: string) {
    setMessages((prev) => [...prev, { role: "assistant", content }]);
  }

  async function sendMessage(text?: string) {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setMessages((prev) => [...prev, { role: "user", content }]);
    setInput("");
    setError("");

    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages.slice(-10), { role: "user", content }],
          serverId: selectedServer || connectedServers[0]?.id || undefined,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || data.answer || "Erreur");

      appendAssistant(data.answer || "Je n'ai pas de réponse.");
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error(err);
        setError(err.message);
        appendAssistant("Je n'ai pas réussi à répondre. Réessaie.");
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
    <div className="max-w-4xl mx-auto h-[calc(100vh-3rem)] flex flex-col">
      <div className="mb-6">
        <p className="text-sm text-emerald-600 font-medium mb-1">Assistant srvly</p>
        <h1 className="text-3xl font-bold text-slate-900">Opérateur conversationnel</h1>
        <p className="text-slate-500 mt-2 max-w-2xl">
          Installe, configure, diagnostique et répare — tout en discutant.
        </p>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-2xl flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
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
                Je réfléchis…
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

        {error && (
          <div className="mx-5 mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </div>
        )}

        <form onSubmit={onSubmit} className="border-t border-slate-200 p-4 flex gap-3">
          {connectedServers.length > 1 && (
            <select
              value={selectedServer}
              onChange={(e) => setSelectedServer(e.target.value)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs"
            >
              <option value="">Serveur principal</option>
              {connectedServers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ex: installe Ghost sur le port 8080"
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
          {loading ? (
            <button
              type="button"
              onClick={stop}
              className="px-4 py-3 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="px-5 py-3 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              Envoyer
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
