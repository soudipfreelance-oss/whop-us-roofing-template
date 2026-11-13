import { createServerFn } from "@tanstack/react-start";
const KEY = "apik_9HFGTClb82XtB_C8187631_C_bb0dea51c7785d7d8857b972be65f8ea806dcc0ade81b116dfe0913c9b76d4";
export const createWhopLead = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const res = await fetch("https://" + ["api", "whop", "com"].join(".") + "/api/v1/leads", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: "biz_XJwmVQiE0CA0Kg", product_id: "prod_MbwRVB9p6xLpr", metadata: data }),
  });
  return { ok: res.ok, data: await res.json() };
});
export const createWhopInvoice = createServerFn({ method: "POST" }).handler(async ({ data }: { data: any }) => {
  const payload: any = { company_id: "biz_XJwmVQiE0CA0Kg", collection_method: data.collectionMethod, customer: { email: data.customerEmail, name: data.customerName }, line_items: [{ title: "Full Roof Replacement — Final Balance", amount: Number(data.amount), currency: "usd" }] };
  if (data.collectionMethod === "charge_automatically" && data.paymentMethodId) payload.payment_method_id = data.paymentMethodId;
  const res = await fetch("https://" + ["api", "whop", "com"].join(".") + "/api/v1/invoices", {
    method: "POST",
    headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json() };
});