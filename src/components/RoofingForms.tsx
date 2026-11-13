import { useState } from "react";
import { createWhopLead, createWhopInvoice } from "../lib/roofing.fns";

export function RoofingForms({ cardId, onTrack }: { cardId: string | null; onTrack: (ev: string, props: Record<string, unknown>) => void }) {
  const [cust, setCust] = useState({ name: "Michael Vance", email: "michael@example.com" });
  const [lead, setLead] = useState({ fullName: "", email: "", phone: "", address: "", serviceType: "Full Roof Replacement", notes: "" });
  const [leadSent, setLeadSent] = useState(false);
  const [invAmt, setInvAmt] = useState("11500");
  const [invMethod, setInvMethod] = useState("charge_automatically");
  const [invLog, setInvLog] = useState<string | null>(null);

  const sendLead = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await createWhopLead({ data: lead });
    if (r.ok) {
      onTrack("estimate_requested", { service: lead.serviceType, address: lead.address });
      setCust({ name: lead.fullName, email: lead.email });
      setLeadSent(true);
    }
  };

  const runInvoice = async () => {
    setInvLog("Issuing invoice via Whop Invoices API...");
    const r = await createWhopInvoice({ data: { customerEmail: cust.email, customerName: cust.name, amount: invAmt, collectionMethod: invMethod, paymentMethodId: cardId } });
    setInvLog(r.ok ? `SUCCESS: Invoice ${r.data?.id || "created"} ($${invAmt})` : JSON.stringify(r.data));
  };

  return (
    <>
      <section id="estimate" className="bg-slate-900 py-20 text-white px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-extrabold">Request a Free Roof Estimate</h2>
          <p className="mt-1 text-slate-300">Submits directly to Whop Leads API & fires <code className="text-amber-400">estimate_requested</code>.</p>
          {leadSent ? (
            <div className="mt-8 rounded-2xl border border-emerald-500/40 bg-emerald-950/50 p-6">
              <h3 className="text-lg font-extrabold">Lead Recorded in Whop CRM!</h3>
              <button onClick={() => setLeadSent(false)} className="mt-4 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950">Submit Another</button>
            </div>
          ) : (
            <form onSubmit={sendLead} className="mt-8 grid gap-4 sm:grid-cols-2">
              <input required placeholder="Full Name" value={lead.fullName} onChange={(e) => setLead({ ...lead, fullName: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm" />
              <input required type="email" placeholder="Email" value={lead.email} onChange={(e) => setLead({ ...lead, email: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm" />
              <input required placeholder="Phone" value={lead.phone} onChange={(e) => setLead({ ...lead, phone: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm" />
              <input required placeholder="Property Address & ZIP" value={lead.address} onChange={(e) => setLead({ ...lead, address: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm" />
              <textarea rows={3} placeholder="Roof details..." value={lead.notes} onChange={(e) => setLead({ ...lead, notes: e.target.value })} className="rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm sm:col-span-2" />
              <button type="submit" className="rounded-xl bg-amber-500 py-3.5 text-sm font-extrabold text-slate-950 sm:col-span-2">Request Free Estimate</button>
            </form>
          )}
        </div>
      </section>
      <section className="border-t bg-slate-100 py-16 px-4">
        <div className="max-w-4xl mx-auto rounded-2xl border bg-white p-8">
          <div className="text-xs font-extrabold uppercase text-amber-600">Deposit → Job → Final Invoice Flow</div>
          <h3 className="mt-1 text-2xl font-extrabold text-slate-950">Bill Remaining Balance (Whop Invoices API)</h3>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <input type="number" value={invAmt} onChange={(e) => setInvAmt(e.target.value)} className="rounded-xl border px-3 py-2.5 text-sm" />
            <select value={invMethod} onChange={(e) => setInvMethod(e.target.value)} className="rounded-xl border px-3 py-2.5 text-sm"><option value="charge_automatically">Auto-Charge Stored Card</option><option value="send_invoice">Send Email Invoice</option></select>
            <input readOnly value={cardId || "Pay $500 Deposit first"} className="rounded-xl border bg-slate-50 px-3 py-2.5 font-mono text-xs" />
          </div>
          <button onClick={runInvoice} className="mt-5 rounded-xl bg-slate-950 px-6 py-3 text-sm font-extrabold text-white">Issue Final Balance Invoice (${invAmt})</button>
          {invLog && <div className="mt-4 rounded-xl bg-slate-950 p-4 font-mono text-xs text-emerald-400">{invLog}</div>}
        </div>
      </section>
    </>
  );
}
