import type { Metadata } from "next";
import { Providers } from "@/lib/providers";
import Sidebar from "@/components/Sidebar";
import "./globals.css";
import { auth } from "@/server/auth";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "srvly — Plateforme SaaS IA",
  description: "Déploiement 1-clic d'applications sur vos serveurs",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/api/auth/signin?callbackUrl=/dashboard");
  }

  return (
    <html lang="fr">
      <body>
        <Providers>
          <div className="flex">
            <Sidebar />
            <main className="flex-1 p-8 bg-slate-50 min-h-screen">
              {children}
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
