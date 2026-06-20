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
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8 bg-slate-50 min-h-screen">{children}</main>
    </div>
  );
}
