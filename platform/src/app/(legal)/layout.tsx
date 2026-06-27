export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a href="/auth/signin" className="text-emerald-400 hover:text-emerald-300 text-sm mb-8 inline-block">
          ← Back to sign in
        </a>
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-10 shadow-2xl prose prose-zinc max-w-none">
          {children}
        </div>
      </div>
    </div>
  );
}
