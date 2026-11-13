export const WALLET_BUTTON_STYLES = `
.ck-wallet-consent { margin: 8px 0 0; font-size: 12px; line-height: 1.4; color: #707070; }
.ck-apple-pay { display: block; width: 100%; height: 48px; padding: 0; border: 0; border-radius: 8px; cursor: pointer; appearance: none; background-color: #000000; background-image: url("https://content.whop.com/payment_methods/apple-pay/submit_buttons/light.svg"); background-repeat: no-repeat; background-position: center; background-size: auto 100%; }
@supports (-webkit-appearance: -apple-pay-button) { .ck-apple-pay { background: none; -webkit-appearance: -apple-pay-button; -apple-pay-button-type: plain; -apple-pay-button-style: black; } }
.ck-apple-pay:disabled { opacity: 0.4; cursor: not-allowed; }
.ck-google-pay { display: block; width: 100%; height: 48px; margin-top: 10px; padding: 0; border: 0; border-radius: 8px; cursor: pointer; appearance: none; background-color: #000000; background-image: url("https://content.whop.com/payment_methods/google-pay/submit_buttons/light.svg"); background-repeat: no-repeat; background-position: center; background-size: auto 100%; }
.ck-google-pay:disabled { opacity: 0.4; cursor: not-allowed; }
.ck-paypal { display: block; width: 100%; height: 48px; margin-top: 10px; padding: 0; border: 0; border-radius: 8px; cursor: pointer; appearance: none; background-color: #ffc439; background-repeat: no-repeat; background-position: center; background-size: auto 100%; color: #111111; font-family: inherit; font-size: 16px; font-weight: 600; }
.ck-paypal:disabled { opacity: 0.4; cursor: not-allowed; }
`;

// A charge's region (`BusyRegion`): dimmed like the page's other busy states,
// by opacity alone so nothing moves, and never to 0, which would read as the
// branding notice being hidden.
export const BUSY_STYLES = `
.ck-busy > * { transition: opacity 0.2s ease; }
.ck-busy[aria-busy="true"] > * { opacity: 0.6; }
@media (prefers-reduced-motion: reduce) { .ck-busy > * { transition: none; } }
`;

export function checkoutStyles(store: {
	brandColor: string;
	pageBackground: string;
}): string {
	return `
.ck { --brand: ${store.brandColor}; --page-bg: ${store.pageBackground}; color: #111111; }
.ck-header { position: relative; display: flex; align-items: center; justify-content: center; height: 86px; background: #ffffff; border-bottom: 1px solid #dedede; }
.ck-wordmark { display: block; width: 140px; height: 45px; object-fit: contain; }
.ck-bands { display: flex; min-height: calc(100vh - 86px); background: linear-gradient(to right, var(--page-bg) 0 53.5%, #f5f5f5 53.5% 100%); font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.ck-band-left { display: flex; justify-content: flex-end; width: 53.5%; padding: 40px 40px 80px 0; box-sizing: border-box; }
.ck-band-right { width: 46.5%; padding: 40px 0 80px 40px; box-sizing: border-box; border-left: 1px solid #dedede; }
.ck-column { width: 500px; }
.ck-summary { position: sticky; top: 40px; width: 400px; }
.ck-section { margin-bottom: 32px; }
.ck-heading { margin: 0 0 14px; font-size: 20px; font-weight: 600; color: #000000; }
.ck-express { display: none; }
.ck-express-on { display: block; }
.ck-checkout-wallets { display: flex; gap: 10px; }
.ck-checkout-wallets > button { flex: 1 1 0; min-width: 0; margin-top: 0; }
@media (max-width: 480px) { .ck-checkout-wallets { flex-direction: column; } .ck-checkout-wallets > button { flex: none; } }
${WALLET_BUTTON_STYLES}
.ck-or { display: flex; align-items: center; gap: 12px; margin: 14px 0 0; font-size: 13px; color: #6b7177; }
.ck-or::before, .ck-or::after { content: ""; flex: 1; height: 1px; background: #dedede; }
.ck-email-slot { min-height: 49px; }
.ck-email-slot, .ck-address-slot, .ck-payment-slot { margin-left: -4px; margin-right: -4px; }
.ck-address-slot { min-height: 60px; }
.ck-secure { margin: 0; font-size: 14px; color: #707070; }
.ck-section:has(> .ck-secure) { margin-bottom: 16px; }
.ck-section:has(> .ck-secure) .ck-heading { margin-bottom: 4px; }
.ck-panel { padding: 0; }
.ck-skel { display: block; background: #eeeeee; border-radius: 8px; animation: ck-skel-pulse 1.4s ease-in-out infinite; }
.ck-skel-form { display: flex; flex-direction: column; gap: 12px; }
.ck-skel-field { height: 50px; }
.ck-skel-gap { margin-top: 28px; }
.ck-skel-panel { height: 196px; border-radius: 12px; }
.ck-skel-button { height: 50px; border-radius: 12px; }
.ck-reveal { opacity: 0; transform: translateY(4px); transition: opacity 220ms ease-out, transform 220ms ease-out; }
.ck-revealed { opacity: 1; transform: none; }
.ck-skel-item { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; }
.ck-skel-thumb { width: 64px; height: 64px; flex: none; border-radius: 16px; }
.ck-skel-line { height: 14px; width: 60%; }
.ck-skel-total { margin-top: 20px; width: 100%; }
.ck-skel-bar { width: 64px; }
.ck-fade-in { animation: ck-fade-in 220ms ease-out both; }
@keyframes ck-fade-in { from { opacity: 0; transform: translateY(4px); } }
@keyframes ck-skel-pulse { 50% { opacity: 0.55; } }
@media (prefers-reduced-motion: reduce) { .ck-skel { animation: none; } .ck-billing-reveal { transition: none; } .ck-reveal { transform: none; transition: none; } .ck-fade-in { animation: none; } }
.ck-panel-error { margin: 0; font-size: 14px; color: #b3261e; }
.ck-payment-slot { min-height: 120px; }
.ck-billing-toggle { display: flex; align-items: center; gap: 8px; margin-top: 14px; font-size: 14px; color: #111111; }
.ck-billing-toggle input { flex: 0 0 auto; margin: 0; }
.ck-billing-fields { padding-top: 14px; }
.ck-phone { display: grid; gap: 6px; margin-top: 14px; font-size: 14px; color: #111111; }
.ck-phone-hint { font-size: 12px; color: #707070; }
.ck-billing-reveal { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 120ms ease-out, opacity 100ms ease-out 20ms; }
.ck-billing-reveal > .ck-billing-fields { min-height: 0; overflow: hidden; }
.ck-billing-reveal:not(.is-loading) { grid-template-rows: 1fr; opacity: 1; }
.ck-billing-reveal.is-open > .ck-billing-fields { overflow: visible; }
.ck-input { display: block; width: 100%; height: 50px; box-sizing: border-box; padding: 0 12px; border: 1px solid #dedede; border-radius: 8px; background: #ffffff; font-family: inherit; font-size: 14px; color: #111111; }
.ck-input:focus { outline: 2px solid var(--brand); outline-offset: -1px; }
.ck-terms { display: flex; align-items: flex-start; gap: 8px; margin-top: 14px; font-size: 14px; color: #111111; }
.ck-terms input { flex: 0 0 auto; margin: 1px 0 0; }
.ck-billing-toggle input, .ck-terms input { width: 20px; height: 20px; box-sizing: border-box; border: 1px solid #d0d0d0; border-radius: 6px; background: #ffffff center / 15px 15px no-repeat; appearance: none; -webkit-appearance: none; cursor: pointer; }
.ck-billing-toggle input:checked, .ck-terms input:checked { border-color: var(--brand); background-color: var(--brand); background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' fill='none' stroke='%23ffffff' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M2.5 6.2 5 8.5 9.5 3.5'/%3E%3C/svg%3E"); }
.ck-billing-toggle input:focus-visible, .ck-terms input:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ck-terms a { color: var(--brand); text-decoration: underline; }
.ck-link-button { margin-top: 10px; padding: 0; border: 0; background: none; font-family: inherit; font-size: 14px; color: var(--brand); text-decoration: underline; cursor: pointer; }
.ck-link-button:disabled { opacity: 0.5; cursor: not-allowed; }
.ck-charged { margin: 10px 0 0; font-size: 12px; color: #707070; }
.ck-error { margin: 14px 0 0; font-size: 14px; color: #b3261e; }
.ck-error .ck-link-button { margin: 0 0 0 4px; }
.ck-submit { width: 100%; height: 50px; margin-top: 32px; border: 0; border-radius: 12px; background: var(--brand); color: #ffffff; font-family: inherit; font-size: 16px; font-weight: 600; cursor: pointer; }
.ck-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.ck-branding { margin-top: 14px; min-height: 20px; }
.ck-policies { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 48px; padding-top: 24px; border-top: 1px solid #dedede; }
.ck-policies a { font-size: 14px; color: var(--brand); text-decoration: underline; }
.ck-line { display: flex; align-items: flex-start; gap: 12px; }
.ck-line + .ck-line { margin-top: 16px; }
.ck-thumb-wrap { position: relative; flex: 0 0 auto; }
.ck-thumb { display: block; width: 64px; height: 64px; box-sizing: border-box; object-fit: cover; border: 2px solid #ffffff; border-radius: 16px; }
.ck-thumb-empty { background: #e5e5e5; }
.ck-badge { position: absolute; top: 0; right: 0; display: flex; align-items: center; justify-content: center; width: 20px; height: 20px; transform: translate(50%, -50%); border-radius: 50%; background: #000000; color: #ffffff; font-size: 12px; font-weight: 600; }
.ck-line-body { flex: 1; min-width: 0; }
.ck-line-title { margin: 0; font-size: 14px; color: #000000; }
.ck-line-subtitle { margin: 2px 0 0; font-size: 12px; color: #666666; }
.ck-line-prices { text-align: right; }
.ck-line-original { margin: 0; font-size: 12px; color: #666666; text-decoration: line-through; }
.ck-line-price { margin: 0; font-size: 14px; color: #000000; }
.ck-promo { margin-top: 24px; }
.ck-promo-form { display: flex; gap: 8px; }
.ck-promo-apply { flex: 0 0 auto; height: 50px; padding: 0 16px; border: 0; border-radius: 8px; background: #e5e5e5; color: #111111; font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; }
.ck-promo-apply:disabled { opacity: 0.5; cursor: not-allowed; }
.ck-promo-applied { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.ck-promo-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 8px; background: #e5e5e5; font-weight: 600; }
.ck-promo-applied .ck-link-button { margin-top: 0; }
.ck-promo-error { margin: 8px 0 0; font-size: 13px; color: #b3261e; }
.ck-totals { margin-top: 24px; }
.ck-total-row { display: flex; justify-content: space-between; font-size: 14px; color: #111111; }
.ck-total-row + .ck-total-row { margin-top: 8px; }
.ck-grand { display: flex; justify-content: space-between; margin-top: 16px; font-size: 18px; font-weight: 600; color: #111111; }
.ck-grand-amount { transition: color 0.2s; }
.ck-grand-amount[aria-busy] { color: #666666; }
.ck-currency-toggle { display: block; margin: 8px 0 0 auto; padding: 0; border: 0; background: none; font-family: inherit; font-size: 12px; color: #666666; text-align: right; text-decoration: underline; cursor: pointer; }
.ck-currency-toggle:hover { color: #111111; }
.ck-currency-toggle:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ck-currency-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
.ck-savings { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 14px; font-weight: 600; color: #111111; }
.ck-savings-label { display: flex; align-items: center; gap: 6px; }
.ck-tax { margin: 8px 0 0; font-size: 12px; color: #666666; }
.ck-bar { display: none; }
@media (max-width: 900px) {
	.ck-bar { display: flex; align-items: center; justify-content: space-between; width: 100%; height: 64px; padding: 0 14px; box-sizing: border-box; background: #f5f5f5; border: 0; border-bottom: 1px solid #dedede; font-family: inherit; cursor: pointer; }
	.ck-bar-label { display: flex; align-items: center; gap: 6px; font-size: 14px; color: #111111; }
	.ck-bar-chevron { width: 12px; height: 12px; color: var(--brand); transition: transform 150ms ease-out; }
	.ck-open .ck-bar-chevron { transform: rotate(180deg); }
	.ck-bar-totals { text-align: right; }
	.ck-bar-original { margin: 0; font-size: 12px; color: #666666; text-decoration: line-through; }
	.ck-bar-total { margin: 0; font-size: 14px; font-weight: 600; color: #111111; }
	.ck-bands { display: flex; flex-direction: column; min-height: 0; background: var(--page-bg); }
	.ck-band-left { display: block; width: 100%; padding: 24px 14px 40px; }
	.ck-band-right { display: none; width: 100%; padding: 24px 14px 40px; background: #f5f5f5; border-left: 0; order: -1; }
	.ck-open .ck-band-right { display: block; }
	.ck-column, .ck-summary { position: static; width: 100%; }
}
`;
}
