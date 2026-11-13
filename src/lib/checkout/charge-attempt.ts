import { readStored, readStoredList, writeStored } from "./stored";
import { isRecord } from "./shared";
import {
	type Address,
	addressOf,
	cartKeyOf,
	type Order,
	type OrderItem,
	type OrderOrigin,
	orderKeyOf,
	orderTag,
} from "./order";
import {
	emptyCartOnce,
	markOrderPayment,
	marksPayment,
	type OrderLocks,
	type OrderMark,
	returnTokenKept,
} from "./order-marks";
import {
	classifyPayment,
	type PaymentState,
	releasesAttempt,
	waitsOnThisTab,
	learnedState,
} from "./payment-state";

export type Refusal = {
	code: string | null;
	message: string;
	status: number | null;
};

export const NOT_SENT_CODE = "charge_not_sent";
// The store's own server can't read its configuration (its account, the URL
// the call came in on), so no charge left it.
export const STORE_UNAVAILABLE_CODE = "store_unavailable";
// The page was built under settings the server no longer has
// (`settingsFingerprint`): nothing was asked of Whop.
export const STORE_UPDATED_CODE = "store_updated";
// A line the sale check refuses: gone, or short of stock.
export const ITEMS_REFUSED_CODE = "order_items_refused";

// Whop answered and refused, or the charge never left. A timeout, a dropped
// connection, a 5xx, a 408, a 429 or a 409 `idempotency_request_in_progress`
// leaves open whether the charge went through.
export function definite(refusal: Refusal): boolean {
	if (refusal.code === NOT_SENT_CODE) return true;
	if (refusal.code === STORE_UNAVAILABLE_CODE) return true;
	if (refusal.code === STORE_UPDATED_CODE) return true;
	const { status } = refusal;
	return (
		status !== null &&
		status >= 400 &&
		status < 500 &&
		status !== 408 &&
		status !== 429 &&
		refusal.code !== IN_PROGRESS_CODE
	);
}

// Another send under the same key is still running at Whop.
export const IN_PROGRESS_CODE = "idempotency_request_in_progress";
export const QUOTE_IN_USE_CODE = "quote_in_use";
export const TAX_UNAVAILABLE_CODE = "quote_tax_unavailable";
export const PROMO_REFUSED_CODE = "promo_invalid";

// Whop can't quote a seller who collects tax until it can place the buyer, by
// address or public IP. A server run locally has no public IP, so the checkout
// waits for the address.
export const LOCATION_REQUIRED_CODE = "quote_location_required";

// Every send is built from the same stored inputs, so this answer means the
// attempt itself is wrong, and the page stops rather than guess.
export const KEY_MISMATCH_CODE = "idempotency_key_mismatch";

export function keyMismatch(refusal: Refusal): boolean {
	return refusal.code === KEY_MISMATCH_CODE;
}

// Its `status`, the receipt's, is never read: the payment's state is Whop's
// lifecycle (`PaymentState`).
export type ChargedPayment = {
	id: string;
	clientSecret: string | null;
};

// Whop runs a key once: resent with the same body, it answers with the first
// send's outcome (a 409 while that send still runs), so resending never charges
// twice.
export type ChargeInputs = {
	accountId: string;
	quoteId: string;
	confirmationToken: string;
	shippingAddress: Address;
	returnUrl: string;
	affiliateCode?: string;
	termsAccepted?: true;
};

// Only `inputs` is sent. `clientSecret` continues the payment's next step from
// this tab and is never read back from the server.
export type ChargeAttempt = {
	key: string;
	inputs: ChargeInputs;
	origin: OrderOrigin;
	orderKey: string;
	page?: string;
	total: number;
	currency: string;
	paymentId?: string;
	clientSecret?: string;
	step?: string;
};

export type QuotePayment = {
	id: string;
	state: PaymentState;
};

// `gone` is a quote Whop no longer has, which proves nothing about a payment
// made from it.
export type QuoteReading = { payment: QuotePayment | null } | { gone: true };

// The order-complete page reads the payment again on the server; these params
// only say which payment to look up, never what happened to it.
export function completionUrl(
	returnTo: string,
	paymentId: string,
	status: string,
): string {
	const url = new URL(returnTo);
	url.searchParams.set("payment_id", paymentId);
	if (status) url.searchParams.set("status", status);
	return url.toString();
}

// The order-complete page opened to look at an order (the store's own View
// your order link), never Whop's return from paying it: built from a return
// URL with no return token, it only shows the order, and a cart filled again
// with the same lines stays.
export function orderViewUrl(returnTo: string, paymentId: string): string {
	return completionUrl(returnTo, paymentId, "");
}

// Kept until the order-complete page sees the payment's outcome, so a reload or
// a trip back to the store settles the attempt before anything new is charged.
export const ATTEMPT_STORAGE_KEY = "whop-checkout-charge-attempt";

// Read on each use: blocked storage throws only once it's touched.
export type AttemptStorage = {
	getItem: (key: string) => string | null;
	setItem: (key: string, value: string) => void;
	removeItem: (key: string) => void;
};

function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === "string";
}

function isAddress(value: unknown): value is Address {
	return addressOf(value) !== null;
}

function isChargeInputs(value: unknown): value is ChargeInputs {
	return (
		isRecord(value) &&
		typeof value.accountId === "string" &&
		typeof value.quoteId === "string" &&
		typeof value.confirmationToken === "string" &&
		isAddress(value.shippingAddress) &&
		typeof value.returnUrl === "string" &&
		optionalString(value.affiliateCode) &&
		(value.termsAccepted === undefined || value.termsAccepted === true)
	);
}

const ORIGINS = new Set<unknown>(["cart", "link", "express"]);

function isOrigin(value: unknown): value is OrderOrigin {
	return ORIGINS.has(value);
}

export function isChargeAttempt(value: unknown): value is ChargeAttempt {
	return (
		isRecord(value) &&
		typeof value.key === "string" &&
		isChargeInputs(value.inputs) &&
		isOrigin(value.origin) &&
		typeof value.orderKey === "string" &&
		optionalString(value.page) &&
		optionalString(value.paymentId) &&
		optionalString(value.clientSecret) &&
		optionalString(value.step) &&
		typeof value.total === "number" &&
		typeof value.currency === "string"
	);
}

// Storage that is off can't say: undefined, unlike nothing stored (null).
function readAttempt(
	storage: () => AttemptStorage,
): ChargeAttempt | null | undefined {
	return readStored(
		storage,
		ATTEMPT_STORAGE_KEY,
		(value) => (isChargeAttempt(value) ? value : null),
		null,
		{ value: undefined },
	);
}

export function readStoredAttempt(
	storage: () => AttemptStorage,
): ChargeAttempt | null {
	return readAttempt(storage) ?? null;
}

// The payments this tab's own checkout made, written as each attempt learns
// its payment, so the order-complete page can tell this tab's own payment from
// a link to the same order, whichever way the attempt was let go. An entry
// goes only once its own payment is paid; a declined or canceled payment the
// store can still retry, or a payment still clearing, keeps it.
const OWN_PAYMENTS_KEY = "whop-checkout-own-payments";
const OWN_PAYMENTS_KEPT = 10;

type OwnPayment = { paymentId: string; origin: OrderOrigin; orderKey: string };

function isOwnPayment(value: unknown): value is OwnPayment {
	return (
		isRecord(value) &&
		typeof value.paymentId === "string" &&
		isOrigin(value.origin) &&
		typeof value.orderKey === "string"
	);
}

function ownPayments(storage: () => AttemptStorage): OwnPayment[] {
	return readStoredList(storage, OWN_PAYMENTS_KEY, isOwnPayment);
}

function rememberOwnPayment(
	attempt: ChargeAttempt,
	storage: () => AttemptStorage,
) {
	const { paymentId, origin, orderKey } = attempt;
	if (!paymentId) return;
	const kept = ownPayments(storage);
	if (kept.some((own) => own.paymentId === paymentId)) return;
	// Storage can be off; the order-complete page then leaves the cart.
	writeStored(
		storage,
		OWN_PAYMENTS_KEY,
		[...kept, { paymentId, origin, orderKey }].slice(-OWN_PAYMENTS_KEPT),
	);
}

function ownPayment(
	paymentId: string,
	storage: () => AttemptStorage,
): OwnPayment | null {
	return (
		ownPayments(storage).find((own) => own.paymentId === paymentId) ?? null
	);
}

function forgetOwnPayment(paymentId: string, storage: () => AttemptStorage) {
	const kept = ownPayments(storage);
	const others = kept.filter((own) => own.paymentId !== paymentId);
	if (others.length !== kept.length) {
		writeStored(storage, OWN_PAYMENTS_KEY, others);
	}
}

// True only once the attempt reads back as written: a browser can drop a
// write without throwing, and an attempt that isn't stored can't be sent again
// with its key, so it is never sent at all (charge-flow.ts `payQuote`).
export function storeAttempt(
	attempt: ChargeAttempt | null,
	storage: () => AttemptStorage,
): boolean {
	try {
		if (!attempt) {
			storage().removeItem(ATTEMPT_STORAGE_KEY);
			return true;
		}
		const written = JSON.stringify(attempt);
		storage().setItem(ATTEMPT_STORAGE_KEY, written);
		return storage().getItem(ATTEMPT_STORAGE_KEY) === written;
	} catch {
		// Storage that throws keeps nothing: the caller sends nothing.
		return false;
	}
}

// A page the browser restores from its cache reads storage again: the
// order-complete page may have let go of the attempt, and resending it would
// replay a charge that already has its outcome.
export type AttemptHolder = {
	load: () => ChargeAttempt | null;
	restore: () => ChargeAttempt | null;
	current: () => ChargeAttempt | null;
	record: (attempt: ChargeAttempt) => boolean;
	forget: (key: string) => boolean;
};

export function createAttemptHolder(
	storage: () => AttemptStorage,
): AttemptHolder {
	let current: ChargeAttempt | null = null;
	let loaded = false;
	return {
		load: () => {
			if (!loaded) {
				current = readStoredAttempt(storage);
				loaded = true;
			}
			return current;
		},
		restore: () => {
			const stored = readAttempt(storage);
			if (stored !== undefined) current = stored;
			loaded = true;
			return current;
		},
		current: () => current,
		record: (attempt) => {
			current = attempt;
			const stored = storeAttempt(attempt, storage);
			rememberOwnPayment(attempt, storage);
			return stored;
		},
		forget: (key) => {
			if (current?.key !== key) return false;
			current = null;
			storeAttempt(null, storage);
			return true;
		},
	};
}

// Any page restored from the browser's cache is given back, whether it left
// for another page or the buyer went back mid-charge. A run the cache froze
// may resume beside the next click, so the restore starts a new generation and
// that run stops (charge-flow.ts `ChargeRun`); the stored attempt is the next
// click's to send again.
export function restoredFromCache(tab: {
	holder: AttemptHolder;
	inFlight: { current: boolean };
	leaving: { current: boolean };
	generation: { current: number };
}): { stored: boolean } {
	const stored = tab.holder.restore() !== null;
	tab.generation.current += 1;
	tab.leaving.current = false;
	tab.inFlight.current = false;
	return { stored };
}

export function releaseStoredAttempt(
	paymentId: string,
	storage: () => AttemptStorage,
) {
	if (readStoredAttempt(storage)?.paymentId === paymentId) {
		storeAttempt(null, storage);
	}
}

// The cart loads from storage only after the root layout mounts, which is after
// this page's own effects.
export type StoredCart = {
	hasHydrated: () => boolean;
	onFinishHydration: (run: () => void) => () => void;
	// zustand never finishes a load that fails (`persist`'s rehydrate catches
	// the error and calls back with it, but no finish listener), so a failure
	// is heard on its own (`onCartUnreadable`).
	onHydrationFailed: (run: () => void) => () => void;
	lines: () => readonly OrderItem[];
	clear: () => void;
};

// How long the order-complete page waits on the saved cart before settling
// without it: the cart loads from storage after the root layout mounts.
export const CART_WAIT_MS = 3_000;

// The URL is the buyer's to edit, so its tag only counts when it names exactly
// the lines Whop says the payment bought.
export function verifiedOrderTag(
	tag: string | null,
	lines: readonly OrderItem[],
): string | null {
	if (!tag || lines.length === 0) return null;
	const origin = tag.slice(0, tag.indexOf("-"));
	if (!isOrigin(origin)) return null;
	return tag === orderTag(origin, cartKeyOf(lines)) ? tag : null;
}

export function cartOrder(
	tag: string | null,
	lines: readonly OrderItem[],
): boolean {
	return verifiedOrderTag(tag, lines)?.startsWith("cart-") === true;
}

// Never decided by the URL alone, which anyone can write: only this tab's own
// payment, or Whop's return carrying a return token this browser kept when
// the charge started (`keepReturnToken`), empties the cart or marks the order.
// A link to the payment with no token of this browser's (another browser's
// return, a crafted link) only shows the order, apart from moving on a mark
// this browser already holds for that payment.
export function settleOrderPage(input: {
	paymentId: string;
	state: PaymentState;
	lines: readonly OrderItem[];
	order: string | null;
	// The return URL's RETURN_TOKEN_PARAM, if any.
	returnToken?: string | null;
	storage: () => AttemptStorage;
	markStorage: () => AttemptStorage;
	locks: OrderLocks | null;
	cart: StoredCart;
	now?: number;
}): () => void {
	const { paymentId, storage, cart } = input;
	const state = learnedState(input.state);
	const done = releasesAttempt(classifyPayment(input.state));
	const settle = (cartLines: readonly OrderItem[]) => {
		const now = input.now ?? Date.now();
		const attempt = readStoredAttempt(storage);
		const own =
			attempt?.paymentId === paymentId
				? attempt
				: ownPayment(paymentId, storage);
		const returned = returnTokenKept(
			input.returnToken ?? null,
			input.markStorage,
			now,
		);
		const order = own
			? orderTag(own.origin, own.orderKey)
			: verifiedOrderTag(input.order, input.lines);
		// A mark this browser already holds for this payment (the View your
		// order link opened from it) is moved on as the payment settles; no
		// link creates one.
		if (
			!own &&
			!returned &&
			!(order && marksPayment(order, paymentId, input.markStorage, now))
		) {
			return;
		}
		// The payment this tab's own cart checkout made empties the cart, and so
		// does Whop's return to a tab of this browser that holds none of it (a
		// bank app opening a new one), only once in this browser
		// (`emptyCartOnce`): a reload or a return opened again leaves a cart
		// filled again with the same lines.
		if (
			state === "paid" &&
			(own ? own.origin === "cart" : returned) &&
			order === orderTag("cart", cartKeyOf(cartLines))
		) {
			void emptyCartOnce(
				paymentId,
				() => cart.clear(),
				input.markStorage,
				input.locks,
				now,
			);
		}
		if (state === "paid") forgetOwnPayment(paymentId, storage);
		if (!order) return;
		void markOrderPayment(
			order,
			paymentId,
			state,
			input.markStorage,
			input.locks,
		).then((marked) => {
			if (done && marked) releaseStoredAttempt(paymentId, storage);
		});
	};
	if (cart.hasHydrated()) {
		settle(cart.lines());
		return () => {};
	}
	// Settled once, on whichever comes first: the cart loading, its load
	// failing, or the wait running out. A cart that didn't load counts as
	// empty, so nothing is emptied, and the order is still marked and the
	// attempt let go.
	let open = true;
	const stops: Array<() => void> = [];
	const finish = (cartLines: readonly OrderItem[]) => {
		if (!open) return;
		open = false;
		for (const stop of stops) stop();
		settle(cartLines);
	};
	const timer = setTimeout(() => finish([]), CART_WAIT_MS);
	stops.push(
		() => clearTimeout(timer),
		cart.onFinishHydration(() => finish(cart.lines())),
		cart.onHydrationFailed(() => finish([])),
	);
	return () => {
		open = false;
		for (const stop of stops) stop();
	};
}

function attemptFor(attempt: ChargeAttempt, order: Order): boolean {
	return (
		attempt.origin === order.origin && attempt.orderKey === orderKeyOf(order)
	);
}

export function attemptPlace(
	attempt: ChargeAttempt,
	order: Order,
	here: string,
): { href: string | null } | null {
	if (attemptFor(attempt, order)) return null;
	return { href: attempt.page && attempt.page !== here ? attempt.page : null };
}

// A tab holding this order's attempt shows the control that sends it again
// ("Confirm my payment"), whatever the order's mark says: the mark's note is
// for the tabs that don't hold it.
export function shownMark(
	mark: OrderMark | null,
	held: ChargeAttempt | null,
	order: Order,
): OrderMark | null {
	return held && attemptFor(held, order) ? null : mark;
}

export function followedPayment(
	read: QuotePayment,
	attempt: ChargeAttempt,
): { attempt: ChargeAttempt; payment: ChargedPayment } {
	const { clientSecret: _, ...rest } = attempt;
	const secret =
		attempt.paymentId === read.id ? (attempt.clientSecret ?? null) : null;
	return {
		attempt: {
			...rest,
			paymentId: read.id,
			...(secret ? { clientSecret: secret } : {}),
		},
		payment: { id: read.id, clientSecret: secret },
	};
}

// A payment Whop hasn't decided, or with the buyer's step outstanding, goes on
// with this tab's secret. With none here (the answer carrying it was lost), the
// attempt is sent again under its own key and Whop replays its first answer,
// secret included.
export async function paymentToContinue(
	attempt: ChargeAttempt,
	found: QuotePayment,
	replay: () => Promise<
		{ payment: ChargedPayment } | { refusal: Refusal } | null
	>,
): Promise<{ attempt: ChargeAttempt; payment: ChargedPayment } | null> {
	const followed = followedPayment(found, attempt);
	if (
		!waitsOnThisTab(classifyPayment(found.state)) ||
		followed.payment.clientSecret
	) {
		return followed;
	}
	const answer = await replay();
	if (
		!answer ||
		!("payment" in answer) ||
		answer.payment.id !== found.id ||
		!answer.payment.clientSecret
	) {
		return null;
	}
	return {
		attempt: { ...followed.attempt, clientSecret: answer.payment.clientSecret },
		payment: answer.payment,
	};
}

export const RESEND_DELAYS_MS = [1000, 2000, 4000];

export function startOverOffered(
	stored: ChargeAttempt | null,
	elsewhere: unknown,
	unsettledKey: string | null,
): boolean {
	return stored !== null && (elsewhere !== null || unsettledKey === stored.key);
}

export function attemptPageFor(
	paymentId: string,
	storage: () => AttemptStorage,
): string | null {
	const attempt = readStoredAttempt(storage);
	return attempt?.paymentId === paymentId ? (attempt.page ?? null) : null;
}

export const STALE_QUOTE_CODES = new Set([
	"quote_expired",
	"quote_rate_expired",
	"quote_mismatch",
	"quote_preview_only",
	PROMO_REFUSED_CODE,
]);

export class RefusedError extends Error {
	readonly code: string | null;
	readonly status: number | null;

	constructor(refusal: Refusal, message = refusal.message) {
		super(message);
		this.code = refusal.code;
		this.status = refusal.status;
	}
}

export type PageVisibility = {
	visible: () => boolean;
	watch: (changed: () => void) => () => void;
};

// `ms` of time the page is shown: a timer runs only while it is, so nothing
// ticks in a hidden tab or a page that is leaving, and a page shown again picks
// the wait up where it stopped. A run gone stale ends it unmet (false); `stop`
// aborting ends it at once, so a hidden tab holds no wait nobody needs. A
// charge run goes stale only on a restore from the browser's cache, a
// `pageshow` the wait follows anyway.
export function visibleFor(
	ms: number,
	page: PageVisibility,
	live: () => boolean,
	stop?: AbortSignal,
): Promise<boolean> {
	return new Promise((resolve) => {
		let left = ms;
		let since: number | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let unwatch = () => {};
		const end = (met: boolean) => {
			clearTimeout(timer);
			unwatch();
			resolve(met);
		};
		const follow = () => {
			if (!live()) return end(false);
			if (page.visible() && since === null) {
				since = Date.now();
				timer = setTimeout(() => end(live()), left);
			} else if (!page.visible() && since !== null) {
				left -= Date.now() - since;
				since = null;
				clearTimeout(timer);
			}
		};
		if (stop?.aborted) return end(false);
		const stopped = () => end(false);
		stop?.addEventListener("abort", stopped, { once: true });
		const unwatchPage = page.watch(follow);
		unwatch = () => {
			unwatchPage();
			stop?.removeEventListener("abort", stopped);
		};
		follow();
	});
}

// Asks on each of `delays` (0: at once), first waiting it out in time the page
// is shown (`wait`, built on `visibleFor`), until an answer `settles` it. The
// settling answer, or null once a wait ends unmet (the page gone, the run
// stale) or the schedule runs out: what that means is each caller's own.
export async function retryWhileShown<T>(
	delays: Iterable<number>,
	wait: (ms: number) => Promise<boolean>,
	ask: () => Promise<T>,
	settles: (answer: T) => boolean,
): Promise<T | null> {
	for (const delay of delays) {
		if (delay > 0 && !(await wait(delay))) return null;
		const answer = await ask();
		if (settles(answer)) return answer;
	}
	return null;
}

type KeySource = Pick<Crypto, "getRandomValues"> & {
	randomUUID?: () => string;
};

// The shape newChargeKey makes, the only key a charge goes out under: without
// one, Whop has nothing to answer a resend with but a second payment.
export const CHARGE_KEY =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// randomUUID exists only in a secure context, so a store opened over plain
// HTTP on another host (a phone on the dev server) makes its UUID itself.
export function newChargeKey(source: KeySource = crypto): string {
	if (typeof source.randomUUID === "function") return source.randomUUID();
	const bytes = source.getRandomValues(new Uint8Array(16));
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
	return [
		hex.slice(0, 4),
		hex.slice(4, 6),
		hex.slice(6, 8),
		hex.slice(8, 10),
		hex.slice(10),
	]
		.map((part) => part.join(""))
		.join("-");
}
