async function loadReadiness() {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${base}/sandbox/phase4/readiness`, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export default async function Phase4ReadinessPage() {
  const readiness = await loadReadiness();
  const rows = readiness?.integrations ?? [];
  return (
    <main className="space-y-6 p-8">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-rose-600">Phase 4</p>
        <h1 className="text-3xl font-bold text-slate-950">Production Readiness Matrix</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Phase 4 is not fake-live integration: this screen explicitly tracks what remains external/legal before production.
        </p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Mock to Real Integration Map</h2>
        <div className="mt-4 grid gap-3">
          {rows.length === 0 ? <p className="text-slate-500">Backend readiness endpoint unavailable.</p> : rows.map((row: any) => (
            <div key={row.mock} className="grid gap-2 rounded-xl border border-slate-200 p-4 md:grid-cols-3">
              <p className="font-semibold text-slate-900">{row.mock}</p>
              <p className="text-slate-600">{row.production}</p>
              <p className="font-mono text-sm text-amber-700">{row.status}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
