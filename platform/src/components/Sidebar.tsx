"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useT } from "@/lib/i18n";

const navItems = [
  { href: "/dashboard", label: "nav.dashboard", icon: "♜" },
  { href: "/servers", label: "nav.servers", icon: "♝" },
  { href: "/catalog", label: "nav.catalog", icon: "♞" },
  { href: "/settings", label: "nav.settings", icon: "⚙" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const _ = useT();

  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col min-h-screen">
      {/* Logo */}
      <div className="p-6 border-b border-slate-700">
        <h1 className="text-xl font-bold tracking-tight">
          <span className="text-emerald-400">{_("app.title")}</span>
          <span className="text-slate-400 text-sm ml-2">{_("app.alpha")}</span>
        </h1>
        <p className="text-xs text-slate-500 mt-1">{_("app.tagline")}</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                active
                  ? "bg-emerald-600 text-white"
                  : "text-slate-300 hover:bg-slate-800"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              {_(item.label)}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      {session?.user && (
        <div className="p-4 border-t border-slate-700">
          <div className="flex items-center gap-3 px-4 py-3">
            {session.user.image && (
              <img
                src={session.user.image}
                alt=""
                className="w-8 h-8 rounded-full"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {session.user.name}
              </p>
              <button
                onClick={() => signOut()}
                className="text-xs text-slate-400 hover:text-white transition-colors"
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
