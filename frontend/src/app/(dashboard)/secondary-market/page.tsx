async function loadListings() {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  try {
    const response = await fetch(`${base}/sandbox/secondary-market/listings`, { cache: "no-store" });
    if (!response.ok) return [];
    const payload = await response.json();
    return payload.listings ?? [];
  } catch {
    return [];
  }
}

export default async function SecondaryMarketPage() {
  const listings = await loadListings();
  return (
    <main className="space-y-6 p-8">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-600">Phase 2</p>
        <h1 className="text-3xl font-bold text-slate-950">Secondary Market + Quick Exit</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Demonstrates sell listings, DvP escrow state, PLF quick-exit credit line, and NAV × 98% fast-exit pricing.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Trade Escrow", "initiate -> lock -> payment -> settle"],
          ["Quick Exit", "PLF buys at NAV less 2%"],
          ["Institution Role", "elevated max-balance exception"],
          ["Compliance Gate", "recipient must remain verified"],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Sandbox Sell Orders</h2>
        <div className="mt-4 grid gap-3">
          {listings.length === 0 ? <p className="text-slate-500">Backend simulator unavailable or no listings seeded.</p> : listings.map((listing: any) => (
            <div key={listing.id} className="rounded-xl border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{listing.id}</p>
                  <p className="text-sm text-slate-500">Seller {listing.seller}</p>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{listing.quantity} tokens</p>
                  <p className="text-sm text-slate-500">PKR {listing.pricePerToken} / token</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
