// What the store asks Whop to price in: `auto` (the buyer's own currency
// where Whop places their IP), a currency the buyer picked at checkout (`usd`),
// or a country they picked from the store's country picker (`JP`), which Whop
// prices in that country's currency where it has one for it, else as `auto`.
// Currencies are kept lowercase and countries uppercase, so one string carries
// any of them.
export const AUTO = "auto";

const CURRENCY = /^[a-z]{3}$/;
const COUNTRY = /^[A-Z]{2}$/;

export function isCountryPick(presentment: string | null | undefined): boolean {
	return typeof presentment === "string" && COUNTRY.test(presentment);
}

// A pick as the store keeps it, or null for anything that is none.
export function storePick(value: unknown): string | null {
	if (typeof value !== "string") return null;
	if (CURRENCY.test(value) || COUNTRY.test(value)) return value;
	return null;
}

// A presentment as a request writes it, in either case: `AUTO`, a currency, or
// a country, each in the case the store keeps it in.
export function presentmentOfInput(value: string): string | null {
	const trimmed = value.trim();
	if (trimmed.toLowerCase() === AUTO) return AUTO;
	if (/^[A-Za-z]{3}$/.test(trimmed)) return trimmed.toLowerCase();
	if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
	return null;
}

// Whop's own names for it: a country goes as `presentment_country`, which
// Whop takes in place of `presentment_currency`, never beside it.
export function presentmentParams(presentment: string | undefined): {
	presentment_currency?: string;
	presentment_country?: string;
} {
	if (presentment === undefined) return {};
	return isCountryPick(presentment)
		? { presentment_country: presentment }
		: { presentment_currency: presentment };
}
