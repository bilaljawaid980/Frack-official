const scenarios = [
  ["Construction Milestones", "Certifier signs topic 6 attest_milestone, updates lifecycle/NAV, then issuer releases escrow tranche."],
  ["Succession", "Family submits death certificate + Wirasat hash, compliance/admin approve, execution hash records heir transfer."],
  ["Title Dispute Freeze", "Issuer/admin/regulator-facing control sets title_dispute_flag and pauses lifecycle until lifted."],
  ["Total Loss", "Insurance claim hash moves asset to TOTAL_LOSS and blocks new trading flow."],
  ["Shariah Certification", "Topic 7 simulator signs Islamic instrument certification hash for regulator review."],
];

export default function SandboxScenariosPage() {
  return (
    <main className="space-y-6 p-8">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-600">Phase 3</p>
        <h1 className="text-3xl font-bold text-slate-950">Hard Scenario Control Panel</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Regulator-facing sandbox surface for under-construction assets, succession, court disputes, and total-loss workflows.
        </p>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        {scenarios.map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
          </div>
        ))}
      </section>
    </main>
  );
}
