import { ROOFING_PLANS, HOMEOWNER_REVIEWS , type ServicePlan } from "../config/roofing.config";

export function RoofingSections({ areas, onSelect }: { areas: string[]; onSelect: (p: ServicePlan) => void }) {
  return (
    <>
      <section id="services" className="py-20 px-4 max-w-6xl mx-auto">
        <h2 className="text-center text-3xl sm:text-4xl font-extrabold text-slate-950">Roofing Services & Instant Whop Checkout</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {ROOFING_PLANS.map((p) => (
            <div key={p.id} className={`flex flex-col justify-between rounded-2xl p-8 shadow-md ${p.isDeposit ? "bg-slate-900 text-white ring-4 ring-amber-500" : "bg-white text-slate-900 border border-slate-200"}`}>
              <div>
                <div className="flex justify-between">
                  <span className="text-xs font-extrabold uppercase text-amber-500">{p.category}</span>
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${p.isDeposit ? "bg-amber-500 text-slate-950" : "bg-slate-100 text-slate-800"}`}>{p.badge}</span>
                </div>
                <h3 className="mt-4 text-xl font-extrabold">{p.name}</h3>
                <div className="mt-4 text-5xl font-black">${p.price} <span className="text-xs font-normal opacity-70">USD</span></div>
                <p className={`mt-4 text-sm ${p.isDeposit ? "text-slate-300" : "text-slate-600"}`}>{p.description}</p>
                <ul className="mt-6 space-y-2.5 border-t border-slate-200/20 pt-5">
                  {p.features.map((f) => <li key={f} className="text-sm font-medium">✓ {f}</li>)}
                </ul>
              </div>
              <button onClick={() => onSelect(p)} className={`mt-8 w-full rounded-xl py-4 text-sm font-extrabold ${p.isDeposit ? "bg-amber-500 text-slate-950 hover:bg-amber-400" : "bg-slate-950 text-white hover:bg-amber-500 hover:text-slate-950"}`}>
                {p.isDeposit ? "Pay $500 Deposit & Vault Card →" : `Book Now — $${p.price} →`}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-amber-500 py-14 text-slate-950 px-4">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div>
            <div className="text-xs font-extrabold uppercase">Flexible Monthly Roofing Financing</div>
            <h2 className="mt-1 text-3xl font-black">Full Roof Replacements Starting at $249/mo</h2>
            <p className="mt-1 font-semibold">Klarna, Afterpay & Splitit monthly options surface automatically inside Whop Checkout.</p>
          </div>
          <a href="#services" className="rounded-xl bg-slate-950 px-6 py-4 text-sm font-extrabold text-white">View Financing →</a>
        </div>
      </section>

      <section className="bg-white py-20 px-4 border-t">
        <div className="max-w-6xl mx-auto grid gap-12 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold text-slate-950">Service Areas</h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              {areas.map((a) => <div key={a} className="rounded-xl border bg-slate-50 p-4 text-sm font-bold">{a}</div>)}
            </div>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-slate-950">Homeowner Reviews</h2>
            <div className="mt-6 space-y-4">
              {HOMEOWNER_REVIEWS.map((r) => (
                <div key={r.author} className="rounded-2xl border bg-slate-50 p-5">
                  <div className="flex justify-between font-extrabold"><span>{r.author}</span><span className="text-amber-500">★★★★★</span></div>
                  <p className="mt-2 text-sm text-slate-700">“{r.text}”</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
