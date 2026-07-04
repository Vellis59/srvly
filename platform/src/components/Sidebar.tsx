"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useT } from "@/lib/i18n";

const navItems = [
  { href: "/dashboard", label: "nav.dashboard", icon: "♜" },
  { href: "/servers", label: "nav.servers", icon: "♝" },
  { href: "/domains", label: "nav.domains", icon: "🌍" },
  { href: "/catalog", label: "nav.catalog", icon: "♞" },
  { href: "/pricing", label: "nav.pricing", icon: "💳" },
  { href: "/settings", label: "nav.settings", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const _ = useT();

  return (
    <aside className="w-64 bg-zinc-900/50 border-r border-zinc-800 flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-emerald-400 rounded-lg flex items-center justify-center text-zinc-950 font-bold text-sm">
            s
          </div>
          <h1 className="text-lg font-bold tracking-tight">
            <span className="text-emerald-400">{_("app.title")}</span>
          </h1>
        </div>
        <p className="text-xs text-zinc-500 mt-2">{_("app.tagline")}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                active
                  ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {_(item.label)}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      {session?.user && (
        <div className="p-4 border-t border-zinc-800">
          <div className="flex items-center gap-3 px-3 py-2">
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full ring-2 ring-zinc-700"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-zinc-200 truncate">
                {session.user.name}
              </p>
              <button
                onClick={() => signOut()}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
