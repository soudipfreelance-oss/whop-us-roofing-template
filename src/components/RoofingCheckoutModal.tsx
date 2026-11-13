import { useMemo } from "react";
import { WhopElements, Checkout, CheckoutElement, Payments, BrandingElement } from "@whop/elements-react";
import { loadWhop } from "@whop/elements";
import { type ServicePlan, WHOP_ACCOUNT_ID } from "../config/roofing.config";
export function RoofingCheckoutModal({ plan, companyName, onClose, onSuccess }: { plan: ServicePlan; companyName: string; onClose: () => void; onSuccess: (d: { plan: ServicePlan; paymentMethodId: string }) => void }) {
  const whopPromise = useMemo(() => (typeof window !== "undefined" ? loadWhop() : null), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="relative max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-slate-100 px-3 py-1 text-sm font-bold">✕</button>
        <div className="mb-4 border-b pb-4">
          <div className="text-xs font-extrabold uppercase text-amber-600">{companyName} · Whop Checkout</div>
          <h3 className="mt-1 text-xl font-extrabold text-slate-900">{plan.name}</h3>
          {plan.isDeposit && <div className="mt-2 rounded-xl bg-blue-50 p-3 text-xs text-blue-900"><strong>Card-on-File Setup Intent:</strong> Vaults your payment method via Whop for final balance billing.</div>}
        </div>
        {whopPromise && (
          <WhopElements elements={whopPromise}>
            <Checkout plan={plan.planId} onComplete={(r: any) => onSuccess({ plan, paymentMethodId: r?.paymentId || r?.setupIntentId || "payt_vaulted_card" })}><CheckoutElement /></Checkout>
            <Payments accountId={WHOP_ACCOUNT_ID} plan={plan.planId}><div className="mt-3 flex justify-center"><BrandingElement /></div></Payments>
          </WhopElements>
        )}
        <div className="mt-3 text-center"><a href={"/checkout/" + plan.planId} className="text-xs font-bold text-slate-500 underline">Open Full-Screen Checkout →</a></div>
      </div>
    </div>
  );
}