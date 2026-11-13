import type { AttemptStorage } from "./charge-attempt";
import { NEXT_ACTION_MS } from "./deadline";
import { createExpiringMap, type ExpiringMap } from "./expiring-map";
import {
	learnedState,
	type LearnedState,
	type PaymentState,
} from "./payment-state";
import { isRecord } from "./shared";
import { readStoredList, writeStored } from "./stored";

// An order a payment was made for is marked in storage every tab of the store
// shares, so it is never charged again without the buyer asking: a charge one
// tab is still sending or finishing (`charging`, by its attempt's key, before
// Whop names a payment), Back right after paying (`paid`), a bank debit still
// clearing (`pending`), and a declined or canceled payment the store can still
// retry on its own (`declined`: Whop lets a failed or voided first payment's
// receipt be paid again). Each mark lasts only as long as it can matter: a
// charge's longest wait is a bank's step (`NEXT_ACTION_MS`), so a charging
// mark from a tab that closed mid-charge lets go soon after.
export const ORDER_MARKS_KEY = "whop-checkout-order-marks";
const ORDER_MARKS_KEPT = 20;

export type PaymentMarkState = "paid" | "pending" | "declined";
export type OrderMarkState = PaymentMarkState | "charging";

export const ORDER_MARK_MS: Record<OrderMarkState, number> = {
	charging: NEXT_ACTION_MS + 5 * 60_000,
	paid: 60 * 60_000,
	pending: 7 * 24 * 60 * 60_000,
	declined: 7 * 24 * 60 * 60_000,
};

export type OrderMark =
	| { order: string; state: "charging"; key: string; until: number }
	| {
			order: string;
			state: PaymentMarkState;
			paymentId: string;
			until: number;
	  };

export function isOrderMark(value: unknown): value is OrderMark {
	if (
		!isRecord(value) ||
		typeof value.order !== "string" ||
		typeof value.until !== "number"
	) {
		return false;
	}
	if (value.state === "charging") return typeof value.key === "string";
	return (
		typeof value.paymentId === "string" &&
		typeof value.state === "string" &&
		Object.hasOwn(ORDER_MARK_MS, value.state)
	);
}

// Room is made by `makeRoom`, which knows which marks matter longest.
// Storage that is off reads as no marks: the order is unmarked on its checkout.
function storedMarks(storage: () => AttemptStorage): ExpiringMap<OrderMark> {
	const marks = createExpiringMap<OrderMark>(Number.POSITIVE_INFINITY);
	for (const mark of readStoredList(storage, ORDER_MARKS_KEY, isOrderMark)) {
		marks.set(mark.order, mark, mark.until);
	}
	return marks;
}

function marksIn(marks: ExpiringMap<OrderMark>, now: number): OrderMark[] {
	return marks.keys(now).flatMap((order) => marks.get(order, now) ?? []);
}

// Storage can be off or full: the caller then keeps what else guards the order.
function writeOrderMarks(
	marks: ExpiringMap<OrderMark>,
	storage: () => AttemptStorage,
	now: number,
): boolean {
	return writeStored(storage, ORDER_MARKS_KEY, marksIn(marks, now));
}

export function readOrderMarks(
	storage: () => AttemptStorage,
	now = Date.now(),
): OrderMark[] {
	return marksIn(storedMarks(storage), now);
}

export function marksPayment(
	order: string,
	paymentId: string,
	storage: () => AttemptStorage,
	now = Date.now(),
): boolean {
	const mark = findOrderMark(readOrderMarks(storage, now), order, now);
	return mark !== null && "paymentId" in mark && mark.paymentId === paymentId;
}

export function findOrderMark(
	marks: readonly OrderMark[],
	order: string,
	now = Date.now(),
): OrderMark | null {
	return marks.find((mark) => mark.order === order && mark.until > now) ?? null;
}

// A list of ids kept until a time each (set-aside payments, emptied carts,
// return tokens), at most `kept` of them.
type Noted = { id: string; until: number };

function isNoted(entry: unknown): entry is Noted {
	return (
		isRecord(entry) &&
		typeof entry.id === "string" &&
		typeof entry.until === "number"
	);
}

function noted(
	storage: () => AttemptStorage,
	key: string,
	id: string,
	now: number,
): boolean {
	return readStoredList(storage, key, isNoted).some(
		(entry) => entry.id === id && entry.until > now,
	);
}

// Storage can be off or full: the note is then lost, never thrown.
function note(
	storage: () => AttemptStorage,
	key: string,
	kept: number,
	entry: Noted,
	now: number,
) {
	const others = readStoredList(storage, key, isNoted).filter(
		(other) => other.until > now && other.id !== entry.id,
	);
	writeStored(storage, key, [...others, entry].slice(-kept));
}

const SET_ASIDE_KEY = "whop-checkout-set-aside-payments";
const SET_ASIDE_KEPT = 50;

// A payment whose mark another payment replaced, or the buyer let go of, never
// marks its order pending or declined again, for as long as such an answer
// could still come.
function setAside(
	paymentId: string,
	storage: () => AttemptStorage,
	now: number,
) {
	note(
		storage,
		SET_ASIDE_KEY,
		SET_ASIDE_KEPT,
		{ id: paymentId, until: now + ORDER_MARK_MS.pending },
		now,
	);
}

const CART_EMPTIED_KEY = "whop-checkout-cart-emptied";
const CART_EMPTIED_KEPT = 20;

// A payment empties the cart at most once in this browser, for as long as its
// paid mark lasts: a reload, a restored tab or another tab's visit for it
// leaves a cart filled again since. The check, the emptying and the note run
// as one step under the marks' lock, so two tabs settling at once neither drop
// each other's note nor both empty the cart. True when this call emptied it.
export function cartEmptiedFor(
	paymentId: string,
	storage: () => AttemptStorage,
	now = Date.now(),
): boolean {
	return noted(storage, CART_EMPTIED_KEY, paymentId, now);
}

export function emptyCartOnce(
	paymentId: string,
	empty: () => void,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
	now = Date.now(),
): Promise<boolean> {
	return underMarksLock(locks, () => {
		if (cartEmptiedFor(paymentId, storage, now)) return false;
		empty();
		note(
			storage,
			CART_EMPTIED_KEY,
			CART_EMPTIED_KEPT,
			{ id: paymentId, until: now + ORDER_MARK_MS.paid },
			now,
		);
		return true;
	});
}

const RETURN_TOKENS_KEY = "whop-checkout-return-tokens";
const RETURN_TOKENS_KEPT = 20;

// A charge's return URL carries a token this browser keeps from the charge's
// start for as long as a paid mark lasts (RETURN_TOKEN_PARAM). Whop's return
// carrying one this browser kept is the buyer coming back from paying here, in
// whichever tab; a link to the payment opened anywhere else carries none of
// this browser's. Storage that is off or full keeps none: the return then only
// shows the order. The charge keeps its token with its claim (`markCharging`),
// in the one step under the marks' lock, so two tabs paying at once each keep
// their own.
export function keepReturnToken(
	token: string,
	storage: () => AttemptStorage,
	now = Date.now(),
) {
	note(
		storage,
		RETURN_TOKENS_KEY,
		RETURN_TOKENS_KEPT,
		{ id: token, until: now + ORDER_MARK_MS.paid },
		now,
	);
}

export function returnTokenKept(
	token: string | null,
	storage: () => AttemptStorage,
	now = Date.now(),
): boolean {
	return token !== null && noted(storage, RETURN_TOKENS_KEY, token, now);
}

// A mark follows its own payment's answers, and paid is terminal: pending and
// declined move to each other (Whop retrying a failed payment's receipt can
// move it onto a rail that takes days to settle) and to paid, and nothing
// follows paid, so a stale page never undoes a success. A
// paid answer from any payment replaces another payment's pending or declined
// mark. A pending or declined answer changes only its own payment's mark, or
// an order with none, and never once its payment was set aside (`setAside`),
// so a later success is never undone by an older payment's late decline.
//
// True once a mark guards the order for this answer: for paid, any paid mark,
// as paid wins; otherwise only this payment's own (another payment's pending
// mark doesn't guard this one). False leaves the caller holding the tab's
// attempt, a payment set aside since included: its next send gets this same
// payment back, never a new one.
//
// A charging mark gives way to any answer: the charge it stood for has one now,
// or another tab's did.
function markOrder(
	mark: { order: string; paymentId: string; state: PaymentMarkState },
	storage: () => AttemptStorage,
	now = Date.now(),
): boolean {
	const marks = storedMarks(storage);
	const stored = marks.get(mark.order, now);
	const kept = stored?.state === "charging" ? undefined : stored;
	const own = kept?.paymentId === mark.paymentId;
	// Read again (a revisit, the browser's history), the same answer keeps its
	// mark's time: only a new state starts a new one.
	if (kept && own && kept.state === mark.state) return true;
	if (mark.state !== "paid") {
		const setAsideHere = noted(storage, SET_ASIDE_KEY, mark.paymentId, now);
		if (setAsideHere) return false;
		if (kept && (!own || kept.state === "paid")) return own;
	} else if (kept && !own && kept.state === "paid") {
		return true;
	} else if (kept && !own) {
		setAside(kept.paymentId, storage, now);
	}
	if (!stored && !makeRoom(marks, now)) return false;
	const until = now + ORDER_MARK_MS[mark.state];
	marks.set(mark.order, { ...mark, until }, until);
	return writeOrderMarks(marks, storage, now);
}

export type OrderLocks = {
	exclusive: <T>(name: string, run: () => Promise<T>) => Promise<T>;
};

// Every order's mark lives in one stored list, so every read-modify-write of
// it (a mark, a charging claim, a mark let go) runs under one lock every tab
// shares: a write for one order never puts back a list read before another
// tab changed another order's mark. Each reads the time once it holds the
// lock, so a wait for it never shortens the mark it writes. Without Web Locks
// it runs at once, as the claim's own fallback does (`markCharging`).
const MARKS_LOCK = "whop-checkout-marks";

function underMarksLock<T>(locks: OrderLocks | null, run: () => T): Promise<T> {
	if (!locks) return Promise.resolve(run());
	return locks.exclusive(MARKS_LOCK, async () => run());
}

export type ChargingClaim =
	| { claimed: true }
	| { claimed: false; mark: OrderMark };

// The order's marks read fresh: any mark stops the send but this attempt's own
// charging one (its resend), and the declined mark this tab saw (`replacing`,
// its payment), which the claim takes the place of, setting that payment
// aside, only once the claim stands. A write storage refuses claims nothing to
// guard with, so it doesn't stop the send, as for every mark.
function claimIn(
	order: string,
	key: string,
	storage: () => AttemptStorage,
	now: number,
	replacing: string | null,
): ChargingClaim {
	const marks = storedMarks(storage);
	const stored = marks.get(order, now);
	const replaced =
		stored?.state === "declined" && stored.paymentId === replacing;
	if (
		stored &&
		!replaced &&
		(stored.state !== "charging" || stored.key !== key)
	) {
		return { claimed: false, mark: stored };
	}
	if (replaced) setAside(stored.paymentId, storage, now);
	if (!stored && !makeRoom(marks, now)) return { claimed: true };
	const until = now + ORDER_MARK_MS.charging;
	marks.set(order, { order, state: "charging", key, until }, until);
	writeOrderMarks(marks, storage, now);
	return { claimed: true };
}

// Claimed before an attempt's first send, so of two tabs that both found the
// order unmarked only one sends. localStorage has no compare-and-swap, so the
// read and the write run under the marks' lock. Without Web Locks, the mark is
// written and read back, and a tab whose key isn't the one stored stops: that
// narrows the race but doesn't close it. The attempt's return token is kept
// only with a claim that stands (`keepReturnToken`).
export async function markCharging(
	order: string,
	key: string,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
	now: () => number = Date.now,
	replacing: string | null = null,
	returnToken: string | null = null,
): Promise<ChargingClaim> {
	const keepToken = (claim: ChargingClaim) => {
		if (claim.claimed && returnToken) {
			keepReturnToken(returnToken, storage, now());
		}
		return claim;
	};
	if (locks) {
		return underMarksLock(locks, () =>
			keepToken(claimIn(order, key, storage, now(), replacing)),
		);
	}
	const claim = claimIn(order, key, storage, now(), replacing);
	if (!claim.claimed) return claim;
	const stored = storedMarks(storage).get(order, now());
	return keepToken(
		stored && (stored.state !== "charging" || stored.key !== key)
			? { claimed: false, mark: stored }
			: { claimed: true },
	);
}

// An attempt that never charged (refused before Whop, or let go before any
// payment) lets go of the charging mark it wrote, and only its own.
export function clearCharging(
	order: string,
	key: string,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
	at?: number,
): Promise<void> {
	return underMarksLock(locks, () => {
		const now = at ?? Date.now();
		const marks = storedMarks(storage);
		const stored = marks.get(order, now);
		if (stored?.state !== "charging" || stored.key !== key) return;
		marks.delete(order);
		writeOrderMarks(marks, storage, now);
	});
}

function makeRoom(marks: ExpiringMap<OrderMark>, now: number): boolean {
	const live = marksIn(marks, now);
	const over = live.length - ORDER_MARKS_KEPT + 1;
	if (over <= 0) return true;
	const markedAt = (mark: OrderMark) => mark.until - ORDER_MARK_MS[mark.state];
	const oldestFirst = (states: readonly OrderMarkState[]) =>
		live
			.filter((mark) => states.includes(mark.state))
			.sort((a, b) => markedAt(a) - markedAt(b));
	const leaving = [
		...oldestFirst(["paid"]),
		...oldestFirst(["pending", "declined"]),
	];
	if (leaving.length < over) return false;
	for (const mark of leaving.slice(0, over)) marks.delete(mark.order);
	return true;
}

// A payment named is set aside even with no mark of its own standing (Start
// over before any answer marked it), so a later pending or declined answer for
// it never marks the order.
export function forgetOrderMark(
	order: string,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
	paymentId?: string,
	at?: number,
): Promise<void> {
	return underMarksLock(locks, () => {
		const now = at ?? Date.now();
		if (paymentId) setAside(paymentId, storage, now);
		const marks = storedMarks(storage);
		const kept = marks.get(order, now);
		if (!kept) return;
		const keptPayment = kept.state === "charging" ? null : kept.paymentId;
		if (paymentId && keptPayment !== paymentId) return;
		marks.delete(order);
		writeOrderMarks(marks, storage, now);
		if (!paymentId && keptPayment) setAside(keptPayment, storage, now);
	});
}

// The tab that saw its own payment declined offers the pay button and the
// decline's reason at once; the declined mark, and its Pay again, are for the
// store's other tabs.
export function markFor(
	mark: OrderMark | null,
	declinedHere: string | null,
): OrderMark | null {
	return mark?.state === "declined" && mark.paymentId === declinedHere
		? null
		: mark;
}

// A mark guards the order in every tab of the store, so once one guards it for
// this answer (`markOrder`) the caller lets the tab's own attempt for it go, if
// the payment `releasesAttempt`; otherwise the attempt stays the guard.
// A pending or declined mark lasts days, and only the order-complete page moves
// it on its own, so a page about to show one reads its payment again, once per
// page view, and the mark follows the answer: a bank debit that cleared since
// shows as paid, never as still processing. True when the mark changed.
export async function recheckMark(
	mark: OrderMark,
	checked: Set<string>,
	read: (paymentId: string) => Promise<PaymentState | null>,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
): Promise<boolean> {
	if (mark.state !== "pending" && mark.state !== "declined") return false;
	if (checked.has(mark.paymentId)) return false;
	checked.add(mark.paymentId);
	// A read that fails leaves the mark as it stands.
	const state = await read(mark.paymentId).catch(() => null);
	const learned = state ? learnedState(state) : null;
	if (!learned || learned === mark.state) return false;
	return markOrderPayment(mark.order, mark.paymentId, learned, storage, locks);
}

export function markOrderPayment(
	order: string,
	paymentId: string,
	state: LearnedState | null,
	storage: () => AttemptStorage,
	locks: OrderLocks | null,
	at?: number,
): Promise<boolean> {
	if (!state) return Promise.resolve(false);
	return underMarksLock(locks, () =>
		markOrder({ order, paymentId, state }, storage, at ?? Date.now()),
	);
}

export function orderMarksChanged(key: string | null): boolean {
	return key === null || key === ORDER_MARKS_KEY;
}
