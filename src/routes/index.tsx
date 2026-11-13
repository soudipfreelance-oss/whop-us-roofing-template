import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { COMPANY_PRESETS , type ServicePlan } from "../config/roofing.config";
import { RoofingCheckoutModal } from "../components/RoofingCheckoutModal";
import { RoofingSections } from "../components/RoofingSections";
import { RoofingForms } from "../components/RoofingForms";

export const Route = createFileRoute("/")({ component: RoofingHomePage });

function track(eventName: string, props: Record<string, unknown>) {
  if (typeof window !== "undefined") {
    (window as any).whop?.track?.(eventName, props);
    window.dispatchEvent(new CustomEvent("whop-pixel-fired", { detail: { eventName, timestamp: new Date().toLocaleTimeString() } }));
  }
}

function RoofingHomePage() {
  const [preset, setPreset] = useState<"apex" | "summit">("apex");
  const company = COMPANY_PRESETS[preset];
  const [plan, setPlan] = useState<ServicePlan | null>(null);
  const [cardId, setCardId] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<{ eventName: string; timestamp: string }>>([]);

  useEffect(() => {
    const fn = (e: Event) => setEvents((p) => [(e as CustomEvent).detail, ...p.slice(0, 4)]);
    window.addEventListener("whop-pixel-fired", fn);
    return () => window.removeEventListener("whop-pixel-fired", fn);
  }, []);

  const openPlan = (p: ServicePlan) => {
    track("service_viewed", { service_id: p.id, name: p.name, price: p.price });
    if (p.isDeposit) track("deposit_started", { plan_id: p.planId, amount: p.price });
    setPlan(p);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="border-b border-slate-800 bg-slate-950 px-4 py-2 text-xs text-slate-200 flex justify-between items-center">
        <div className="flex items-center gap-2"><b>Whop Pixel:</b> {events.length === 0 ? "page (auto)" : events.map((ev, i) => <span key={i} className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-emerald-300">{ev.eventName} · {ev.timestamp}</span>)}</div>
        <button onClick={() => setPreset((p) => (p === "apex" ? "summit" : "apex"))} className="rounded bg-slate-800 px-3 py-1 font-semibold text-amber-400">Swap Brand ({company.cityState})</button>
      </div>
      <header className="border-b bg-white px-4 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div><div className="text-xl font-black text-slate-950">{company.companyName}</div><div className="text-xs text-slate-500">{company.license}</div></div>
          <div className="flex items-center gap-4"><span className="hidden sm:inline text-sm font-bold">{company.phone}</span><a href="#estimate" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Free Estimate</a></div>
        </div>
      </header>
      <section className="bg-slate-900 py-20 text-white px-4">
        <div className="max-w-6xl mx-auto">
          <span className="rounded-full bg-amber-500/15 px-3.5 py-1 text-xs font-bold text-amber-400">Licensed & Insured · {company.cityState}</span>
          <h1 className="mt-5 max-w-3xl text-4xl font-extrabold sm:text-6xl">{company.tagline}</h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">Book a $149 drone inspection, lock your roof replacement date with a $500 card-on-file deposit, or request a free quote.</p>
          <div className="mt-8 flex flex-wrap gap-4"><a href="#services" className="rounded-xl bg-amber-500 px-6 py-3.5 font-extrabold text-slate-950">Book Service or Deposit</a><a href="#estimate" className="rounded-xl border border-slate-700 bg-slate-800 px-6 py-3.5 font-bold">Request an Estimate</a></div>
        </div>
      </section>
      <RoofingSections areas={company.serviceAreas} onSelect={openPlan} />
      <RoofingForms cardId={cardId} onTrack={track} />
      {plan && <RoofingCheckoutModal plan={plan} companyName={company.companyName} onClose={() => setPlan(null)} onSuccess={({ plan: p, paymentMethodId }) => { if (p.isDeposit) setCardId(paymentMethodId); setPlan(null); alert(`${p.name} completed!`); }} />}
    </div>
  );
}
