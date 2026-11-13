import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { onCartUnreadable, useCartStore } from "../lib/cart";
import {
	attemptPageFor,
	cartOrder,
	settleOrderPage,
	visibleFor,
} from "../lib/checkout/charge-attempt";
import {
	checkOrderAgain,
	isPaymentCheck,
	isPaymentMissing,
	landPaymentCheck,
	orderInView,
	type PaymentCheck,
	type PaymentChecked,
	type PaymentMissing,
} from "../lib/checkout/order-complete-checks";
import {
	type PaymentOutcome,
	type PaymentState,
	paymentOutcome,
	stillDeciding,
} from "../lib/checkout/payment-state";
import {
	storeLocks,
	storeStorage,
	tabStorage,
} from "../lib/checkout/environment";
import { documentVisibility } from "../lib/checkout/use-page-visibility";
import { declinedNote } from "../lib/checkout/messages";
import {
	type Amount,
	amountOf,
	money,
	type OrderItem,
	paymentBreakdown,
} from "../lib/checkout/order";
import { readPaymentState } from "../lib/checkout/order.functions";
import { type OrderPayment, readPayment } from "../lib/checkout/order.server";
import {
	isRecord,
	ORDER_PARAM,
	PAYMENT_ID,
	RETURN_TOKEN_PARAM,
} from "../lib/checkout/shared";

// Fill in per store. Everything else in this file is the standard design.
const STORE = {
	brandColor: "#000000",
	// Matches the checkout's, white unless the seller asks otherwise.
	pageBackground: "#ffffff",
	wordmark: { src: "/imported/wordmark.png", alt: "Store" },
	// Where a buyer with a question goes. Point this at the store's real,
	// verified support destination (an email, a contact page, a support chat);
	// never invent one.
	support: { label: "Contact us", href: "/policies/contact-information" },
	// What the buyer can expect after paying. Written for the store's own
	// fulfilment — remove the shipping line for a digital product.
	nextSteps: [
		"A receipt is on its way to your inbox.",
		"We'll email you tracking details as soon as your order ships.",
	],
	continueShopping: { label: "Continue shopping", href: "/" },
};

type OrderLine = {
	label: string;
	subtitle: string;
	quantity: number;
	subtotal: Amount | null;
};

type Order = {
	paymentId: string;
	state: PaymentState;
	lines: OrderLine[];
	items: OrderItem[];
	total: Amount | null;
	maskedEmail: string | null;
	shipping: { name: string | null; place: string | null } | null;
	paidWith: string | null;
	paidAt: string | null;
	// Only where exact (`paymentBreakdown`), so the summary adds up.
	discount: Amount | null;
	tax: Amount | null;
};

// Enough for the buyer to recognize their own address; not enough for anyone
// holding a forwarded link to read it back. `j***@example.com`.
function maskEmail(email: string | null | undefined): string | null {
	if (!email) return null;
	const at = email.indexOf("@");
	if (at < 1) return null;
	return `${email[0]}***${email.slice(at)}`;
}

// The `payment` param on the return leg (`?payment=pay_x&status=succeeded`),
// `payment_id` from the hand-off, `receipt_id` from older thank-you pages —
// every surface that can send a buyer here names the same record differently.
function paymentIdFrom(search: Record<string, unknown>): string {
	for (const key of ["payment_id", "payment", "receipt_id"]) {
		const value = search[key];
		if (typeof value === "string" && PAYMENT_ID.test(value)) {
			return value;
		}
	}
	return "";
}

// Whop returns the item a payment's variant implies when it recorded no items
// of its own, so these are every line there is.
function linesFrom(payment: OrderPayment): OrderLine[] {
	return payment.line_items.map((item) => {
		const product = item.product_title ?? "";
		const plan = item.plan_title ?? "";
		return {
			label: item.label || product || plan || "Item",
			subtitle: product && plan && product !== plan ? plan : "",
			quantity: item.quantity,
			subtotal: amountOf(item.subtotal),
		};
	});
}

function itemsFrom(payment: OrderPayment): OrderItem[] {
	const items = payment.line_items.map((item) =>
		item.plan_id ? { planId: item.plan_id, quantity: item.quantity } : null,
	);
	return items.every((item) => item !== null) ? items : [];
}

// As with the email, a forwarded link mustn't reveal the buyer: the
// recipient's first name and the country, never the full name or the town.
function shippingFrom(payment: OrderPayment): Order["shipping"] {
	const address = payment.shipping_address;
	if (!address) return null;
	const firstName = address.name?.trim().split(/\s+/)[0];
	return { name: firstName || null, place: address.country || null };
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
	card: "Card",
	apple_pay: "Apple Pay",
	google_pay: "Google Pay",
	paypal: "PayPal",
	us_bank_account: "Bank account",
	sepa_debit: "Bank account",
	klarna: "Klarna",
	afterpay_clearpay: "Afterpay",
	affirm: "Affirm",
	cashapp: "Cash App Pay",
	link: "Link",
	balance: "Whop balance",
};

function paidWithFrom(payment: OrderPayment): string | null {
	const name = payment.payment_instrument?.display_name;
	if (name) return name;
	const type = payment.payment_method_type;
	if (!type) return null;
	return (
		PAYMENT_METHOD_LABELS[type] ??
		type.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
	);
}

// Server-side because only server code is given the API credential.
const loadOrder = createServerFn({ method: "GET" })
	.validator((input: { paymentId: string; seen?: string }): unknown => input)
	.handler(
		async ({ data }): Promise<Order | PaymentMissing | PaymentCheck | null> => {
			const request = isRecord(data) ? data : {};
			const { paymentId, seen } = request;
			if (typeof paymentId !== "string") return null;
			const read = await readPayment(paymentId, seen);
			if (!read || isPaymentCheck(read) || isPaymentMissing(read)) return read;
			const { payment, state } = read;
			return {
				paymentId: payment.id,
				state,
				lines: linesFrom(payment),
				items: itemsFrom(payment),
				// The order's total, in the currency the buyer paid in. `total` is the
				// same amount converted into the currency the store settles in. Both
				// leave out a buyer fee, and Whop's payment states neither the fee nor
				// the amount charged with it, so a payment that carried one (from a
				// Whop-hosted checkout, say) shows its total without it.
				total: amountOf(payment.presentment_total ?? payment.total),
				maskedEmail: maskEmail(payment.customer_email),
				shipping: shippingFrom(payment),
				paidWith: paidWithFrom(payment),
				paidAt: payment.paid_at,
				...paymentBreakdown(payment),
			};
		},
	);

const STYLES = `
.oc { --brand: ${STORE.brandColor}; --page-bg: ${STORE.pageBackground}; min-height: 100vh; background: var(--page-bg); color: #111111; font-family: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.oc-header { display: flex; align-items: center; justify-content: center; height: 86px; background: #ffffff; border-bottom: 1px solid #dedede; }
.oc-wordmark { display: block; width: 140px; height: 45px; object-fit: contain; }
.oc-wordmark-text { font-size: 22px; font-weight: 700; letter-spacing: -0.01em; color: #000000; }
.oc-body { max-width: 920px; margin: 0 auto; padding: 48px 24px 96px; display: grid; grid-template-columns: 1fr 360px; gap: 48px; align-items: start; }
.oc-main { min-width: 0; }
.oc-mark { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; background: var(--brand); color: #ffffff; }
.oc-mark-soft { background: #f5f5f5; color: #545454; }
.oc-mark-bad { background: #fbeae9; color: #b3261e; }
.oc-eyebrow { margin: 20px 0 4px; font-size: 14px; color: #6b7177; }
.oc-title { margin: 0; font-size: 28px; font-weight: 600; line-height: 1.2; color: #000000; }
.oc-lede { margin: 12px 0 0; font-size: 16px; line-height: 1.5; color: #333333; }
.oc-section { margin-top: 32px; padding: 20px; border: 1px solid #dedede; border-radius: 12px; }
.oc-heading { margin: 0 0 12px; font-size: 16px; font-weight: 600; color: #000000; }
.oc-steps { margin: 0; padding: 0 0 0 18px; list-style: disc; font-size: 14px; line-height: 1.7; color: #333333; }
.oc-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.oc-detail-label { margin: 0 0 2px; font-size: 12px; color: #6b7177; }
.oc-detail-value { margin: 0; font-size: 14px; color: #111111; overflow-wrap: anywhere; }
.oc-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
.oc-button { display: inline-flex; align-items: center; justify-content: center; height: 48px; padding: 0 22px; border: 0; border-radius: 12px; background: var(--brand); color: #ffffff; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; }
.oc-button-ghost { background: transparent; color: var(--brand); border: 1px solid var(--brand); }
.oc-summary { position: sticky; top: 24px; padding: 20px; background: #f5f5f5; border-radius: 12px; }
.oc-line { display: flex; align-items: flex-start; gap: 12px; }
.oc-line + .oc-line { margin-top: 14px; }
.oc-qty { flex: 0 0 auto; display: flex; align-items: center; justify-content: center; min-width: 28px; height: 28px; padding: 0 8px; border-radius: 14px; background: #000000; color: #ffffff; font-size: 12px; font-weight: 600; }
.oc-line-body { flex: 1; min-width: 0; }
.oc-line-title { margin: 0; font-size: 14px; color: #000000; }
.oc-line-subtitle { margin: 2px 0 0; font-size: 12px; color: #666666; }
.oc-line-price { margin: 0; font-size: 14px; color: #000000; white-space: nowrap; }
.oc-adjust { display: flex; justify-content: space-between; margin-top: 14px; font-size: 14px; color: #333333; }
.oc-total { display: flex; justify-content: space-between; margin-top: 20px; padding-top: 16px; border-top: 1px solid #dedede; font-size: 18px; font-weight: 600; color: #111111; }
.oc-currency { margin-right: 6px; font-size: 12px; font-weight: 400; color: #666666; }
.oc-tax { margin: 8px 0 0; font-size: 12px; color: #666666; }
@media (max-width: 900px) {
	.oc-body { grid-template-columns: 1fr; gap: 32px; padding: 32px 16px 64px; }
	.oc-summary { position: static; }
}
`;

function CheckIcon() {
	return (
		<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M5 12.5l4.2 4.2L19 7"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

function ClockIcon() {
	return (
		<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
			<circle
				cx="12"
				cy="12"
				r="8.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
			/>
			<path
				d="M12 7.5V12l3 2"
				fill="none"
				stroke="currentColor"
				strokeWidth="2"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function CrossIcon() {
	return (
		<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M7 7l10 10M17 7L7 17"
				fill="none"
				stroke="currentColor"
				strokeWidth="2.4"
				strokeLinecap="round"
			/>
		</svg>
	);
}

function OrderSummary(props: { order: Order }) {
	const { order } = props;
	return (
		<aside className="oc-summary" aria-label="Order summary">
			{order.lines.map((line, index) => (
				<div className="oc-line" key={`${line.label}-${index}`}>
					<span className="oc-qty">{line.quantity}</span>
					<div className="oc-line-body">
						<p className="oc-line-title">{line.label}</p>
						{line.subtitle ? (
							<p className="oc-line-subtitle">{line.subtitle}</p>
						) : null}
					</div>
					{line.subtotal !== null ? (
						<p className="oc-line-price">
							{money(line.subtotal.units, line.subtotal.money)}
						</p>
					) : null}
				</div>
			))}
			{order.discount ? (
				<div className="oc-adjust">
					<span>Discount</span>
					<span>{money(-order.discount.units, order.discount.money)}</span>
				</div>
			) : null}
			{order.tax ? (
				<div className="oc-adjust">
					<span>Tax</span>
					<span>{money(order.tax.units, order.tax.money)}</span>
				</div>
			) : null}
			{order.total !== null ? (
				<div className="oc-total">
					<span>Total</span>
					<span>
						<span className="oc-currency">
							{order.total.money.currency.toUpperCase()}
						</span>
						{money(order.total.units, order.total.money)}
					</span>
				</div>
			) : null}
			{order.tax ? null : (
				<p className="oc-tax">Includes any sales tax collected at payment.</p>
			)}
		</aside>
	);
}

function Details(props: { order: Order }) {
	const { order } = props;
	// The day is the buyer's own, so it is written in the browser after the
	// page mounts: the server's time zone could name another day, and the
	// server's HTML would then disagree with the page.
	const [paidOn, setPaidOn] = useState<string | null>(null);
	useEffect(() => {
		setPaidOn(
			order.paidAt
				? new Date(order.paidAt).toLocaleDateString("en-US", {
						year: "numeric",
						month: "long",
						day: "numeric",
					})
				: null,
		);
	}, [order.paidAt]);
	const rows: Array<{ label: string; value: string }> = [
		{ label: "Order number", value: order.paymentId },
	];
	if (order.maskedEmail) {
		rows.push({ label: "Receipt sent to", value: order.maskedEmail });
	}
	if (order.shipping?.name || order.shipping?.place) {
		rows.push({
			label: "Shipping to",
			value: [order.shipping.name, order.shipping.place]
				.filter((part) => Boolean(part))
				.join(" · "),
		});
	}
	if (order.paidWith) rows.push({ label: "Paid with", value: order.paidWith });
	if (paidOn) rows.push({ label: "Paid on", value: paidOn });
	return (
		<div className="oc-section">
			<h2 className="oc-heading">Order details</h2>
			<div className="oc-detail">
				{rows.map((row) => (
					<div key={row.label}>
						<p className="oc-detail-label">{row.label}</p>
						<p className="oc-detail-value">{row.value}</p>
					</div>
				))}
			</div>
		</div>
	);
}

// One value of a param the page reads; an empty or repeated one names
// nothing.
function textParam(value: unknown): string | null {
	return typeof value === "string" && value ? value : null;
}

export const Route = createFileRoute("/order-complete")({
	component: OrderCompletePage,
	// The URL stays exactly as Whop sent it, every param this page doesn't read
	// (a campaign's, a provider's) included: dropping or changing one here makes
	// the router rewrite the address bar on arrival.
	validateSearch: (search: Record<string, unknown>) => search,
	loaderDeps: ({ search }) => ({ paymentId: paymentIdFrom(search) }),
	loader: ({ deps }) => loadOrder({ data: { paymentId: deps.paymentId } }),
	// Its order reads the payment from Whop, not to be spent on a hover the
	// buyer may not follow. The visit loads it.
	preload: false,
	head: () => ({ meta: [{ title: "Your order" }] }),
});

const FACES: Record<
	| "confirmed"
	| "confirming"
	| "processing"
	| "awaiting"
	| "unverified"
	| "unconfirmed",
	{
		soft: boolean;
		eyebrow: string;
		title: string;
		lede: string;
		nextSteps: boolean;
		back: boolean;
	}
> = {
	confirmed: {
		soft: false,
		eyebrow: "Order confirmed",
		title: "Thank you for your order!",
		lede: "Your payment was accepted and your order is confirmed.",
		nextSteps: true,
		back: false,
	},
	confirming: {
		soft: true,
		eyebrow: "Order received",
		title: "Your payment is being confirmed",
		lede: "This usually takes a moment. Keep this page open and it will update on its own.",
		nextSteps: false,
		back: false,
	},
	processing: {
		soft: true,
		eyebrow: "Order received",
		title: "Thanks — your payment is being confirmed",
		lede: "Your bank is still clearing the payment. Some payment methods take a little while; you don't need to do anything, and we'll email you the moment it's through.",
		nextSteps: true,
		back: false,
	},
	awaiting: {
		soft: true,
		eyebrow: "Awaiting payment",
		title: "Complete your payment to finish your order",
		lede: "Pay using the instructions you were given. Your order goes through once the payment arrives.",
		nextSteps: false,
		back: true,
	},
	// The tab that paid still holds the payment, so Back to checkout and
	// "Confirm my payment" there pick up the bank's check where it stopped.
	unverified: {
		soft: true,
		eyebrow: "Verification not finished",
		title: "Finish verifying your payment",
		lede: "Your bank asked you to verify this payment, and that step isn't done yet. Go back to checkout and choose Confirm my payment to finish it.",
		nextSteps: false,
		back: true,
	},
	unconfirmed: {
		soft: true,
		eyebrow: "Payment not confirmed",
		title: "We couldn't confirm this payment yet",
		lede: "If your bank declined it, go back to checkout and try again. If it went through, a receipt is on its way to your inbox.",
		nextSteps: false,
		back: true,
	},
};

function OrderCompletePage() {
	const loaded = Route.useLoaderData();
	const [checked, setChecked] = useState<PaymentChecked<
		Order | PaymentMissing
	> | null>(null);
	// A read that didn't answer, or a charge Whop is still deciding, is read
	// again until it settles.
	const checkingId = isPaymentCheck(loaded)
		? loaded.checking
		: loaded && !isPaymentMissing(loaded) && stillDeciding(loaded.state)
			? loaded.paymentId
			: null;
	useEffect(() => {
		if (!checkingId || !loaded || isPaymentMissing(loaded)) return;
		let live = true;
		const page = documentVisibility();
		void checkOrderAgain(
			loaded,
			{
				order: (seen) =>
					loadOrder({
						data: { paymentId: checkingId, ...(seen ? { seen } : {}) },
					}),
				state: () => readPaymentState({ data: { paymentId: checkingId } }),
			},
			(ms) => visibleFor(ms, page, () => live),
			() => live,
		).then((found) => {
			if (live) {
				setChecked((kept) => landPaymentCheck(kept, checkingId, found));
			}
		});
		return () => {
			live = false;
		};
	}, [checkingId]);
	const { order: found, checking } = orderInView(loaded, checked);
	const missing = isPaymentMissing(found);
	const order = missing ? null : found;
	const confirming =
		order !== null &&
		stillDeciding(order.state) &&
		checked?.paymentId !== order.paymentId;
	const search = Route.useSearch();
	const placed = textParam(search[ORDER_PARAM]);
	const returnToken = textParam(search[RETURN_TOKEN_PARAM]);
	// A payment that can't be read means the generic face, whatever the URL
	// claims: a lookup that failed must never tell a buyer their order died.
	const state: PaymentOutcome = order
		? paymentOutcome({ ...order.state, claimed: textParam(search.status) })
		: "unknown";

	const paymentId = order?.paymentId;
	const paymentState = order?.state;
	const items = order?.items;
	// Sending the attempt again from its own checkout gets this same payment back
	// from Whop before anything new is charged.
	const [attemptPage, setAttemptPage] = useState<string | null>(null);
	useEffect(() => {
		if (paymentId) setAttemptPage(attemptPageFor(paymentId, tabStorage));
	}, [paymentId]);
	useEffect(() => {
		if (!paymentId || !paymentState || !items) return;
		return settleOrderPage({
			paymentId,
			state: paymentState,
			lines: items,
			order: placed,
			returnToken,
			storage: tabStorage,
			markStorage: storeStorage,
			locks: storeLocks(),
			cart: {
				hasHydrated: () => useCartStore.persist.hasHydrated(),
				onFinishHydration: (run) => useCartStore.persist.onFinishHydration(run),
				onHydrationFailed: onCartUnreadable,
				lines: () => useCartStore.getState().lines,
				clear: () => useCartStore.getState().clear(),
			},
		});
	}, [paymentId, paymentState, items, placed, returnToken]);

	// A store whose wordmark file is missing shows its name rather than a
	// broken-image icon. The image usually fails during the server-rendered
	// paint, before React is listening, so the mount check catches that case
	// and onError catches a failure after hydration.
	const [wordmarkFailed, setWordmarkFailed] = useState(false);
	const wordmarkRef = useRef<HTMLImageElement>(null);
	useEffect(() => {
		const img = wordmarkRef.current;
		if (img?.complete && img.naturalWidth === 0) setWordmarkFailed(true);
	}, []);
	const header = (
		<header className="oc-header">
			{wordmarkFailed || !STORE.wordmark.src ? (
				<span className="oc-wordmark-text">{STORE.wordmark.alt}</span>
			) : (
				<img
					ref={wordmarkRef}
					className="oc-wordmark"
					src={STORE.wordmark.src}
					alt={STORE.wordmark.alt}
					onError={() => setWordmarkFailed(true)}
				/>
			)}
		</header>
	);

	const support = (
		<a className="oc-button oc-button-ghost" href={STORE.support.href}>
			{STORE.support.label}
		</a>
	);

	if (checking) {
		return (
			<div className="oc">
				<style>{STYLES}</style>
				{header}
				<div className="oc-body">
					<div className="oc-main">
						<div className="oc-mark oc-mark-soft">
							<ClockIcon />
						</div>
						<p className="oc-eyebrow">Checking your payment</p>
						<h1 className="oc-title">We're confirming your payment</h1>
						<p className="oc-lede">
							This can take a moment. Keep this page open and it will update on
							its own.
						</p>
					</div>
				</div>
			</div>
		);
	}

	// Whop says there is no such payment for this store: neither a thank-you
	// nor a failure, as the link alone is wrong.
	if (missing) {
		return (
			<div className="oc">
				<style>{STYLES}</style>
				{header}
				<div className="oc-body">
					<div className="oc-main">
						<p className="oc-eyebrow">Order not found</p>
						<h1 className="oc-title">We couldn't find this order</h1>
						<p className="oc-lede">
							This link doesn't match an order from this store. If you paid, the
							receipt in your inbox has your order details, and we're glad to
							help.
						</p>
						<div className="oc-actions">
							<a className="oc-button" href={STORE.continueShopping.href}>
								{STORE.continueShopping.label}
							</a>
							{support}
						</div>
					</div>
				</div>
			</div>
		);
	}

	if (state === "failed") {
		return (
			<div className="oc">
				<style>{STYLES}</style>
				{header}
				<div className="oc-body">
					<div className="oc-main">
						<div className="oc-mark oc-mark-bad">
							<CrossIcon />
						</div>
						<p className="oc-eyebrow">Payment not completed</p>
						<h1 className="oc-title">Your order didn't go through</h1>
						<p className="oc-lede">
							{declinedNote(
								order?.state.lastPaymentError?.message,
								cartOrder(placed, order?.items ?? []),
							)}
						</p>
						<div className="oc-actions">
							<a className="oc-button" href={STORE.continueShopping.href}>
								Back to the store
							</a>
							{support}
						</div>
					</div>
					{order && order.lines.length > 0 ? (
						<OrderSummary order={order} />
					) : null}
				</div>
			</div>
		);
	}

	if (state === "unknown" || !order) {
		return (
			<div className="oc">
				<style>{STYLES}</style>
				{header}
				<div className="oc-body">
					<div className="oc-main">
						<div className="oc-mark">
							<CheckIcon />
						</div>
						<p className="oc-eyebrow">Thank you</p>
						<h1 className="oc-title">
							Your order is on its way to being confirmed
						</h1>
						<p className="oc-lede">
							We couldn't pull up the details of this order here, but if your
							payment went through, a receipt with everything you bought is
							already in your inbox.
						</p>
						<div className="oc-actions">
							<a className="oc-button" href={STORE.continueShopping.href}>
								{STORE.continueShopping.label}
							</a>
							{support}
						</div>
					</div>
				</div>
			</div>
		);
	}

	const face = FACES[confirming ? "confirming" : state];
	const backToCheckout = attemptPage ? (
		<a className="oc-button" href={attemptPage}>
			Back to checkout
		</a>
	) : null;

	return (
		<div className="oc">
			<style>{STYLES}</style>
			{header}
			<div className="oc-body">
				<div className="oc-main">
					<div className={`oc-mark${face.soft ? " oc-mark-soft" : ""}`}>
						{face.soft ? <ClockIcon /> : <CheckIcon />}
					</div>
					<p className="oc-eyebrow">{face.eyebrow}</p>
					<h1 className="oc-title">{face.title}</h1>
					<p className="oc-lede">{face.lede}</p>

					<Details order={order} />

					{face.nextSteps ? (
						<div className="oc-section">
							<h2 className="oc-heading">What happens next</h2>
							<ul className="oc-steps">
								{STORE.nextSteps.map((step) => (
									<li key={step}>{step}</li>
								))}
							</ul>
						</div>
					) : null}

					<div className="oc-actions">
						{face.back ? backToCheckout : null}
						<a
							className={`oc-button${face.back && backToCheckout ? " oc-button-ghost" : ""}`}
							href={STORE.continueShopping.href}
						>
							{STORE.continueShopping.label}
						</a>
						{support}
					</div>
				</div>

				<OrderSummary order={order} />
			</div>
		</div>
	);
}
