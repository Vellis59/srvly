export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <a href="/auth/signin" className="text-emerald-400 hover:text-emerald-300 text-sm mb-8 inline-block">
          ← Back to sign in
        </a>
        <div className="bg-white rounded-3xl p-10 shadow-2xl prose prose-slate max-w-none">
          {children}
        </div>
      </div>
    </div>
  );
}
