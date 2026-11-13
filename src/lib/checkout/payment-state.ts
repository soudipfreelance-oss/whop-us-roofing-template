import type { PaymentMarkState } from "./order-marks";

// Whop's payment lifecycle, as its API publishes it: a status from a closed
// list, `last_payment_error`, `next_action` and `processing_details`.
// `GET /payments/{id}/status` reads it, and so does Elements'
// handleNextAction. A payment's own `status` (its receipt's) is never
// classified.
export type PaymentError = {
	code?: string | null;
	decline_code?: string | null;
	message?: string | null;
};

export type PaymentState = {
	status: string;
	// Kept on every status but `succeeded`, and only when the receipt has an
	// error message.
	lastPaymentError: PaymentError | null;
	step?: string | null;
	// `processing_details`: money moving on a settling rail (a bank debit). A
	// bare `processing` is a charge Whop hasn't decided yet. Either way the
	// payment is still open, an underpaid crypto payment waiting on the rest
	// included.
	settling?: boolean;
};

// Every field classifyPayment reads, so no change it would read differently
// goes unnoticed. The order-complete page and its server read compare states
// by it.
export function paymentStateKey(state: PaymentState): string {
	return JSON.stringify([
		state.status,
		Boolean(state.settling),
		state.step ?? null,
		state.lastPaymentError?.code || null,
		state.lastPaymentError?.decline_code || null,
		state.lastPaymentError?.message || null,
	]);
}

// `unverified` is a step the buyer takes on the page (a bank's 3D Secure check)
// that isn't done: only the tab holding the attempt, with its secret, finishes
// it, so it marks nothing. `offPage` is a step the buyer takes elsewhere (a
// bank transfer's instructions, a confirmation in their bank's app).
// `undecided` is provisional: Whop can still turn it into a step on the page.
export type PaymentKind =
	| "settled"
	| "clearing"
	| "offPage"
	| "undecided"
	| "unverified"
	| "declined"
	| "canceled"
	| "unknown";

export function waitsOnThisTab(kind: PaymentKind): boolean {
	return kind === "undecided" || kind === "offPage" || kind === "unverified";
}

// Only a payment the buyer can't act on from the checkout any more lets the
// tab's attempt, and its secret, go. A provisional one keeps it, so a step
// Whop asks for later is still finished from the checkout.
export function releasesAttempt(kind: PaymentKind): boolean {
	return (
		kind === "settled" ||
		kind === "clearing" ||
		kind === "offPage" ||
		kind === "declined" ||
		kind === "canceled"
	);
}

// The bar Elements' own checkout holds an error to: an empty block is a read
// racing the transition, not a reason.
function statedError(error: PaymentError | null): boolean {
	return Boolean(error && (error.code || error.decline_code || error.message));
}

// `requires_capture` is an authorization holding the buyer's money.
//
// `requires_confirmation` is a decline only with a stated error, wherever it is
// read, as Elements' own checkout reads it. Without one it is undecided: Whop
// returns `requires_confirmation` with no `last_payment_error` both before a
// charge is attempted (POST /payments answers before the charge runs) and when
// a failed attempt has no message. Read as a decline, the order would be
// offered again while the first payment is still being charged.
export function classifyPayment(payment: PaymentState): PaymentKind {
	switch (payment.status) {
		case "succeeded":
		case "requires_capture":
			return "settled";
		case "processing":
			return payment.settling ? "clearing" : "undecided";
		case "requires_action":
			return payment.step && OFF_PAGE_STEPS.has(payment.step)
				? "offPage"
				: "unverified";
		case "confirming":
			return "undecided";
		case "requires_confirmation":
			return statedError(payment.lastPaymentError) ? "declined" : "undecided";
		case "canceled":
			return "canceled";
		default:
			return "unknown";
	}
}

// A canceled payment marks its order as a declined one does: Whop lets its
// receipt be retried, so it can still move to pending or paid, and the order
// stays guarded until then.
export type LearnedState = PaymentMarkState;

const LEARNED: Record<PaymentKind, LearnedState | null> = {
	settled: "paid",
	clearing: "pending",
	offPage: "pending",
	undecided: "pending",
	unverified: null,
	declined: "declined",
	canceled: "declined",
	unknown: null,
};

export function learnedState(payment: PaymentState): LearnedState | null {
	return LEARNED[classifyPayment(payment)];
}

// A `next_action` the buyer finishes away from the page: paying with the
// instructions they were shown (a voucher, a bank transfer), or a rail
// confirming on its own.
export const OFF_PAGE_STEPS = new Set([
	"display_instructions",
	"await_confirmation",
]);

// The return leg's `status` when the bank refused (Elements' return landing
// forwards these).
const CLAIMED_FAILED = new Set(["failed", "canceled", "cancelled"]);

// The return leg's `claimed` status never decides how a payment stands: a bank
// that declined a 3D Secure check can send the buyer back before Whop records
// the failure, so it only stops the page saying the payment is on its way.
export type PaymentOutcome =
	| "confirmed"
	| "processing"
	| "awaiting"
	| "unverified"
	| "unconfirmed"
	| "failed"
	| "unknown";

// A bare `requires_confirmation` the page stopped reading is neither a
// decline nor a payment on its way: the buyer is told it isn't confirmed.
export function paymentOutcome(
	payment: PaymentState & { claimed?: string | null },
): PaymentOutcome {
	const kind = classifyPayment(payment);
	if (kind === "settled") return "confirmed";
	if (kind === "declined" || kind === "canceled") return "failed";
	if (kind === "unknown") return "unknown";
	if (kind === "clearing") return "processing";
	if (payment.step === "display_instructions") return "awaiting";
	if (payment.status === "requires_confirmation") return "unconfirmed";
	if (payment.claimed && CLAIMED_FAILED.has(payment.claimed)) {
		return "unconfirmed";
	}
	return kind === "unverified" ? "unverified" : "processing";
}

// A charge Whop is still deciding, read on the order-complete page: it is read
// again until it settles. Money moving on a settling rail (`processing` with
// its details), or a step the buyer finishes elsewhere, takes days instead.
export function stillDeciding(state: PaymentState): boolean {
	return classifyPayment(state) === "undecided";
}
