import type { AttemptStorage } from "./charge-attempt";
import { sleep } from "./deadline";
import { landingLinkInputs } from "./link-codes";
import {
	type Amount,
	cartKeyOf,
	mergeItems,
	type OrderItem,
	type PageQuote,
} from "./order";
import { AUTO } from "./presentment";
import {
	storedPick,
	type HandedQuote,
	handedQuote,
	handOverQuote,
} from "./quote-handover";

// Typing a quantity changes the cart on every keystroke: it is quoted once the
// changes settle.
export const CART_QUOTE_WAIT_MS = 400;

export type CartQuoteRequest = {
	items: OrderItem[];
	promoCode: string | null;
	presentment: string;
};

// With adaptive pricing the cart drawer shows its lines and subtotal from a
// quote of the cart, asked for as its checkout will ask: the code the checkout
// would apply, for the store's pick (`storedPick`, a currency or a country kept in
// `picks`), else the buyer's own (`auto`). A cart with a kept quote (quote-handover.ts) asks nothing, and the
// quote it gets is handed over to its checkout. `shown` gets
// null while there is none: an empty cart, a quote still coming, or one that
// failed.
export function createCartQuotes(deps: {
	storage: () => AttemptStorage;
	picks: () => AttemptStorage;
	quote: (request: CartQuoteRequest) => Promise<PageQuote | null>;
	shown: (quote: HandedQuote | null) => void;
	wait?: (ms: number) => Promise<void>;
}) {
	const wait = deps.wait ?? sleep;
	let asked = 0;
	return async (lines: readonly OrderItem[]) => {
		asked += 1;
		const ticket = asked;
		const items = mergeItems(lines);
		if (items.length === 0) {
			deps.shown(null);
			return;
		}
		const order = cartKeyOf(items);
		const promoCode =
			landingLinkInputs({}, deps.storage, order).promoCode ?? null;
		const presentment = storedPick(deps.picks) ?? AUTO;
		const asking = { promoCode, presentment };
		const kept = handedQuote(deps.storage, order, asking);
		if (kept) {
			deps.shown(kept);
			return;
		}
		deps.shown(null);
		await wait(CART_QUOTE_WAIT_MS);
		if (ticket !== asked) return;
		const quote = await deps.quote({ items, ...asking }).catch(() => null);
		if (ticket !== asked) return;
		if (quote) handOverQuote(deps.storage, order, quote);
		deps.shown(quote && handedQuote(deps.storage, order, asking));
	};
}

// The quote a drawer last got stays in its state until the next one lands, so
// a cart changed since shows none rather than that quote's prices against its
// new lines.
export function cartQuoteFor(
	quote: HandedQuote | null,
	items: readonly OrderItem[],
): HandedQuote | null {
	return quote && quote.order === cartKeyOf(items) ? quote : null;
}

export function cartLinePrice(
	quote: HandedQuote | null,
	planId: string,
): Amount | null {
	const line = quote?.lines.find((entry) => entry.planId === planId);
	return quote && line ? { units: line.subtotal, money: quote.money } : null;
}
