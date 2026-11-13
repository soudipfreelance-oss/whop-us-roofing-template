import type { AttemptStorage } from "./charge-attempt";
import { type MoneyFormat, type PageQuote, type Quote } from "./order";
import { AUTO, presentmentOfInput, storePick } from "./presentment";
import { isRecord } from "./shared";
import { readStored, readStoredList, writeStored } from "./stored";

// With adaptive pricing, a product page's opening quote and the cart's quote
// are kept in the tab by their order's key (`orderKeyOf`), never in a URL: the
// cart shows its quote again, and the checkout of that order opens on it once
// the server has read it again (`readHandedQuote`), rather than making
// another. Whether it is still good is the server's to say, from Whop's own
// `expires_at` and its own clock: the tab lets a quote go only when that read
// refuses it (`dropHandedQuote`). Only a quote made with no address is handed
// over, so the checkout's address quote runs as it always does.
const HANDED_QUOTES_KEY = "storefront-handed-quotes";
const HANDED_KEPT = 20;

// `presentment` is what the quote asked for, null for the plans' own currency
// however it was asked (`presentmentFor`). The rest is what the cart shows.
export type HandedQuote = {
	order: string;
	id: string;
	promoAsked: string | null;
	presentment: string | null;
	money: MoneyFormat;
	subtotal: number;
	lines: Array<{ planId: string | null; subtotal: number }>;
};

function isMoneyFormat(value: unknown): value is MoneyFormat {
	return (
		isRecord(value) &&
		typeof value.currency === "string" &&
		typeof value.decimals === "number" &&
		typeof value.displayDecimals === "number"
	);
}

function isHandedLine(
	value: unknown,
): value is { planId: string | null; subtotal: number } {
	return (
		isRecord(value) &&
		(typeof value.planId === "string" || value.planId === null) &&
		typeof value.subtotal === "number"
	);
}

function isHandedQuote(value: unknown): value is HandedQuote {
	return (
		isRecord(value) &&
		typeof value.order === "string" &&
		typeof value.id === "string" &&
		(typeof value.promoAsked === "string" || value.promoAsked === null) &&
		(typeof value.presentment === "string" || value.presentment === null) &&
		isMoneyFormat(value.money) &&
		typeof value.subtotal === "number" &&
		Array.isArray(value.lines) &&
		value.lines.every(isHandedLine)
	);
}

export function askedPresentment(quote: PageQuote): string | null {
	const asked = quote.presentment ?? null;
	return asked === quote.baseMoney.currency ? null : asked;
}

export function handOverQuote(
	storage: () => AttemptStorage,
	order: string,
	quote: PageQuote,
) {
	if (quote.addressKey !== null) return;
	const handed: HandedQuote = {
		order,
		id: quote.id,
		promoAsked: quote.promoAsked,
		presentment: askedPresentment(quote),
		money: quote.money,
		subtotal: quote.subtotal,
		lines: quote.lines,
	};
	const others = readStoredList(storage, HANDED_QUOTES_KEY, isHandedQuote)
		.filter((entry) => entry.order !== order)
		.slice(1 - HANDED_KEPT);
	writeStored(storage, HANDED_QUOTES_KEY, [...others, handed]);
}

// The quote kept for this order, asked for with the same code and currency
// (the cart, which can't know the plans' currency before its quote, may name
// it).
export function handedQuote(
	storage: () => AttemptStorage,
	order: string,
	asked: { promoCode: string | null; presentment: string | null },
): HandedQuote | null {
	return (
		readStoredList(storage, HANDED_QUOTES_KEY, isHandedQuote).find(
			(entry) =>
				entry.order === order &&
				entry.promoAsked === asked.promoCode &&
				(entry.presentment === asked.presentment ||
					(entry.presentment === null &&
						asked.presentment === entry.money.currency)),
		) ?? null
	);
}

export function dropHandedQuote(storage: () => AttemptStorage, order: string) {
	const kept = readStoredList(storage, HANDED_QUOTES_KEY, isHandedQuote);
	const others = kept.filter((entry) => entry.order !== order);
	if (others.length < kept.length) {
		writeStored(storage, HANDED_QUOTES_KEY, others);
	}
}

// The checkout's quote from a handover the server took: as a fresh quote is,
// payable until this device's clock at receipt plus what the server found left
// of its life (`lifetimeMs`).
export function openedHandedQuote(
	quote: Quote,
	asked: { promoCode: string | null; presentment: string | undefined },
	now: number,
): PageQuote {
	return {
		...quote,
		addressKey: null,
		presentment: asked.presentment,
		promoAsked: asked.promoCode,
		deadline: now + quote.lifetimeMs,
	};
}

// The buyer's pick (presentment.ts) names what the rest of the store asks
// for: the product pages' and the cart's quotes, and the prices the server
// renders (`shownPricing`). The checkout's currency toggle picks a currency,
// the store's country picker a country, and the latest replaces the other.
// Kept in a cookie (`storeCookies`), so the server reads the same pick the tab
// does.
const PICK_KEY = "storefront-pick";

export function storedPick(storage: () => AttemptStorage): string | null {
	return readStored(storage, PICK_KEY, storePick, null);
}

export function keepPick(storage: () => AttemptStorage, pick: string) {
	const kept = presentmentOfInput(pick);
	if (kept && kept !== AUTO) writeStored(storage, PICK_KEY, kept);
}

// Back to the buyer's own currency where Whop places their IP.
export function dropPick(storage: () => AttemptStorage) {
	try {
		storage().removeItem(PICK_KEY);
	} catch {
		// Blocked storage held no pick to drop.
	}
}
