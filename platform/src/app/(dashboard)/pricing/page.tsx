"use client";

import Link from "next/link";
import { useT } from "@/lib/i18n";

const PLANS = [
  {
    name: "Self-Hosted",
    price: "Free",
    desc: "Unlimited servers",
    cta: "Deploy Now",
    href: "https://github.com/Vellis59/srvly",
    featured: false,
    disabled: false,
  },
  {
    name: "Free",
    price: "$0",
    desc: "1 server",
    cta: "Get Started",
    href: "/auth/signin",
    featured: true,
    disabled: false,
  },
  {
    name: "Starter",
    price: "Soon",
    desc: "5 servers",
    cta: "Coming soon",
    href: "#",
    featured: false,
    disabled: true,
  },
  {
    name: "Pro",
    price: "Soon",
    desc: "Unlimited",
    cta: "Coming soon",
    href: "#",
    featured: false,
    disabled: true,
  },
];

export default function PricingPage() {
  const _ = useT();
  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-10">
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">Simple pricing</h1>
        <p className="text-sm text-zinc-500">Start free. Upgrade when you need more.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {PLANS.map((plan) => (
          <div
            key={plan.name}
            className={`rounded-2xl p-6 border transition-all ${
              plan.featured
                ? "bg-zinc-800 border-emerald-500/50 ring-1 ring-emerald-500/20"
                : "bg-zinc-900 border-zinc-800"
            }`}
          >
            <h3 className="font-semibold text-zinc-100 mb-1">{plan.name}</h3>
            <p className="text-3xl font-bold text-zinc-100 mb-1">{plan.price}</p>
            <p className="text-sm text-zinc-500 mb-5">{plan.desc}</p>

            {plan.disabled ? (
              <span className="block text-center px-4 py-2.5 bg-zinc-800 text-zinc-500 rounded-xl text-sm font-medium cursor-not-allowed">
                {plan.cta}
              </span>
            ) : (
              <Link
                href={plan.href}
                className={`block text-center px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  plan.featured
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "border border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {plan.cta}
              </Link>
            )}
          </div>
        ))}
      </div>

      <div className="mt-10 bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h2 className="font-semibold text-zinc-100 mb-3">FAQ</h2>
        <div className="space-y-4 text-sm text-zinc-400">
          <div>
            <p className="font-medium text-zinc-300 mb-1">Is it really free for 1 server?</p>
            <p>Yes. The Free plan includes 1 server forever, no time limit, no credit card.</p>
          </div>
          <div>
            <p className="font-medium text-zinc-300 mb-1">What does self-hosted mean?</p>
            <p>You deploy srvly on your own server using Docker Compose. You get unlimited servers, and all data stays on your infrastructure.</p>
          </div>
          <div>
            <p className="font-medium text-zinc-300 mb-1">What is the difference between Free and Self-Hosted?</p>
            <p>Free uses the hosted srvly platform (console.srvly.app) and is limited to 1 server. Self-hosted runs on your own machine with no limits.</p>
          </div>
          <div>
            <p className="font-medium text-zinc-300 mb-1">When will Starter/Pro be available?</p>
            <p>These plans are in development. Join the discussion on GitHub to follow progress.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
