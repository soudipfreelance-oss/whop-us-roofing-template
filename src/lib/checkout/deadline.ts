// Left to itself the SDK waits 60 seconds on a call and retries it twice
// (@whop/sdk 2.4), past every wait the page gives the server, so each call the
// server functions make sets its own budget, below the page's.

// A wallet sheet's shipping-address answer waits on a quote, and Apple Pay
// fails the sheet itself after about 30 seconds. On the server the sale check
// gives up after 8 seconds whatever the cart's size, then the quote gets 5 and
// no SDK retries: up to 13 seconds in all (order.functions.ts).
export const QUOTE_CALLS = { timeoutInSeconds: 5, maxRetries: 0 };
export const SALE_CHECK_MS = 8_000;

// The page's resends are a charge's only retries. The server's whole charge,
// a resend's quote read included, fits in CHARGE_BUDGET_MS, so the page's wait
// (CHARGE_WAIT_MS) always outlasts it; the charge call gets what the read left,
// and less than CHARGE_LEAST_MS is no time to send one.
export const CHARGE_CALLS = { timeoutInSeconds: 25, maxRetries: 0 };
export const CHARGE_BUDGET_MS = 25_000;
export const CHARGE_LEAST_MS = 5_000;
// A payment read is two calls at most: the quote, then its payment.
export const READ_CALLS = { timeoutInSeconds: 5, maxRetries: 0 };

// A checkout's order (its lines read a few at a time, and the seller's
// documents) is ready within 10 seconds, or the page offers to try again. A
// read still running when the request ends is cut off with it (workerd), so a
// cart too big for that would fail on every try: a bigger one gets each round
// of reads at a page read's whole budget (order.handlers.ts `loadOrderMs`).
export const LOAD_ORDER_MS = 10_000;
// A read a page waits on, its tries included (whop.server.ts `PAGE_READ`).
export const PAGE_READ_MS = 5_000;
// A whole catalog listing a page's render waits on (whop.server.ts
// `CATALOG_READ`).
export const CATALOG_READ_MS = 15_000;

// The page never waits on a server function longer than these: a fetch the
// browser never settles would otherwise hold a charge at "Working…" with the
// page inert. Each covers its server budget with room for the network both
// ways.
export const SERVER_WAIT_MS = 15_000;
export const CHARGE_WAIT_MS = 30_000;

// A bank gives the buyer about 10 minutes to finish a 3D Secure challenge
// before it times out (Whop's `three_d_secure_timeout` decline), so a step the
// buyer is still taking finishes inside this. Past it, Elements is polling a
// payment Whop hasn't decided, and the page is given back.
export const NEXT_ACTION_MS = 12 * 60_000;

export class NoAnswer extends Error {
	constructor(ms: number) {
		super(`No answer within ${ms / 1000}s`);
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function within<T>(work: PromiseLike<T>, ms: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new NoAnswer(ms)), ms);
	});
	return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}
