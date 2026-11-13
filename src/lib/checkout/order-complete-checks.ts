import { retryWhileShown } from "./charge-attempt";
import { SERVER_WAIT_MS, within } from "./deadline";
import {
	type PaymentState,
	paymentStateKey,
	stillDeciding,
} from "./payment-state";
import { isRecord } from "./shared";

export type PaymentCheck = { checking: string };

export const PAYMENT_CHECK_DELAYS_MS = [2_000, 4_000, 8_000, 15_000, 30_000];

// How long, in time the page is shown, a charge Whop is still deciding is read
// again: past the schedule at its last interval, then the page stops and its
// face no longer says it will update on its own.
export const PAYMENT_CHECK_FOR_MS = 5 * 60_000;

export function* statusCheckDelays(): Generator<number> {
	const last = PAYMENT_CHECK_DELAYS_MS.at(-1) ?? PAYMENT_CHECK_FOR_MS;
	let waited = 0;
	for (let check = 0; ; check += 1) {
		const delay = PAYMENT_CHECK_DELAYS_MS[check] ?? last;
		if (waited + delay > PAYMENT_CHECK_FOR_MS) return;
		waited += delay;
		yield delay;
	}
}

export function isPaymentCheck(value: unknown): value is PaymentCheck {
	return isRecord(value) && typeof value.checking === "string";
}

export type PaymentMissing = { paymentId: string; missing: true };

export function isPaymentMissing(value: unknown): value is PaymentMissing {
	return (
		isRecord(value) &&
		value.missing === true &&
		typeof value.paymentId === "string"
	);
}

// A first read that didn't answer, read again on the schedule until one does:
// the payment, or Whop saying it has none. No answer at all is null.
export async function checkPaymentAgain<T>(
	read: () => Promise<T | PaymentCheck | null>,
	wait: (ms: number) => Promise<unknown>,
	live: () => boolean,
): Promise<T | null> {
	const answer = await retryWhileShown(
		PAYMENT_CHECK_DELAYS_MS,
		async (ms) => {
			await wait(ms);
			return live();
		},
		// A read that fails is one that didn't answer: the next is on schedule.
		() => read().catch(() => undefined),
		(read) => read === null || (read !== undefined && !isPaymentCheck(read)),
	);
	return answer === null || answer === undefined || isPaymentCheck(answer)
		? null
		: answer;
}

// The order-complete page's checks. A first read that didn't answer is read
// again whole until it does. While Whop then decides, only the payment's
// status is read (`statusCheckDelays`), and the whole order once that status
// moves (again at the end, if that read didn't answer): its lines and details
// don't change while the charge is decided. That read names the state it saw
// (`paymentStateKey`), so the server reads again what it kept from before the
// move. `wait` counts only time the page is shown, so a hidden tab reads
// nothing.
export async function checkOrderAgain<
	T extends { paymentId: string; state: PaymentState },
>(
	loaded: T | PaymentCheck,
	reads: {
		order: (seen?: string) => Promise<T | PaymentMissing | PaymentCheck | null>;
		state: () => Promise<PaymentState | null>;
	},
	wait: (ms: number) => Promise<unknown>,
	live: () => boolean,
	deadlineMs = SERVER_WAIT_MS,
): Promise<T | PaymentMissing | null> {
	// As with every server call the page makes (deadline.ts), a read the
	// browser doesn't settle is given up on: one that outlasts its deadline is
	// a read that didn't answer, and the checks go on.
	const readOrder = (seen?: string) => within(reads.order(seen), deadlineMs);
	const readState = () => within(reads.state(), deadlineMs);
	const first = isPaymentCheck(loaded)
		? await checkPaymentAgain(() => readOrder(), wait, live)
		: loaded;
	if (!first || isPaymentMissing(first) || !stillDeciding(first.state)) {
		return first;
	}
	const orderOf = async (seen: PaymentState): Promise<T | null> => {
		// A read that fails leaves the page showing what it has.
		const answer = await readOrder(paymentStateKey(seen)).catch(() => null);
		return answer && !isPaymentCheck(answer) && !isPaymentMissing(answer)
			? answer
			: null;
	};
	let shown = first;
	let whole = true;
	await retryWhileShown(
		statusCheckDelays(),
		async (ms) => {
			await wait(ms);
			return live();
		},
		async () => {
			// A read that fails waits for the next on the schedule.
			const state = await readState().catch(() => null);
			if (!state || paymentStateKey(state) === paymentStateKey(shown.state)) {
				return false;
			}
			const order = await orderOf(state);
			whole = order !== null;
			shown = order ?? { ...shown, state };
			return !stillDeciding(shown.state);
		},
		(settled) => settled,
	);
	if (!whole && live()) shown = (await orderOf(shown.state)) ?? shown;
	return shown;
}

// A check's answer, kept with the payment it was for: the page can move to
// another payment, and only the one it is on counts.
export type PaymentChecked<T> = { paymentId: string; order: T | null };

// The first answer for a payment stands: a later one never replaces it. An
// order for another payment counts as none.
export function landPaymentCheck<T extends { paymentId: string }>(
	kept: PaymentChecked<T> | null,
	paymentId: string,
	found: T | null,
): PaymentChecked<T> | null {
	if (kept?.paymentId === paymentId) return kept;
	return {
		paymentId,
		order: found?.paymentId === paymentId ? found : null,
	};
}

export function orderInView<T extends { paymentId: string }>(
	loaded: T | PaymentCheck | null,
	checked: PaymentChecked<T> | null,
): { order: T | null; checking: boolean } {
	if (!isPaymentCheck(loaded)) {
		const later =
			loaded &&
			!isPaymentMissing(loaded) &&
			checked?.paymentId === loaded.paymentId &&
			!isPaymentMissing(checked.order)
				? checked.order
				: null;
		return { order: later ?? loaded, checking: false };
	}
	return checked?.paymentId === loaded.checking
		? { order: checked.order, checking: false }
		: { order: null, checking: true };
}
