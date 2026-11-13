import {
	CURRENCY_REFUSED,
	QUOTE_UNAVAILABLE,
	SHEET_ADDRESS_UNPRICED,
	SHEET_CURRENCY_CHANGED,
	SHIP_COUNTRY_REFUSED,
	storeUpdated,
	TAX_UNAVAILABLE,
	walletPromoRefused,
} from "./messages";
import {
	type Address,
	addressKey,
	amountDue,
	type MethodsRead,
	NO_WALLETS,
	type Order,
	type PageQuote,
	PAYABLE_MARGIN_MS,
	type PaymentMethodConfiguration,
	paymentSetupKey,
	type Quote,
	samePlace,
	taxFailed,
	walletLineItems,
} from "./order";
import { retryWhileShown } from "./charge-attempt";
import { within } from "./deadline";
import { createLatest } from "./latest";
import { quoteFailure } from "./quote-flow";
import { shipsTo } from "./settings";

export type WalletType = "apple_pay" | "google_pay" | "paypal_express";

export type WalletRow = "pending" | "shown" | "none";

// With Elements failed to load (`failed`), no wallet is coming: the row is
// gone, and a stored attempt's note checks on it instead.
export function walletRow(state: {
	methodsRead: boolean;
	offered: number;
	primed: boolean;
	shown: WalletFlags;
	failed?: boolean;
}): WalletRow {
	if (state.failed) return "none";
	if (!state.methodsRead || (state.offered > 0 && !state.primed)) {
		return "pending";
	}
	const { applePay, googlePay, payPal } = state.shown;
	return applePay || googlePay || payPal ? "shown" : "none";
}

// The product page has no promo box or price summary, so the wallet row tells
// a link's code Whop refused (in the wallet's address event, say) and a quote
// answered `store_updated`.
export function walletRowError(shown: {
	error: string | null;
	quoteError: string | null;
	promoError: string | null;
	promoDraft: string;
}): string | null {
	if (shown.error) return shown.error;
	if (storeUpdated(shown.quoteError)) return shown.quoteError;
	return shown.promoError
		? walletPromoRefused(shown.promoDraft, shown.promoError)
		: null;
}

// A product page loads Elements only once its variant offers a wallet, or for
// a stored attempt of this tab's that may need it to finish: a store whose
// plans allow no wallet never loads it there.
export function walletLoadsElements(state: {
	methods: { configuration: PaymentMethodConfiguration | null } | null;
	stored: boolean;
}): boolean {
	return (
		state.stored ||
		(state.methods !== null &&
			offeredWallets(state.methods.configuration ?? undefined).length > 0)
	);
}

// A payment request can't change its currency or setup once created; its totals
// change in place.
export function sheetKey(order: Order, currency: string): string {
	return JSON.stringify([paymentSetupKey(order), currency]);
}

export type WalletFlags = {
	applePay: boolean;
	googlePay: boolean;
	payPal: boolean;
};

const WALLET_TYPES: readonly WalletType[] = [
	"apple_pay",
	"google_pay",
	"paypal_express",
];

// As Elements judges its own sheet: by the method a wallet is the express form
// of, so PayPal's sheet by `paypal`.
const WALLET_METHODS: Record<WalletType, string> = {
	apple_pay: "apple_pay",
	google_pay: "google_pay",
	paypal_express: "paypal",
};

// The rule Elements applies to a payment method configuration, which a
// generated app can't import; a tool-server test pins the two equal.
export function passesConfiguration(
	type: string,
	configuration: PaymentMethodConfiguration | undefined,
	platformDefault?: boolean,
): boolean {
	if (!configuration) return platformDefault ?? true;
	const enabled = configuration.enabled ?? [];
	if (!(configuration.include_platform_defaults ?? true)) {
		return enabled.includes(type);
	}
	return (
		((platformDefault ?? true) &&
			!(configuration.disabled ?? []).includes(type)) ||
		enabled.includes(type)
	);
}

// Elements judges its own sheet without a platform default.
export function walletOffered(
	type: WalletType,
	configuration: PaymentMethodConfiguration | undefined,
): boolean {
	return passesConfiguration(WALLET_METHODS[type], configuration);
}

export function offeredWallets(
	configuration: PaymentMethodConfiguration | undefined,
): WalletType[] {
	return WALLET_TYPES.filter((type) => walletOffered(type, configuration));
}

export type SheetPrice = {
	amount: number;
	lineItems: ReturnType<typeof walletLineItems>;
};
export type SheetAnswer = Partial<SheetPrice> & {
	errors?: Array<{
		message: string;
		code?: "shipping_address_unserviceable";
		field?: "country";
	}>;
};

// The one rule for a quote in the sheet. A sheet's currency is fixed once it is
// built: another currency's minor units would be read as the sheet's. An
// estimate from the buyer's IP may price it at its pre-tax total, as the
// sheet's own address is priced for tax before anything is charged; a quote for
// an address whose tax couldn't be worked out never does.
export function pricesSheet(
	quote: Quote | null,
	sheetCurrency: string,
): quote is Quote {
	return (
		quote !== null &&
		quote.money.currency === sheetCurrency &&
		!taxFailed(quote)
	);
}

// `allowUntaxed` is for what the sheet opens at and follows the page at while
// closed: a quote whose tax for the page's address couldn't be worked out
// prices it at its pre-tax total, and with no quote yet the order's listed
// price does, as the sheet prices its own address before the buyer pays and
// the charge still needs a taxed quote. An answer to the sheet's own events
// never takes an untaxed one.
export function sheetPrice(
	order: Order,
	quote: Quote | null,
	sheetCurrency: string,
	rule: { allowUntaxed: boolean },
): SheetPrice | null {
	if (!quote) {
		const listed = amountDue(order, null);
		return rule.allowUntaxed && listed.currency === sheetCurrency
			? { amount: listed.amount, lineItems: walletLineItems(order, null) }
			: null;
	}
	const priced = rule.allowUntaxed
		? quote.money.currency === sheetCurrency
		: pricesSheet(quote, sheetCurrency);
	return priced
		? { amount: quote.total, lineItems: walletLineItems(order, quote) }
		: null;
}

// Only the shipping-address event refuses over the delivery address.
export function sheetAnswer(
	order: Order,
	priced: Quote,
	sheetCurrency: string,
): SheetAnswer {
	return (
		sheetPrice(order, priced, sheetCurrency, { allowUntaxed: false }) ?? {
			errors: [
				{
					message: taxFailed(priced) ? TAX_UNAVAILABLE : SHEET_CURRENCY_CHANGED,
				},
			],
		}
	);
}

export type SheetQuotes<Q> = {
	ask: () => number;
	land: (ticket: number, quote: Q | null) => boolean;
	current: () => Q | null;
};

export function createSheetQuotes<Q>(): SheetQuotes<Q> {
	const asks = createLatest();
	let current: Q | null = null;
	return {
		ask: asks.next,
		land: (ticket, quote) => {
			if (!asks.isLatest(ticket)) return false;
			current = quote;
			return true;
		},
		current: () => current,
	};
}

// The sheet waits on every ask it sends, so an overtaken one is still answered.
export async function answerAddressAsk<Q>(ask: {
	quotes: SheetQuotes<Q>;
	ticket: number;
	price: () => Promise<Q>;
	answer: (priced: Q) => void;
	updateWith: (update: SheetAnswer) => void;
}): Promise<void> {
	let priced: Q;
	try {
		priced = await ask.price();
	} catch (failure) {
		const refused: SheetAnswer = {
			errors: [
				{
					message: quoteFailure(failure, {
						transient: QUOTE_UNAVAILABLE,
						unplaced: SHEET_ADDRESS_UNPRICED,
					}),
				},
			],
		};
		ask.updateWith(ask.quotes.land(ask.ticket, null) ? refused : {});
		return;
	}
	if (ask.quotes.land(ask.ticket, priced)) ask.answer(priced);
	else ask.updateWith({});
}

// The sheet's own asks always name its currency, so the same currency is the
// same presentment.
// The sheet's redacted address is matched by place; a charge reuses a quote
// only for the very address it priced (`sameAddress`), as the card checkout's
// `addressKey` does, since tax can change within a postal code.
export function reusableWalletQuote(
	remembered: { address: Address; quote: PageQuote } | null,
	place: Address,
	promoCode: string | null,
	sheetCurrency: string,
	now: number,
	matches: (kept: Address, place: Address) => boolean = samePlace,
): PageQuote | null {
	if (!remembered) return null;
	const { quote } = remembered;
	return pricesSheet(quote, sheetCurrency) &&
		quote.promoCode === promoCode &&
		quote.deadline - now > PAYABLE_MARGIN_MS &&
		matches(remembered.address, place)
		? quote
		: null;
}

export function sameAddress(kept: Address, place: Address): boolean {
	return addressKey(kept) === addressKey(place);
}

export type WalletQuote = { address: Address; quote: PageQuote; told?: true };

// The quote a wallet charges meets the card checkout's own rules
// (`unchargeableQuote`: the buyer's promo code, the picked currency, an
// address placed for tax, its tax), and is in the sheet's currency.
export function walletQuoteRefusal(
	priced: PageQuote,
	address: Address,
	sheetCurrency: string,
	unchargeable: (quote: PageQuote, address: Address) => string | null,
): string | null {
	if (priced.money.currency !== sheetCurrency) {
		return CURRENCY_REFUSED;
	}
	return unchargeable(priced, address);
}

// The sheet shares only a redacted address until the buyer pays.
export async function answerShippingAddress(ask: {
	quotes: SheetQuotes<PageQuote>;
	place: Address | null;
	shipCountries: readonly string[];
	sheetCurrency: string;
	promoCode: string | null;
	remembered: WalletQuote | null;
	now: number;
	price: (place: Address) => Promise<PageQuote>;
	answer: (priced: PageQuote) => void;
	updateWith: (update: SheetAnswer) => void;
}): Promise<void> {
	const ticket = ask.quotes.ask();
	const { place } = ask;
	const refuse = (refused: SheetAnswer) => {
		ask.quotes.land(ticket, null);
		ask.updateWith(refused);
	};
	if (!place) {
		refuse({ errors: [{ message: SHEET_ADDRESS_UNPRICED }] });
		return;
	}
	if (!shipsTo(place.country, ask.shipCountries)) {
		refuse({
			errors: [
				{
					code: "shipping_address_unserviceable",
					field: "country",
					message: SHIP_COUNTRY_REFUSED,
				},
			],
		});
		return;
	}
	const reused = reusableWalletQuote(
		ask.remembered,
		place,
		ask.promoCode,
		ask.sheetCurrency,
		ask.now,
		(kept, shown) =>
			samePlace(kept, shown, ask.remembered?.told ? "unknown" : "empty"),
	);
	if (reused) {
		ask.quotes.land(ticket, reused);
		ask.answer(reused);
		return;
	}
	await answerAddressAsk({
		quotes: ask.quotes,
		ticket,
		price: () => ask.price(place),
		answer: (priced) => ask.answer(priced),
		updateWith: ask.updateWith,
	});
}

// A carried currency is taken only while a sheet in it stands for this order's
// setup or can be built from the plan's own price. Otherwise no currency is
// wanted until the opening quote names one, so the sheet already built (the one
// the wallets were checked on) stays: dropping it for one that can't be built
// yet would let the check go and build it again, round and round, each a new
// payment request Elements can't release.
export function sheetCurrencyFor(state: {
	adaptivePricing: boolean;
	opening: { quote: Quote | null } | null;
	quote: Quote | null;
	order: Order;
	carried?: string | null;
	probedKey?: string | null;
}): string | null {
	if (state.quote) return state.quote.money.currency;
	if (state.adaptivePricing && state.opening === null) {
		const carried = state.carried ?? null;
		if (carried === null) return null;
		const standing =
			carried === state.order.money.currency ||
			state.probedKey === sheetKey(state.order, carried);
		return standing ? carried : null;
	}
	return state.order.money.currency;
}

// A requote that prices is the wallet's own quote, kept for the total the
// buyer is told (`keep`): the page keeps its own quote, or none. A page still
// showing a code the charge dropped is priced again on its own, whether the
// requote prices or fails.
export function walletRequote<Q extends { promoCode: string | null }>(deps: {
	inView: () => Q | null;
	promoCode: () => string | null;
	refreshPage: () => Promise<unknown>;
	price: () => Promise<Q>;
	keep: (quote: Q) => void;
}): () => Promise<Q> {
	return async () => {
		try {
			const next = await deps.price();
			deps.keep(next);
			return next;
		} finally {
			const inView = deps.inView();
			if (inView?.promoCode && inView.promoCode !== deps.promoCode()) {
				// Best effort: the page's own next quote prices it otherwise.
				void deps.refreshPage().catch(() => null);
			}
		}
	};
}

// A quote that can't price the sheet, its tax not worked out, is never kept to
// answer it with: the next tap on that address asks Whop again.
// A kept quote the page retired since (the card path charged it, and the
// charge was declined) is that payment's: the wallet never offers it again.
export function liveWalletQuote(
	kept: WalletQuote | null,
	retired: (quoteId: string) => boolean,
): WalletQuote | null {
	return kept && !retired(kept.quote.id) ? kept : null;
}

export function walletQuoteToKeep(
	address: Address,
	quote: PageQuote,
	sheetCurrency: string,
): WalletQuote | null {
	return pricesSheet(quote, sheetCurrency) ? { address, quote } : null;
}

// A wallet is drawn only where Elements' canMakePayment() said yes: show()
// refuses a wallet it didn't report, and a page whose domain isn't approved for
// the account gets a no. It is asked only for the wallets the setup's
// configuration offers (`offeredWallets`) and answers no for the rest, so its
// answer for this setup is the one to draw.
export function walletAvailable(
	probed: { setup: string; ready: WalletFlags } | null,
	order: Order,
): boolean {
	if (probed?.setup !== paymentSetupKey(order)) return false;
	const { applePay, googlePay, payPal } = probed.ready;
	return applePay || googlePay || payPal;
}

// A request carried over from another order shows that order's price until
// this one's is written.
export function walletsOpenable(state: {
	primed: boolean;
	opening: { quote: Quote | null } | null;
	order: Order;
	quote: Quote | null;
	currency: string | null;
}): boolean {
	return (
		state.primed &&
		state.opening !== null &&
		state.currency !== null &&
		sheetPrice(state.order, state.quote, state.currency, {
			allowUntaxed: true,
		}) !== null
	);
}

// A request for another currency or setup would pay in what the buyer just
// left, so it is released, but only once no sheet is open: Elements refuses
// `update()` while one is, and the buyer is charged what the sheet showed.
// A probe that rejects (Elements' frame or the wallet setup not ready yet), or
// that hasn't answered within PROBE_WAIT_MS (a frame that stalled), is no
// answer. The same request is asked again, backing off to every 30 seconds,
// while the page is visible, and at once when it is shown again; the row shows
// no wallets once the first four asks have gone unanswered, until one is
// answered.
export const PROBE_RETRY_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
export const PROBE_WAIT_MS = 10_000;
const UNANSWERED_AFTER = 4;

export function createSheetRequests<
	S extends { key: string; release: () => void },
	P,
>(deps: {
	build: (key: string) => S | null;
	probe: (sheet: S) => Promise<P>;
	primed: (sheet: S, probed: P) => void;
	unprimed: () => void;
	unanswered: (sheet: S) => void;
	hidden?: () => boolean;
	retryMs?: readonly number[];
}) {
	type Entry = {
		sheet: S;
		primed: boolean;
		asks: number;
		asking: boolean;
		retry: ReturnType<typeof setTimeout> | null;
	};
	let current: Entry | null = null;
	let wanted: string | null = null;
	let open = false;
	let released = false;
	let afterClose: (() => void) | null = null;

	const ask = (entry: Entry) => {
		if (entry.retry !== null) clearTimeout(entry.retry);
		entry.retry = null;
		if (current !== entry || entry.primed || entry.asking) return;
		if (deps.hidden?.()) return;
		entry.asking = true;
		entry.asks += 1;
		within(deps.probe(entry.sheet), PROBE_WAIT_MS).then(
			(probed) => {
				entry.asking = false;
				if (current !== entry) return;
				entry.primed = true;
				deps.primed(entry.sheet, probed);
			},
			() => {
				entry.asking = false;
				if (current !== entry) return;
				if (entry.asks === UNANSWERED_AFTER) deps.unanswered(entry.sheet);
				const delays = deps.retryMs ?? PROBE_RETRY_MS;
				const delay =
					delays[Math.min(entry.asks - 1, delays.length - 1)] ?? 30_000;
				entry.retry = setTimeout(() => ask(entry), delay);
			},
		);
	};

	const drop = () => {
		if (!current) return;
		if (current.retry !== null) clearTimeout(current.retry);
		current.sheet.release();
		current = null;
	};

	const settle = () => {
		if (open || current?.sheet.key === wanted) return;
		if (current) {
			drop();
			deps.unprimed();
		}
		if (wanted === null) return;
		const sheet = deps.build(wanted);
		if (!sheet) return;
		const entry: Entry = {
			sheet,
			primed: false,
			asks: 0,
			asking: false,
			retry: null,
		};
		current = entry;
		ask(entry);
	};
	return {
		want: (key: string | null) => {
			wanted = key;
			settle();
		},
		opened: () => {
			open = true;
		},
		closed: () => {
			open = false;
			if (released) {
				released = false;
				drop();
			} else {
				settle();
			}
			const run = afterClose;
			afterClose = null;
			run?.();
		},
		shown: () => {
			if (current) ask(current);
		},
		isOpen: () => open,
		active: (): S | null =>
			current?.primed && current.sheet.key === wanted ? current.sheet : null,
		// A reload of the page's order waits for an open sheet to close, as a
		// release does: the sheet answers through its request, which taking the
		// page away would dispose.
		whenClosed: (run: () => void) => {
			if (open) afterClose = run;
			else run();
		},
		release: () => {
			afterClose = null;
			if (open) released = true;
			else drop();
		},
	};
}

// Elements' show() can throw as well as reject. Either way the sheet is closed
// again, so it is rebuilt when the page changes and its totals follow the page.
export async function openSheet<R>(steps: {
	opened: () => void;
	show: () => Promise<R>;
	closed: () => void;
}): Promise<{ result: R } | { failure: unknown }> {
	steps.opened();
	try {
		return { result: await steps.show() };
	} catch (failure) {
		return { failure };
	} finally {
		steps.closed();
	}
}

export function createMethodReads(
	read: (planId: string) => Promise<MethodsRead>,
) {
	const known = new Map<string, PaymentMethodConfiguration | null>();
	const failed = new Set<string>();
	const reading = new Map<string, Promise<void>>();
	return {
		known: (
			planId: string,
		): { configuration: PaymentMethodConfiguration | null } | null => {
			if (known.has(planId))
				return { configuration: known.get(planId) ?? null };
			return failed.has(planId) ? { configuration: NO_WALLETS } : null;
		},
		needsRead: (planId: string) => !known.has(planId),
		read: (planId: string): Promise<void> => {
			const running = reading.get(planId);
			if (running) return running;
			const settled = read(planId)
				.then(
					(answer) => {
						if ("failed" in answer) {
							failed.add(planId);
							return;
						}
						known.set(planId, answer.configuration);
						failed.delete(planId);
					},
					() => {
						failed.add(planId);
					},
				)
				.finally(() => reading.delete(planId));
			reading.set(planId, settled);
			return settled;
		},
	};
}

export type MethodReads = ReturnType<typeof createMethodReads>;

export const METHOD_RETRY_MS = [2_000, 5_000, 15_000, 30_000];

// `wait` answers false once the variant is gone; past the last wait, the next
// pick of it reads again.
export async function readMethodsWhileShown(
	reads: MethodReads,
	planId: string,
	wait: (ms: number) => Promise<boolean>,
	settled: () => void,
): Promise<void> {
	await retryWhileShown(
		[0, ...METHOD_RETRY_MS],
		wait,
		async () => {
			await reads.read(planId);
			settled();
			return !reads.needsRead(planId);
		},
		(read) => read,
	);
}
