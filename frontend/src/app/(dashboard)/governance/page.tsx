const proposalRows = [
  { id: "GOV-001", type: "Sale / Major Decision", quorum: "30%", threshold: "66%", yes: 72, no: 18, status: "Executable" },
  { id: "GOV-002", type: "Custodian Replacement", quorum: "25%", threshold: "60%", yes: 41, no: 22, status: "Voting" },
];

export default function GovernancePage() {
  return (
    <main className="space-y-6 p-8">
      <section>
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-blue-600">Phase 2</p>
        <h1 className="text-3xl font-bold text-slate-950">Governance Portal</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Sandbox UI for `fracks_governance`: proposal creation, balance snapshot voting, quorum checks, execution, and cancellation.
        </p>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Governance State", "PDA per token mint"],
          ["Snapshot Voting", "Vote weight fixed at proposal slot"],
          ["Minority Protection", "Quorum + proposal thresholds"],
        ].map(([title, body]) => (
          <div key={title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">{title}</h2>
            <p className="mt-2 text-sm text-slate-600">{body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-950">Active Proposals</h2>
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="p-3">ID</th>
                <th className="p-3">Type</th>
                <th className="p-3">Quorum</th>
                <th className="p-3">Threshold</th>
                <th className="p-3">Votes</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {proposalRows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="p-3 font-mono">{row.id}</td>
                  <td className="p-3">{row.type}</td>
                  <td className="p-3">{row.quorum}</td>
                  <td className="p-3">{row.threshold}</td>
                  <td className="p-3">Yes {row.yes}% / No {row.no}%</td>
                  <td className="p-3"><span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
