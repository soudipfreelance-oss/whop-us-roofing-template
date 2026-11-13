import { PAYMENT_ID, returnOriginOf } from "./shared";
import { getRequestHeader, getRequestUrl } from "../request.server";
import type { Whop, WhopClient } from "@whop/sdk";
import {
	missing,
	PAYMENT_READ,
	pageRead,
	storefrontAccountId,
} from "../../whop.server";
import { definite } from "./charge-attempt";
import { buyerCountryOf } from "./countries";
import {
	type PaymentCheck,
	type PaymentMissing,
} from "./order-complete-checks";
import { type PaymentState, paymentStateKey } from "./payment-state";
import { RETURN_ORIGIN } from "./environment";
import {
	formatOf,
	minorUnits,
	type Quote,
	quoteLifetimeMs,
	sellerDocumentsOf,
} from "./order";
import { createExpiringMap } from "./expiring-map";
import type { Call, QuoteCall } from "./whop-api";
import {
	createPaymentReads,
	createRecentReads,
	createReturnRefusals,
	DOCUMENTS_REFUSED,
	type DocumentsRead,
	keptRead,
	type HandoverApi,
	type HandoverRead,
	keptHandoverApi,
	keptQuoteApi,
	keptReadApi,
	keptStatusApi,
	logFailure,
	MOST_KEPT,
	paymentStateFor,
	refusalOf,
	stateOfStatus,
	type QuoteApi,
	type ReadApi,
	returnOrigins,
	type ReturnRefusals,
	UnreadId,
	unreadIfForbidden,
} from "./order.handlers";
import { buyerIpOf } from "./public-ip";

export async function sellerDocuments(
	whop: WhopClient,
	accountId: string,
	options?: { abortSignal?: AbortSignal },
): Promise<DocumentsRead> {
	try {
		return sellerDocumentsOf(
			await whop.accounts.retrieve({ id: accountId }, options),
		);
	} catch (failure) {
		logFailure("Reading the seller's policies", failure);
		return definite(refusalOf(failure)) ? DOCUMENTS_REFUSED : null;
	}
}

// Whop hosting sets APP_ID and BUILD_ID on every hosted isolate, and the
// environment is fixed at deploy, so it is read once. Not at module scope: `process` is only there on the server.
let whopHosted: boolean | undefined;

function onWhopHosting(): boolean {
	whopHosted ??= Boolean(process.env.APP_ID && process.env.BUILD_ID);
	return whopHosted;
}

export function buyerIp(): string | undefined {
	return buyerIpOf(getRequestHeader("cf-connecting-ip"), onWhopHosting());
}

export function buyerCountry(): string | undefined {
	return buyerCountryOf(getRequestHeader("cf-ipcountry"), onWhopHosting());
}

// `whop apps dev --public_host` names the origin a proxy serves a dev build
// at (WHOP_DEV_PUBLIC_ORIGIN): the page's own address, which the dev server
// doesn't see as its Host behind a proxy that rewrites it. A dev build takes
// it as the store's; a production build never reads it. Read once, and not at
// module scope, as above.
let devPublicOrigin: string | null | undefined;

function devServerOrigin(): string | undefined {
	if (import.meta.env?.DEV !== true) return undefined;
	devPublicOrigin ??=
		returnOriginOf(process.env.WHOP_DEV_PUBLIC_ORIGIN) ?? null;
	return devPublicOrigin ?? undefined;
}

// The URL this call came in on, as the server received it: any client can set
// X-Forwarded-Host or X-Forwarded-Proto, so neither is read.
export function storeOrigins(): string[] {
	return returnOrigins(
		getRequestUrl({ xForwardedHost: false, xForwardedProto: false }),
		RETURN_ORIGIN,
		devServerOrigin(),
	);
}

const returnRefusals = createReturnRefusals();

// What a charge's return URL is checked against beside `storeOrigins`: the
// page's own origin, as the browser sends it in the Origin header.
export function returnCheck(): {
	pageOrigin: string | undefined;
	returnRefusals: ReturnRefusals;
} {
	return { pageOrigin: getRequestHeader("origin"), returnRefusals };
}

// A quote as Whop made it, or as a handover keeps it (`HandoverRead`): only
// the fields read here.
type QuoteFields = Pick<
	Whop.PaymentQuote,
	| "id"
	| "total"
	| "base_total"
	| "exchange_rate"
	| "recommended_currencies"
	| "tax_status"
	| "tax_behavior"
	| "subtotal"
	| "discount"
	| "tax_amount"
	| "promo_code_id"
	| "located_by"
	| "created_at"
	| "expires_at"
> & {
	line_items: Array<
		Pick<Whop.PaymentQuote["line_items"][number], "plan_id" | "subtotal">
	>;
};

// Where Whop placed the buyer only to estimate tax: a quote located there is a
// preview a payment refuses.
const ESTIMATED_LOCATIONS = new Set<string | null>([
	"ip_address",
	"presentment_country",
]);

export function quoteOf(
	raw: QuoteFields,
	promoCode: string | undefined,
): Quote {
	const units = (value: Whop.Money) => minorUnits(value.amount, value.decimals);
	return {
		id: raw.id,
		money: formatOf(raw.total),
		baseMoney: formatOf(raw.base_total),
		exchangeRate: raw.exchange_rate ?? null,
		baseTotal: units(raw.base_total),
		recommendedCurrencies: raw.recommended_currencies.map((code) =>
			code.toLowerCase(),
		),
		taxStatus: raw.tax_status,
		taxBehavior: raw.tax_behavior,
		subtotal: units(raw.subtotal),
		discount: 0 - units(raw.discount),
		tax: units(raw.tax_amount),
		total: units(raw.total),
		lines: raw.line_items.map((line) => ({
			planId: line.plan_id,
			subtotal: units(line.subtotal),
		})),
		promoCode: raw.promo_code_id ? (promoCode ?? null) : null,
		estimated: ESTIMATED_LOCATIONS.has(raw.located_by),
		lifetimeMs: quoteLifetimeMs(raw.created_at, raw.expires_at),
	};
}

export type OrderPayment = Pick<
	Whop.Payment,
	| "id"
	| "account_id"
	| "paid_at"
	| "customer_email"
	| "payment_method_type"
	| "presentment_total"
	| "total"
	| "subtotal"
	| "tax_amount"
	| "tax_behavior"
> & {
	line_items: Array<
		Pick<
			Whop.ReceiptLineItem,
			| "label"
			| "plan_id"
			| "plan_title"
			| "product_title"
			| "quantity"
			| "subtotal"
		>
	>;
	payment_instrument: { display_name: string } | null;
	shipping_address: { name: string | null; country: string | null } | null;
};

function orderPaymentOf(payment: Whop.Payment | null): OrderPayment | null {
	if (!payment) return null;
	const address = payment.shipping_address;
	return {
		id: payment.id,
		account_id: payment.account_id,
		paid_at: payment.paid_at,
		customer_email: payment.customer_email,
		payment_method_type: payment.payment_method_type,
		presentment_total: payment.presentment_total,
		total: payment.total,
		subtotal: payment.subtotal,
		tax_amount: payment.tax_amount,
		tax_behavior: payment.tax_behavior,
		line_items: payment.line_items.map((item) => ({
			label: item.label,
			plan_id: item.plan_id,
			plan_title: item.plan_title,
			product_title: item.product_title,
			quantity: item.quantity,
			subtotal: item.subtotal,
		})),
		payment_instrument: payment.payment_instrument
			? { display_name: payment.payment_instrument.display_name }
			: null,
		shipping_address: address
			? { name: address.name, country: address.country }
			: null,
	};
}

export type PaymentRead = { payment: OrderPayment; state: PaymentState };

// One per isolate, shared by the order-complete page, the browser's payment
// reads and the charge's resend check (order.functions.ts), each of which
// keeps its own recent answers (`ANSWER_KEPT_MS`).
const paymentReads = createPaymentReads();
const pageReads = createRecentReads();
const pagePayments = createExpiringMap<OrderPayment | null>(MOST_KEPT);
const browserReads = {
	quote: createRecentReads(),
	state: createRecentReads(),
	charge: createRecentReads(),
};

export function paymentReadApi(
	api: ReadApi,
	reader: keyof typeof browserReads,
): ReadApi {
	return keptReadApi(api, paymentReads, browserReads[reader], missing);
}

export function chargeQuoteApi(api: QuoteApi): QuoteApi {
	return keptQuoteApi(api, paymentReads, browserReads.charge, missing);
}

const handoverReads = createExpiringMap<HandoverRead>(MOST_KEPT);

export function handoverQuoteApi(api: {
	paymentQuotes: { retrieve: Call<QuoteCall> };
}): HandoverApi {
	return keptHandoverApi(api, paymentReads, handoverReads, missing);
}

// The page reloads the order once it has seen the payment's status move,
// naming the state it saw (`checkOrderAgain`). What this page kept from before
// the move is older than that, so it is read again, but only when the
// browser's own status read here saw that state: a state the page names that
// no read of the server's backs reads nothing new, so naming one can't drive
// reads on the store's key.
function forgetKeptBefore(paymentId: string, store: string, seen: string) {
	const now = paymentReads.now();
	const keyOf = (read: Parameters<typeof stateOfStatus>[0]) => {
		const state = stateOfStatus(read, store);
		return state ? paymentStateKey(state) : null;
	};
	const kept = keyOf(pageReads.statuses.get(paymentId, now));
	if (kept === null || kept === seen) return;
	if (keyOf(browserReads.state.statuses.get(paymentId, now)) !== seen) return;
	pageReads.statuses.delete(paymentId);
	pagePayments.delete(paymentId);
}

type ReadOutcome<T> =
	| { value: T }
	| { failure: "missing" | "retry" }
	| { failure: "refused"; unread?: UnreadId };

function outcomeOf<T>(read: Promise<T>): Promise<ReadOutcome<T>> {
	return read.then(
		(value): ReadOutcome<T> => ({ value }),
		(failure: unknown): ReadOutcome<T> => {
			if (missing(failure)) return { failure: "missing" };
			const read = unreadIfForbidden(failure);
			if (read instanceof UnreadId) return { failure: "refused", unread: read };
			logFailure("Reading a payment", failure);
			return { failure: definite(refusalOf(failure)) ? "refused" : "retry" };
		},
	);
}

// What actually happened to a payment, for the order-complete page, read again
// on every visit: a reload, a restored tab or a bank debit clearing days later
// all get the current answer rather than whatever the URL claimed. The payment
// gives the order's lines; how it stands is Whop's lifecycle, its status read.
// Both are read at once, and neither answer is final while the other may still
// answer next time.
//
// The payment id is untrusted input. The company key only returns this store's
// own payments, and the account checks turn a key that can see more into the
// same answer. Either read that may answer next time (a timeout, a 5xx, a 429)
// is checked again from the browser. Otherwise a payment Whop says it doesn't
// have (a 404 for the payment itself), or another store's, is missing: the
// page says it couldn't find the order. Anything else unread (another 4xx,
// Whop's 403, which may be the store's key lacking the scope and is logged once
// with that hint, an empty answer) is null, so the page shows its generic
// face, never a failure,
// which would tell a buyer their order died when only the lookup did. A store
// with no account configured throws, for the error page: that is no lookup
// that failed, and the generic face would tell every buyer their order is on
// its way.
export async function readPayment(
	paymentId: unknown,
	seen?: unknown,
): Promise<PaymentRead | PaymentCheck | PaymentMissing | null> {
	if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId)) {
		return null;
	}
	const store = storefrontAccountId();
	if (typeof seen === "string") forgetKeptBefore(paymentId, store, seen);
	const [payment, state] = await Promise.all([
		outcomeOf(
			pageRead(
				(client, options) =>
					keptRead(
						paymentReads,
						"payment",
						paymentId,
						() => client.payments.retrieve({ id: paymentId }, options),
						missing,
						{ shape: orderPaymentOf, recent: pagePayments },
					),
				PAYMENT_READ,
			),
		),
		outcomeOf(
			pageRead(
				(client, options) =>
					paymentStateFor(
						keptStatusApi(
							{
								payments: {
									retrieveStatus: (request) =>
										client.payments.retrieveStatus(request, options),
								},
							},
							paymentReads,
							pageReads,
							missing,
						),
						store,
						paymentId,
					),
				PAYMENT_READ,
			),
		),
	]);
	const unread = [payment, state].flatMap((outcome) =>
		"unread" in outcome && outcome.unread ? [outcome.unread] : [],
	)[0];
	if (unread) logFailure("Reading a payment", unread);
	const failed = (outcome: ReadOutcome<unknown>, failure: string) =>
		"failure" in outcome && outcome.failure === failure;
	if (failed(payment, "retry") || failed(state, "retry")) {
		return { checking: paymentId };
	}
	const gone: PaymentMissing = { paymentId, missing: true };
	if (failed(payment, "missing")) return gone;
	if (!("value" in payment) || !payment.value) return null;
	if (payment.value.account_id !== store) return gone;
	return "value" in state && state.value
		? { payment: payment.value, state: state.value }
		: null;
}
