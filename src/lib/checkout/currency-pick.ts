import type { Latest } from "./latest";
import { payInLocal, payInstead } from "./messages";
import { money, type MoneyFormat, type PageQuote, type Quote } from "./order";
import { AUTO, isCountryPick } from "./presentment";

export type CurrencyPick = { picked: string | null; picks: Latest };

export function pickOf(quote: PageQuote | null): string | null {
	if (!quote || quote.presentment === AUTO) return null;
	return quote.presentment ?? quote.baseMoney.currency;
}

// Judged by the currency the quote in view shows: a wallet sheet's quote,
// asked in the sheet's currency, lands on the page too. A country names no
// currency until Whop picks one, so only a quote asked for it settles it.
export function pickPending(
	adaptivePricing: boolean,
	picked: string | null,
	quote: PageQuote | null,
): boolean {
	if (!adaptivePricing || !quote || picked === null) return false;
	if (isCountryPick(picked)) return quote.presentment !== picked;
	return quote.money.currency !== picked;
}

export async function runPick(
	state: { current: CurrencyPick },
	code: string,
	refresh: () => Promise<unknown>,
	inView: () => PageQuote | null,
): Promise<{ failure: unknown } | null> {
	const ticket = state.current.picks.next();
	state.current = { ...state.current, picked: code };
	try {
		await refresh();
		return null;
	} catch (failure) {
		if (!state.current.picks.isLatest(ticket)) return null;
		state.current = { ...state.current, picked: pickOf(inView()) };
		return { failure };
	}
}

// `offered` is the longest list a quote has recommended, so the way back stays
// after a switch to the plans' currency, whose quote recommends only itself.
export type CurrencyToggle = {
	code: string;
	label: string;
	disabled: boolean;
	pick: () => void;
};

export function currencyToggle(
	quote: Quote | null,
	offered: readonly string[],
	controls: {
		pending: boolean;
		onPick: (code: string) => void;
	},
	format: (amount: number, format: MoneyFormat) => string = money,
): CurrencyToggle | null {
	if (!quote) return null;
	const shown = quote.money.currency;
	const base = quote.baseMoney.currency;
	const code = [...offered, ...quote.recommendedCurrencies].find(
		(candidate) => candidate !== shown,
	);
	if (!code) return null;
	return {
		code,
		label:
			code === base
				? payInstead(format(quote.baseTotal, quote.baseMoney), code)
				: payInLocal(code),
		disabled: controls.pending,
		pick: () => controls.onPick(code),
	};
}
