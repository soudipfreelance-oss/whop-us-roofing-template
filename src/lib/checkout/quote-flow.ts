import {
	definite,
	ITEMS_REFUSED_CODE,
	LOCATION_REQUIRED_CODE,
	type Refusal,
	RefusedError,
} from "./charge-attempt";
import {
	type CurrencyPick,
	pickOf,
	pickPending,
	runPick,
} from "./currency-pick";
import {
	type Address,
	addressKey,
	type PageQuote,
	PAYABLE_MARGIN_MS,
	presentmentFor,
	type PromoAwaiting,
	type Quote,
	taxFailed,
} from "./order";
import {
	ADDRESS_UNPLACED,
	BuyerError,
	refusalMessage,
	CURRENCY_REFUSED,
	ORDER_CHANGED,
	ORDER_REFUSED,
	PRICING_RETRYING,
	PROMO_NOT_APPLIED,
	promoMessage,
	promoRefused,
	QUOTE_UNAVAILABLE,
	repricedMessage,
	TAX_UNAVAILABLE,
} from "./messages";
import { createExpiringMap, type ExpiringMap } from "./expiring-map";
import type { QuoteRequests } from "./quote-requests";
import { isRecord } from "./shared";

export type QuoteFlow = {
	adaptivePricing: boolean;
	planCurrency: string;
	quote: (request: {
		address: Address | null;
		promoCode: string | null;
		presentment: string | undefined;
	}) => Promise<{ quote: Quote } | { refusal: Refusal }>;
	requests: QuoteRequests;
	inView: { current: PageQuote | null };
	// The total the page shows with no quote in view: the listed prices'.
	listed: { total: number; currency: string };
	pick: { current: CurrencyPick };
	promo: { current: string | null };
	delivery: () => Address | null;
	land: (quote: PageQuote) => void;
	dropPromo: (failure: RefusedError) => void;
};

export async function answerItemsRefused<A>(
	answer: Promise<A>,
	refused: (() => void) | undefined,
): Promise<A> {
	const answered = await answer;
	if (
		isRecord(answered) &&
		isRecord(answered.refusal) &&
		answered.refusal.code === ITEMS_REFUSED_CODE
	) {
		refused?.();
	}
	return answered;
}

export function isRefusedPromo(
	promo: string | null,
	failure: unknown,
): failure is RefusedError {
	return (
		promo !== null && failure instanceof RefusedError && promoRefused(failure)
	);
}

// A quote that comes back without the code it asked for, and no refusal, says
// the code can't be used for this order: it comes off once, and the quote that
// landed is already the order's price without it.
export function dropUnappliedPromo(flow: QuoteFlow, landed: PageQuote) {
	const asked = landed.promoAsked;
	if (asked === null || landed.promoCode !== null) return;
	if (flow.promo.current !== asked) return;
	flow.dropPromo(
		new RefusedError({ code: null, message: PROMO_NOT_APPLIED, status: null }),
	);
}

export function presentmentOf(
	flow: QuoteFlow,
	currency?: string,
): string | undefined {
	return presentmentFor(
		flow.adaptivePricing,
		currency ?? flow.pick.current.picked,
		flow.inView.current?.baseMoney.currency ?? flow.planCurrency,
	);
}

export async function requestQuote(
	flow: QuoteFlow,
	address: Address | null,
	promoCode: string | null,
	currency?: string,
): Promise<PageQuote> {
	const presentment = presentmentOf(flow, currency);
	const outcome = await flow.quote({ address, promoCode, presentment });
	if ("refusal" in outcome) throw new RefusedError(outcome.refusal);
	return {
		...outcome.quote,
		addressKey: addressKey(address),
		presentment,
		promoAsked: promoCode,
		deadline: Date.now() + outcome.quote.lifetimeMs,
	};
}

async function refresh(
	flow: QuoteFlow,
	address: Address | null,
): Promise<PageQuote | null> {
	const ticket = flow.requests.start();
	try {
		const next = await requestQuote(flow, address, flow.promo.current);
		if (!flow.requests.isNewest(ticket)) return null;
		flow.inView.current = next;
		flow.land(next);
		return next;
	} catch (failure) {
		if (!flow.requests.isNewest(ticket)) return null;
		throw failure;
	} finally {
		flow.requests.finish(ticket);
	}
}

function settlePick(flow: QuoteFlow) {
	if (flow.requests.running() > 0) return;
	const inView = flow.inView.current;
	if (!pickPending(flow.adaptivePricing, flow.pick.current.picked, inView)) {
		return;
	}
	flow.pick.current = { ...flow.pick.current, picked: pickOf(inView) };
}

async function refreshSettling(
	flow: QuoteFlow,
	address: Address | null,
	keepingOrder: boolean,
): Promise<PageQuote | null> {
	try {
		try {
			const landed = await refresh(flow, address);
			if (keepingOrder && landed) dropUnappliedPromo(flow, landed);
			return landed;
		} catch (failure) {
			if (!keepingOrder || !isRefusedPromo(flow.promo.current, failure)) {
				throw failure;
			}
			flow.dropPromo(failure);
			return await refresh(flow, address);
		}
	} finally {
		settlePick(flow);
	}
}

export function refreshQuote(
	flow: QuoteFlow,
	address: Address | null = flow.delivery(),
): Promise<PageQuote | null> {
	return refreshSettling(flow, address, false);
}

export function refreshQuoteKeepingOrder(
	flow: QuoteFlow,
	address: Address | null = flow.delivery(),
): Promise<PageQuote | null> {
	return refreshSettling(flow, address, true);
}

export function showQuote(flow: QuoteFlow, shown: PageQuote) {
	flow.requests.supersede();
	flow.inView.current = shown;
	flow.land(shown);
}

// A product page's opening quotes, kept in the tab while Whop holds each, so a
// return to a variant, or a toggle back to it, isn't quoted again.
export type OpeningQuotes = ExpiringMap<PageQuote>;

export const OPENING_QUOTES_KEPT = 50;

export function createOpeningQuotes(): OpeningQuotes {
	return createExpiringMap(OPENING_QUOTES_KEPT);
}

export function keepOpeningQuote(
	quotes: OpeningQuotes,
	key: string,
	quote: PageQuote,
) {
	quotes.set(key, quote, quote.deadline - PAYABLE_MARGIN_MS);
}

function openOn(flow: QuoteFlow, opened: PageQuote): PageQuote {
	showQuote(flow, opened);
	dropUnappliedPromo(flow, opened);
	settlePick(flow);
	return opened;
}

// Only an opening quote for the code the link asked for, with its tax worked
// out or still to come from an address, is kept. A quote handed over from the
// cart or a product page (`handed`, read again on the server) opens the order
// in its place; one that doesn't pass, or a read that fails, quotes it anew.
export async function openingQuoteFor(
	flow: QuoteFlow,
	address: Address | null,
	kept?: { quotes: OpeningQuotes; orderKey: string; now: number },
	handed?: () => Promise<PageQuote | null>,
): Promise<PageQuote | null> {
	if (!address && handed) {
		const opened = await handed().catch(() => null);
		if (opened) return openOn(flow, opened);
	}
	if (!kept || address) return refreshQuoteKeepingOrder(flow, address);
	const promoCode = flow.promo.current;
	const key = JSON.stringify([kept.orderKey, promoCode, presentmentOf(flow)]);
	const held = kept.quotes.get(key, kept.now);
	if (held) return openOn(flow, held);
	const first = await refreshQuoteKeepingOrder(flow, null);
	if (first && first.promoAsked === promoCode && !taxFailed(first)) {
		keepOpeningQuote(kept.quotes, key, first);
	}
	return first;
}

// A refusal is judged by the code its own request sent, as an overlapping one
// may already have dropped it. The page's own quote still shows the dropped
// code, so it is priced again too, once.
export async function requestQuoteKeepingOrder(
	flow: QuoteFlow,
	address: Address | null,
	promoCode: string | null,
	currency?: string,
): Promise<PageQuote> {
	try {
		return await requestQuote(flow, address, promoCode, currency);
	} catch (failure) {
		if (!isRefusedPromo(promoCode, failure)) throw failure;
		if (flow.promo.current === promoCode) {
			flow.dropPromo(failure);
			// Best effort: a refresh that fails leaves the page's retry to the buyer.
			if (flow.inView.current) void refreshQuote(flow).catch(() => null);
		}
		return requestQuote(flow, address, null, currency);
	}
}

export function pickCurrency(
	flow: QuoteFlow,
	code: string,
): Promise<{ failure: unknown } | null> {
	return runPick(
		flow.pick,
		code,
		() => refreshQuoteKeepingOrder(flow),
		() => flow.inView.current,
	);
}

export function quoteRefused(failure: unknown): failure is RefusedError {
	return failure instanceof RefusedError && definite(failure);
}

export function quoteFailure<T, U>(
	failure: unknown,
	fallbacks: { transient: T; unplaced: U; refused?: string },
): T | U | string {
	if (!quoteRefused(failure)) return fallbacks.transient;
	if (failure.code === LOCATION_REQUIRED_CODE) return fallbacks.unplaced;
	return refusalMessage(failure, fallbacks.refused ?? ORDER_REFUSED);
}

export type PromoOutcome =
	| { applied: true }
	| { applied: false; awaitingAddress: true }
	| { applied: false; promoError: string | null; quoteError: string | null };

// What a failed quote that asked for a promo code means for the code, one rule
// for a code the buyer applies (`applyPromoCode`) and a link's code on the
// opening quote (`openingQuoteFailure`). Whop refusing the code, or the whole
// order, takes the code off, back to the one in view; Whop needing the buyer's
// address keeps it for the address quote. A quote Whop didn't answer says
// nothing about the code, so `unanswered` leaves it as it was.
export type PromoFailure =
	| { awaitingAddress: true }
	| { unanswered: true }
	| { promoError: string | null; quoteError: string | null };

export function promoFailure(flow: QuoteFlow, failure: unknown): PromoFailure {
	if (promoRefused(failure)) {
		flow.promo.current = flow.inView.current?.promoCode ?? null;
		return { promoError: promoMessage(failure), quoteError: null };
	}
	if (!quoteRefused(failure)) return { unanswered: true };
	if (failure.code === LOCATION_REQUIRED_CODE) return { awaitingAddress: true };
	flow.promo.current = flow.inView.current?.promoCode ?? null;
	return {
		promoError: null,
		quoteError: refusalMessage(failure, ORDER_REFUSED),
	};
}

// What the page shows when the opening quote fails, by `promoFailure`'s rule
// for the link's code (if any), so a code is never shown applied beside a
// full-price total. A code taken off goes back in the promo box (`draft`). One
// Whop didn't answer for stays the order's, as the link asked, and is noted
// as waiting (`awaiting`) for the next quote, which asks for it: the product
// page has no promo box, and its wallets price and charge with the code. No
// error shows for it: the next quote (the address's, a wallet's) asks again.
export type OpeningFailure = {
	quoteError: string | null;
	promoError: string | null;
	draft: string | null;
	awaiting: PromoAwaiting | null;
};

export function openingQuoteFailure(
	flow: QuoteFlow,
	failure: unknown,
): OpeningFailure {
	const code = flow.promo.current;
	const failed = promoFailure(flow, failure);
	const none = { quoteError: null, promoError: null, draft: null };
	if ("unanswered" in failed) {
		return { ...none, awaiting: code ? { code, until: "answer" } : null };
	}
	if ("awaitingAddress" in failed) {
		return { ...none, awaiting: code ? { code, until: "address" } : null };
	}
	return {
		...failed,
		draft: code !== flow.promo.current ? code : null,
		awaiting: null,
	};
}

// A blank code (Enter in an empty box) asks for nothing, so no quote is spent.
export async function applyPromoCode(
	flow: QuoteFlow,
	code: string | null,
): Promise<PromoOutcome> {
	if (code !== null && code.trim() === "") {
		return { applied: false, promoError: null, quoteError: null };
	}
	flow.promo.current = code;
	try {
		const own = await refreshQuote(flow);
		if (!own) await flow.requests.idle();
		const landed = own ?? flow.inView.current;
		if (landed?.promoAsked !== code) {
			// A request that kept the order overtook this one and dropped the code
			// as refused (`dropPromo`): that refusal is the buyer's answer.
			const dropped =
				code !== null &&
				flow.promo.current === null &&
				landed?.promoAsked === null;
			flow.promo.current = flow.inView.current?.promoCode ?? null;
			return {
				applied: false,
				promoError: null,
				quoteError: dropped ? null : QUOTE_UNAVAILABLE,
			};
		}
		if (code !== null && landed.promoCode !== code) {
			flow.promo.current = null;
			return {
				applied: false,
				promoError: PROMO_NOT_APPLIED,
				quoteError: null,
			};
		}
		return { applied: true };
	} catch (failure) {
		const failed = promoFailure(flow, failure);
		if (!("unanswered" in failed)) return { applied: false, ...failed };
		// The code the buyer typed stays in the box, to apply again.
		flow.promo.current = flow.inView.current?.promoCode ?? null;
		return { applied: false, promoError: null, quoteError: QUOTE_UNAVAILABLE };
	}
}

// The buyer's own Remove. The code is let go (`forget`) before the quote is
// asked, so no answer (one waiting on the address, or none) brings it back.
export function removePromoCode(
	flow: QuoteFlow,
	forget: (code: string) => void,
): Promise<PromoOutcome> {
	const removed = flow.promo.current;
	if (removed) forget(removed);
	return applyPromoCode(flow, null);
}

export type Unchargeable = (
	quote: PageQuote,
	address: Address,
) => string | null;

// A quote located by IP is only an estimate, and one a payment already holds
// (even a declined one) can't be charged again.
export function unchargeableQuote(
	candidate: PageQuote,
	address: Address,
	state: {
		promo: string | null;
		presentment: string | undefined;
		spent: ReadonlySet<string>;
		now: number;
	},
): string | null {
	if (candidate.estimated) return ADDRESS_UNPLACED;
	if (candidate.taxStatus === "unavailable") return TAX_UNAVAILABLE;
	if (candidate.promoCode !== state.promo) {
		return state.promo ? PROMO_NOT_APPLIED : ORDER_CHANGED;
	}
	if (candidate.presentment !== state.presentment) return CURRENCY_REFUSED;
	const stale =
		state.spent.has(candidate.id) ||
		candidate.addressKey !== addressKey(address) ||
		candidate.deadline - state.now <= PAYABLE_MARGIN_MS;
	return stale ? ORDER_CHANGED : null;
}

async function freshQuoteFor(
	flow: QuoteFlow,
	address: Address,
	unchargeable: Unchargeable,
): Promise<PageQuote | null> {
	for (let ask = 0; ask < 2; ask += 1) {
		const asked = await refreshQuoteKeepingOrder(flow, address);
		if (asked) return asked;
		await flow.requests.idle();
		const landed = flow.inView.current;
		if (landed && unchargeable(landed, address) === null) return landed;
	}
	return null;
}

// A fresh quote stops the charge whenever its total isn't the one the buyer
// saw: the quote in view's, or with none the listed prices'.
export async function quoteToPay(
	flow: QuoteFlow,
	address: Address,
	unchargeable: Unchargeable,
): Promise<PageQuote> {
	const current = flow.inView.current;
	if (current && unchargeable(current, address) === null) return current;
	const next = await freshQuoteFor(flow, address, unchargeable).catch(
		(failure: unknown) => {
			throw new BuyerError(
				quoteFailure(failure, {
					transient: QUOTE_UNAVAILABLE,
					unplaced: ADDRESS_UNPLACED,
				}),
			);
		},
	);
	if (!next) throw new BuyerError(ORDER_CHANGED);
	const refused = unchargeable(next, address);
	if (refused) throw new BuyerError(refused, taxFailed(next));
	const repriced = repricedMessage(
		next,
		current
			? { total: current.total, currency: current.money.currency }
			: flow.listed,
	);
	if (repriced) throw new BuyerError(repriced, taxFailed(next));
	return next;
}

// The buyer's Try again. A refusal is the address's, as an address quote's
// is (`refusedKey`), so the page's own retries don't ask it again.
export async function retryPricing(
	flow: QuoteFlow,
): Promise<{ message: string | null; refusedKey: string | null } | null> {
	const address = flow.delivery();
	try {
		await refreshQuoteKeepingOrder(flow, address);
		return null;
	} catch (failure) {
		return {
			message: quoteFailure(failure, {
				transient: QUOTE_UNAVAILABLE,
				unplaced: null,
			}),
			refusedKey: quoteRefused(failure) ? addressKey(address) : null,
		};
	}
}

export async function priceDelivery(
	flow: QuoteFlow,
): Promise<{ message: string; refused: boolean } | null> {
	const address = flow.delivery();
	const asked = addressKey(address);
	try {
		await refreshQuoteKeepingOrder(flow, address);
		return null;
	} catch (failure) {
		if (addressKey(flow.delivery()) !== asked) return null;
		return {
			message: quoteFailure(failure, {
				transient: PRICING_RETRYING,
				unplaced: ADDRESS_UNPLACED,
			}),
			refused: quoteRefused(failure),
		};
	}
}
