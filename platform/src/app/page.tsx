import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const plans = [
  {
    id: "self-hosted",
    name: "Self-hosted",
    price: "Free",
    priceNote: "toujours gratuit",
    popular: false,
    features: [
      "Instance srvly sur votre serveur",
      "Serveurs illimités",
      "Toutes les fonctionnalités",
      "Code open source (MIT)",
      "Communauté & contributions",
    ],
    cta: "Self-host now",
    href: "https://github.com/Vellis59/srvly",
  },
  {
    id: "free",
    name: "Free",
    price: "€0",
    priceNote: "un serveur offert",
    popular: true,
    features: [
      "1 serveur inclus",
      "Dashboard & monitoring",
      "Backups & restore",
      "Domaine & SSL (Caddy)",
      "Catalogue d'applications",
    ],
    cta: "Get started",
    href: "https://console.srvly.app/auth/signin",
  },
  {
    id: "starter",
    name: "Starter",
    price: "—",
    priceNote: "Coming soon",
    popular: false,
    features: [
      "Jusqu'à 3 serveurs",
      "Domaines & SSL illimités",
      "Priorité support",
      "Plus d'applications",
    ],
    cta: "Coming soon",
    href: "#",
    disabled: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "—",
    priceNote: "Coming soon",
    popular: false,
    features: [
      "Serveurs illimités",
      "Tout de Starter +",
      "Support prioritaire",
      "Fonctionnalités avancées",
    ],
    cta: "Coming soon",
    href: "#",
    disabled: true,
  },
];

export default function LandingPage() {
  // If accessed via console.srvly.app → redirect to dashboard
  const host = headers().get("host") || "";
  if (host.startsWith("console.") || host === "localhost:3000") {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Nav */}
      <header className="border-b border-slate-700/50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-white">srvly</span>
            <span className="text-xs text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded-full">beta</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://github.com/Vellis59/srvly"
              className="text-sm text-slate-400 hover:text-white transition-colors"
              target="_blank"
            >
              GitHub
            </a>
            <Link
              href="https://console.srvly.app/auth/signin"
              className="text-sm px-4 py-2 bg-emerald-600 text-white rounded-xl hover:bg-emerald-500 transition-colors font-medium"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-4 pt-24 pb-16 text-center">
        <h1 className="text-5xl sm:text-6xl font-bold text-white mb-6 leading-tight">
          Your VPS,{" "}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-400 to-teal-300">
            simplifed
          </span>
        </h1>
        <p className="text-lg text-slate-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          srvly is an open-source platform to manage your self-hosted applications.
          Connect your server, deploy apps with your AI agent, monitor everything from one dashboard.
        </p>
        <div className="flex items-center justify-center gap-4">
          <Link
            href="https://console.srvly.app/auth/signin"
            className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-medium hover:bg-emerald-500 transition-colors text-lg"
          >
            Start free →
          </Link>
          <a
            href="https://github.com/Vellis59/srvly"
            target="_blank"
            className="px-6 py-3 border border-slate-600 text-slate-300 rounded-xl font-medium hover:bg-slate-800 transition-colors text-lg"
          >
            View on GitHub
          </a>
        </div>
      </section>

      {/* Plans */}
      <section className="max-w-6xl mx-auto px-4 pb-24">
        <h2 className="text-3xl font-bold text-white text-center mb-12">Plans</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-2xl border p-6 flex flex-col ${
                plan.popular
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-slate-700/50 bg-slate-800/50"
              } ${plan.disabled ? "opacity-60" : ""}`}
            >
              {plan.popular && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-medium bg-emerald-600 text-white px-3 py-1 rounded-full">
                  Free forever
                </span>
              )}
              <h3 className="text-lg font-semibold text-white mb-1">{plan.name}</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-white">{plan.price}</span>
                <span className="text-sm text-slate-400 ml-2">/{plan.priceNote}</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                    <svg className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
              {plan.disabled ? (
                <span className="block text-center px-4 py-2.5 rounded-xl text-sm font-medium bg-slate-700 text-slate-400 cursor-not-allowed">
                  {plan.cta}
                </span>
              ) : (
                <Link
                  href={plan.href}
                  className={`block text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    plan.popular
                      ? "bg-emerald-600 text-white hover:bg-emerald-500"
                      : "border border-slate-600 text-slate-300 hover:bg-slate-700"
                  }`}
                  {...(plan.id === "self-hosted" ? { target: "_blank" } : {})}
                >
                  {plan.cta}
                </Link>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-800">
        <div className="max-w-6xl mx-auto px-4 py-8 flex items-center justify-between text-sm text-slate-500">
          <span>srvly — open source MIT</span>
          <div className="flex gap-4">
            <a href="https://console.srvly.app/terms" className="hover:text-white transition-colors">Terms</a>
            <a href="https://console.srvly.app/privacy" className="hover:text-white transition-colors">Privacy</a>
            <a href="https://github.com/Vellis59/srvly" target="_blank" className="hover:text-white transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
