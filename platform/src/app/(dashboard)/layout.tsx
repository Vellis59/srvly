import { auth } from "@/server/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user) {
    redirect("/auth/signin?callbackUrl=/dashboard");
  }

  return (
    <div className="flex min-h-screen bg-zinc-950">
      <Sidebar />
      <main className="flex-1 p-6 md:p-10 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
