import { SERVER_WAIT_MS } from "./deadline";
import { createLatest } from "./latest";

export type QuoteRequests = {
	start: () => number;
	isNewest: (ticket: number) => boolean;
	finish: (ticket: number) => void;
	supersede: () => void;
	current: () => number;
	running: () => number;
	idle: () => Promise<void>;
};

export function createQuoteRequests(
	onIdle: () => void,
	waitMs = SERVER_WAIT_MS,
): QuoteRequests {
	const asks = createLatest();
	const open = new Set<number>();
	let waiting: Array<() => void> = [];
	return {
		start: () => {
			const ticket = asks.next();
			open.add(ticket);
			return ticket;
		},
		isNewest: asks.isLatest,
		finish: (ticket) => {
			if (!open.delete(ticket)) return;
			if (open.size > 0) return;
			onIdle();
			for (const settle of waiting) settle();
			waiting = [];
		},
		supersede: asks.supersede,
		current: asks.current,
		running: () => open.size,
		idle: () =>
			open.size === 0
				? Promise.resolve()
				: new Promise<void>((settle) => {
						const waiter = () => {
							clearTimeout(timer);
							settle();
						};
						const timer = setTimeout(() => {
							waiting = waiting.filter((other) => other !== waiter);
							settle();
						}, waitMs);
						waiting.push(waiter);
					}),
	};
}

// A transient failure is asked again, backing off, five times at most, and
// never from a hidden tab: each ask creates a quote on the store's key. Past
// the last, the buyer's Try again, a payment, or the tab shown again asks anew.
export const ADDRESS_QUOTE_RETRIES = 5;

export function addressQuoteStalled(attempt: number): boolean {
	return attempt > ADDRESS_QUOTE_RETRIES;
}

export function addressQuoteDelay(
	attempt: number,
	hidden: boolean,
): number | null {
	if (hidden || addressQuoteStalled(attempt)) return null;
	return attempt === 0 ? 600 : Math.min(2000 * 2 ** attempt, 30_000);
}

export function payWaitsOnQuote(state: {
	deliveryQuoted: boolean;
	stalled: boolean;
}): boolean {
	return !state.deliveryQuoted && !state.stalled;
}

export function refusalAfterLanding(
	refusedKey: string | null,
	landedKey: string | null,
): string | null {
	return landedKey === refusedKey ? null : refusedKey;
}

// A quote for the address on screen clears the pricing error, whatever an
// earlier address's refusal: that refusal only stops the earlier address being
// asked again.
export function pricingErrorClears(state: {
	refusedKey: string | null;
	landedKey: string | null;
	deliveryKey: string | null;
}): boolean {
	return state.refusedKey === null || state.landedKey === state.deliveryKey;
}

export function addressNeedsQuote(state: {
	opened: boolean;
	deliveryKey: string | null;
	quotedKey: string | null | undefined;
	refusedKey: string | null;
	running: number;
}): boolean {
	return (
		state.opened &&
		state.deliveryKey !== null &&
		state.quotedKey !== state.deliveryKey &&
		state.refusedKey !== state.deliveryKey &&
		state.running === 0
	);
}
