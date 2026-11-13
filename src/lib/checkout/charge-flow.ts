import {
	attemptPlace,
	type ChargeAttempt,
	type ChargedPayment,
	type ChargeInputs,
	completionUrl,
	definite,
	followedPayment,
	IN_PROGRESS_CODE,
	keyMismatch,
	paymentToContinue,
	PROMO_REFUSED_CODE,
	QUOTE_IN_USE_CODE,
	type QuoteReading,
	type Refusal,
	RefusedError,
	RESEND_DELAYS_MS,
	STALE_QUOTE_CODES,
	STORE_UNAVAILABLE_CODE,
	TAX_UNAVAILABLE_CODE,
} from "./charge-attempt";
import { type ChargingClaim, type OrderMark } from "./order-marks";
import {
	classifyPayment,
	type LearnedState,
	learnedState,
	OFF_PAGE_STEPS,
	type PaymentError,
	type PaymentState,
	waitsOnThisTab,
	releasesAttempt,
} from "./payment-state";
import { NEXT_ACTION_MS, NoAnswer, within } from "./deadline";
import {
	ATTEMPT_ELSEWHERE,
	ATTEMPT_OTHER_ORDER,
	BANK_PAGE_UNOPENED,
	BANK_STEP_BLOCKED,
	BANK_STEP_UNREACHABLE,
	blockedBankStep,
	BuyerError,
	buyerMessage,
	refusalMessage,
	FINISH_VERIFYING,
	LAST_PAYMENT_GONE,
	LAST_PAYMENT_UNCHECKED,
	PAYMENTS_UNAVAILABLE,
	LAST_PAYMENT_UNKNOWN,
	markedOrderError,
	PAYMENT_DECLINED,
	PAYMENT_FAILED,
	PAYMENT_FORM_NEEDED,
	PAYMENT_UNCONFIRMED,
	PRICE_CHANGED,
	PRICE_REFRESHED,
	QUOTE_HELD,
	repricedMessage,
	STILL_CONFIRMING,
	StepWaitingError,
	STORAGE_BLOCKED,
	type PageError,
	pageError,
	TAX_UNAVAILABLE,
	tokenizationMessage,
} from "./messages";
import {
	type Address,
	type Order,
	orderKeyOf,
	orderTag,
	orderTagOf,
	type PageQuote,
	taxFailed,
} from "./order";

export type NextActionOutcome = {
	status: string;
	redirected: boolean;
	lastPaymentError: PaymentError | null;
};

export type Requote = () => Promise<PageQuote | null>;

// A stored attempt is priced again where it was charged, whatever the page's
// form says now: a wallet's address can differ from it. It is priced in the
// page's own currency choice, as every quote the page asks is (`auto` stays
// `auto`), so the next click pays the quote it shows. Its quote lands on the
// page only while nothing newer has: a page quote asked since, or a page
// restored from the browser's cache, keeps what it shows, and the buyer is
// still told the new total.
export function storedRequote(
	attempt: ChargeAttempt,
	deps: {
		price: (address: Address) => Promise<PageQuote>;
		show: (quote: PageQuote) => void;
		ticket: () => () => boolean;
	},
): Requote {
	return async () => {
		const current = deps.ticket();
		const next = await deps.price(attempt.inputs.shippingAddress);
		if (current()) deps.show(next);
		return next;
	};
}

// A page restored from the browser's cache can resume a run it froze, beside
// the buyer's next click. Each restore starts a new generation: a run from an
// older one stops before it stores an attempt or sends, and never touches the
// page again. An attempt it already stored is the next click's to send again.
export type ChargeRun = { live: () => boolean };

class StaleRun extends Error {}

function stillLive(run: ChargeRun) {
	if (!run.live()) throw new StaleRun();
}

export type ChargeFlow = {
	// `resend` is any send of an attempt but its first: the server checks only a
	// fresh one against its live settings.
	chargeQuote: (
		key: string,
		inputs: ChargeInputs,
		resend: boolean,
	) => Promise<{ payment: ChargedPayment } | { refusal: Refusal }>;
	readQuotePayment: (quoteId: string) => Promise<QuoteReading | null>;
	handleNextAction: (clientSecret: string) => Promise<NextActionOutcome>;
	elementsLoaded: () => boolean;
	readPaymentState: (paymentId: string) => Promise<PaymentState | null>;
	attempts: {
		current: () => ChargeAttempt | null;
		record: (attempt: ChargeAttempt) => boolean;
		forget: (key: string) => void;
	};
	marked: (order: string) => OrderMark | null;
	// The decline this tab saw: the claim takes its mark's place, and only
	// once the claim stands does the tab let go of it.
	payingAgain: (order: string) => void;
	// Another tab's checkout of the order waits on an attempt from before its
	// first send until it has an answer (`order-marks.ts` `markCharging`).
	// The attempt's return token is kept with the claim, and only when the
	// claim stands.
	markCharging: (
		order: string,
		key: string,
		returnToken: string,
	) => Promise<ChargingClaim>;
	clearCharging: (order: string, key: string) => Promise<void>;
	// With a payment named, only a mark of that payment's goes.
	buyAgain: (order: string, paymentId?: string) => Promise<void>;
	retireQuote: (quoteId: string) => void;
	dropPromo: (failure: RefusedError) => void;
	navigate: (url: string) => void;
	sleep: (ms: number) => Promise<unknown>;
	newKey: () => string;
	page: () => string;
	// The order's return URL with the attempt's return token
	// (order-marks.ts `keepReturnToken`). The attempt carries it, so every
	// resend sends Whop the same one.
	returnUrl: (order: string, returnToken: string) => string;
	newReturnToken: () => string;
	inFlight: { current: boolean };
	leaving: { current: boolean };
	generation: { current: number };
	busy: (busy: boolean) => void;
	error: (error: PageError | null) => void;
	unsettled: (key: string | null) => void;
	visibleFor: (ms: number, live: () => boolean) => Promise<boolean>;
	markPayment: (
		order: string,
		paymentId: string,
		state: LearnedState,
	) => Promise<boolean>;
};

// Longer than a bank's page takes to replace a visible tab.
export const REDIRECT_STALL_MS = 20_000;

// Held until the next page replaces it: giving the page back sooner would let
// the buyer start over and pay again while this payment's page loads. A page
// brought back must not offer the charged quote again.
function leave(flow: ChargeFlow, url: string, quoteId: string) {
	flow.retireQuote(quoteId);
	flow.leaving.current = true;
	flow.navigate(url);
}

const QUOTE_SPENT_CODES: ReadonlySet<string> = new Set([
	...STALE_QUOTE_CODES,
	QUOTE_IN_USE_CODE,
	TAX_UNAVAILABLE_CODE,
]);

async function handleRefusal(
	flow: ChargeFlow,
	attempt: ChargeAttempt,
	refusal: Refusal,
	requote: Requote,
) {
	const { quoteId } = attempt.inputs;
	// The store's server couldn't read its own configuration: the quote was
	// never used, and stays the buyer's for when it can.
	if (refusal.code === STORE_UNAVAILABLE_CODE) {
		throw new BuyerError(refusalMessage(refusal, PAYMENT_FAILED));
	}
	// No payment of this attempt's holds the quote (`settleAttempt`), so one
	// Whop refused before taking it (the method can't pay its currency or
	// processor, a field it refused) stays the buyer's, and another method
	// pays it. Only a quote Whop says can't be charged, or another attempt
	// holds, is retired.
	if (refusal.code && QUOTE_SPENT_CODES.has(refusal.code)) {
		flow.retireQuote(quoteId);
	}
	// No payment exists yet: another attempt's request is still running, or
	// stopped before it made one.
	if (refusal.code === QUOTE_IN_USE_CODE) throw new BuyerError(QUOTE_HELD);
	if (refusal.code === TAX_UNAVAILABLE_CODE) {
		throw new BuyerError(TAX_UNAVAILABLE, true);
	}
	if (refusal.code === PROMO_REFUSED_CODE) {
		flow.dropPromo(new RefusedError(refusal));
	}
	if (refusal.code && STALE_QUOTE_CODES.has(refusal.code)) {
		// The price changed either way; a requote that fails leaves it untold.
		const next = await requote().catch(() => null);
		// An estimate from the buyer's IP is never told as the total; with no
		// new price on the page, the buyer is told only that it changed.
		const told = next && !next.estimated ? next : null;
		if (!told) throw new BuyerError(PRICE_CHANGED);
		throw new BuyerError(
			repricedMessage(told, attempt) ?? PRICE_REFRESHED,
			taxFailed(told),
		);
	}
	throw new RefusedError(refusal, refusalMessage(refusal, PAYMENT_FAILED));
}

// Only the order-complete page lets go of an attempt, so a tab that never gets
// there sends the same charge again, and Whop answers with this same payment.
// Starting over is the only other way out: the payment keeps its quote until it
// ends, and the API has no cancel for it yet.
async function finishPayment(
	flow: ChargeFlow,
	payment: ChargedPayment,
	attempt: ChargeAttempt,
	run: ChargeRun,
	known?: PaymentState,
): Promise<"left" | { failed: string }> {
	stillLive(run);
	const { quoteId, returnUrl: returnTo } = attempt.inputs;
	const order = orderTag(attempt.origin, attempt.orderKey);
	// Once the order is marked, the mark guards it in every tab, and the tab's
	// own attempt goes if the buyer has nothing left to do on the checkout; a
	// provisional state, or no mark guarding the order for this answer, keeps
	// the attempt.
	const learned = async (
		seen: PaymentState,
	): Promise<"left" | { failed: string }> => {
		const state = learnedState(seen);
		if (state === null) throw new BuyerError(PAYMENT_UNCONFIRMED);
		const marked = await flow.markPayment(order, payment.id, state);
		const done = releasesAttempt(classifyPayment(seen));
		if (done && marked) flow.attempts.forget(attempt.key);
		if (state === "declined") {
			flow.retireQuote(quoteId);
			const failure = seen.lastPaymentError?.message;
			return {
				failed: failure
					? buyerMessage(failure, PAYMENT_FAILED)
					: PAYMENT_DECLINED,
			};
		}
		leave(flow, completionUrl(returnTo, payment.id, seen.status), quoteId);
		return "left";
	};
	// Without Elements (its load failed, or hasn't finished) the page can't run
	// a payment's next action, so one with a secret is settled from Whop's
	// status, as one without a secret is. Only a step the buyer takes on this
	// page holds it: the attempt stays, for when the payment form loads.
	if (!payment.clientSecret || !flow.elementsLoaded()) {
		// A read that fails is unconfirmed, the attempt kept.
		const state =
			known ?? (await flow.readPaymentState(payment.id).catch(() => null));
		stillLive(run);
		if (!state) throw new BuyerError(PAYMENT_UNCONFIRMED);
		const kind = classifyPayment(state);
		if (payment.clientSecret) {
			if (kind === "unverified") {
				throw new StepWaitingError(PAYMENT_FORM_NEEDED);
			}
			return learned(state);
		}
		// What Whop hasn't decided needs this tab's secret: the next click's
		// resend gets it back.
		if (waitsOnThisTab(kind)) throw new BuyerError(PAYMENT_UNCONFIRMED);
		return learned(state);
	}
	const outcome = await within(
		flow.handleNextAction(payment.clientSecret),
		NEXT_ACTION_MS,
	).catch((failure: unknown) => {
		if (failure instanceof NoAnswer) return null;
		// The attempt is kept: the bank's page returns the buyer to the
		// order-complete page, and Confirm my payment offers the page again.
		const blocked = blockedBankStep(failure);
		if (blocked?.url) {
			throw new BuyerError(BANK_STEP_BLOCKED, false, blocked.url);
		}
		if (blocked) throw new BuyerError(BANK_STEP_UNREACHABLE);
		throw new BuyerError(PAYMENT_UNCONFIRMED);
	});
	stillLive(run);
	// Still undecided past the deadline: the page is given back with the
	// attempt kept and the order marked pending, and the answer that comes
	// later lands nowhere. The next click resends the attempt, and Whop answers
	// with this same payment.
	if (!outcome) {
		await flow.markPayment(order, payment.id, "pending");
		throw new BuyerError(STILL_CONFIRMING);
	}
	// A full-page step (a bank's own site) is already taking the tab away. One
	// that never does (blocked, or stopped by the buyer) gives the page back
	// after a long visible wait, the attempt kept: the next click resends it
	// under its key, so Whop answers with this same payment, and Start over
	// isn't offered, as the bank's step may still finish.
	if (outcome.redirected) {
		flow.retireQuote(quoteId);
		flow.leaving.current = true;
		void flow.visibleFor(REDIRECT_STALL_MS, run.live).then((stalled) => {
			if (!stalled || !run.live() || !flow.leaving.current) return;
			flow.leaving.current = false;
			flow.inFlight.current = false;
			flow.busy(false);
			flow.error(pageError(BANK_PAGE_UNOPENED));
		});
		return "left";
	}
	// A 3D Secure window the buyer closed is finished here, with the next click.
	// A step finished away from the page (instructions to pay with, a rail
	// confirming on its own) leaves the payment pending for the order-complete
	// page. A step that can't be told goes there too, the attempt kept: that page
	// reads the payment again until it can.
	if (outcome.status === "requires_action") {
		// A read that fails is a step that can't be told (below).
		const read = await flow.readPaymentState(payment.id).catch(() => null);
		stillLive(run);
		if (read && read.status !== "requires_action") return learned(read);
		const step = read?.step ?? null;
		if (read && step && OFF_PAGE_STEPS.has(step)) return learned(read);
		if (step) throw new BuyerError(FINISH_VERIFYING);
		leave(flow, completionUrl(returnTo, payment.id, outcome.status), quoteId);
		return "left";
	}
	const told: PaymentState = {
		status: outcome.status,
		lastPaymentError: outcome.lastPaymentError,
	};
	// Elements' handleNextAction answers with the status and the error only,
	// never `processing_details`, so a processing payment is read again: a bank
	// debit already clearing lets the attempt go, and one Whop is still
	// deciding keeps it.
	if (outcome.status !== "processing") return learned(told);
	// A read that fails falls back on Elements' own answer.
	const read = await flow.readPaymentState(payment.id).catch(() => null);
	stillLive(run);
	return learned(read ?? told);
}

async function sendAttempt(
	flow: ChargeFlow,
	attempt: ChargeAttempt,
	run: ChargeRun,
	fresh: boolean,
): Promise<
	| { payment: ChargedPayment }
	| { refusal: Refusal; sends: number }
	| { unanswered: Refusal }
> {
	for (let send = 0; ; send += 1) {
		stillLive(run);
		// This site's own server not answering leaves the charge open too.
		const answer = await flow
			.chargeQuote(attempt.key, attempt.inputs, !(fresh && send === 0))
			.catch((): { refusal: Refusal } => ({
				refusal: { code: null, message: PAYMENT_UNCONFIRMED, status: null },
			}));
		stillLive(run);
		if ("payment" in answer) return answer;
		if (definite(answer.refusal)) {
			return { refusal: answer.refusal, sends: send + 1 };
		}
		const delay = RESEND_DELAYS_MS[send];
		if (delay === undefined) return { unanswered: answer.refusal };
		await flow.sleep(delay);
	}
}

// While Whop still runs the key's request, a declined payment it made keeps its
// quote and can be retried there and succeed, so the attempt stays.
async function followQuotePayment(
	flow: ChargeFlow,
	attempt: ChargeAttempt,
	run: ChargeRun,
	running = false,
): Promise<"followed" | "none" | "unreadable" | "gone"> {
	// A read that fails is an unreadable quote, which keeps the attempt.
	const read = await flow
		.readQuotePayment(attempt.inputs.quoteId)
		.catch(() => null);
	stillLive(run);
	if (!read) return "unreadable";
	if ("gone" in read) return "gone";
	if (!read.payment) return "none";
	const found = read.payment;
	flow.attempts.record(followedPayment(found, attempt).attempt);
	if (running && classifyPayment(found.state) === "declined") {
		throw new BuyerError(STILL_CONFIRMING);
	}
	const continued = await paymentToContinue(attempt, found, () => {
		stillLive(run);
		// No answer leaves the payment unconfirmed, the attempt kept.
		return flow
			.chargeQuote(attempt.key, attempt.inputs, true)
			.catch(() => null);
	});
	stillLive(run);
	if (!continued) throw new BuyerError(PAYMENT_UNCONFIRMED);
	flow.attempts.record(continued.attempt);
	const finished = await finishPayment(
		flow,
		continued.payment,
		continued.attempt,
		run,
		found.state,
	);
	if (finished !== "left") throw new BuyerError(finished.failed);
	return "followed";
}

export async function settleAttempt(
	flow: ChargeFlow,
	attempt: ChargeAttempt,
	requote: Requote,
	run: ChargeRun,
	fresh = false,
) {
	const answer = await sendAttempt(flow, attempt, run, fresh);
	if ("unanswered" in answer) {
		// A payment this attempt made may already hold the quote.
		if (
			answer.unanswered.code === IN_PROGRESS_CODE &&
			(await followQuotePayment(flow, attempt, run, true)) === "followed"
		) {
			return;
		}
		throw new BuyerError(STILL_CONFIRMING);
	}
	if ("refusal" in answer) {
		// Refused on its very first send, the attempt never ran. Otherwise an
		// earlier send may have charged, and the quote's payment decides. A quote
		// that can't be read, or that Whop no longer has, proves nothing, so the
		// attempt and its quote are kept: only a quote shown to hold no payment
		// lets the attempt go. A gone quote stays gone, so that says to start
		// over rather than try again.
		const neverRan = fresh && answer.sends === 1;
		const followed = neverRan
			? "none"
			: await followQuotePayment(flow, attempt, run);
		if (followed === "followed") return;
		// The store's own server can't read its configuration, so the quote's
		// payment can't be read either, and trying again won't change that.
		if (followed === "unreadable") {
			throw new BuyerError(
				answer.refusal.code === STORE_UNAVAILABLE_CODE
					? PAYMENTS_UNAVAILABLE
					: LAST_PAYMENT_UNCHECKED,
			);
		}
		if (followed === "gone") throw new BuyerError(LAST_PAYMENT_GONE);
		flow.attempts.forget(attempt.key);
		await flow.clearCharging(
			orderTag(attempt.origin, attempt.orderKey),
			attempt.key,
		);
		if (keyMismatch(answer.refusal)) {
			flow.retireQuote(attempt.inputs.quoteId);
			throw new BuyerError(LAST_PAYMENT_UNKNOWN);
		}
		await handleRefusal(flow, attempt, answer.refusal, requote);
		return;
	}
	const charged: ChargeAttempt = {
		...attempt,
		paymentId: answer.payment.id,
		...(answer.payment.clientSecret
			? { clientSecret: answer.payment.clientSecret }
			: {}),
	};
	flow.attempts.record(charged);
	const finished = await finishPayment(flow, answer.payment, charged, run);
	if (finished !== "left") throw new BuyerError(finished.failed);
}

// Stored before the first send, so a send whose answer is lost is the one sent
// again.
export async function payQuote(
	flow: ChargeFlow,
	input: {
		order: Order;
		priced: PageQuote;
		confirmationToken: string;
		address: Address;
		affiliateCode?: string;
		termsAccepted?: boolean;
		requote: Requote;
		run: ChargeRun;
	},
) {
	const { order, priced } = input;
	const tag = orderTagOf(order);
	const mark = flow.marked(tag);
	if (mark) throw markedOrderError(mark);
	const returnToken = flow.newReturnToken();
	const attempt: ChargeAttempt = {
		key: flow.newKey(),
		inputs: {
			accountId: order.seller.accountId,
			quoteId: priced.id,
			confirmationToken: input.confirmationToken,
			shippingAddress: input.address,
			returnUrl: flow.returnUrl(tag, returnToken),
			affiliateCode: input.affiliateCode,
			...(input.termsAccepted ? { termsAccepted: true } : {}),
		},
		origin: order.origin,
		orderKey: orderKeyOf(order),
		page: flow.page(),
		total: priced.total,
		currency: priced.money.currency,
	};
	stillLive(input.run);
	if (!flow.attempts.record(attempt)) {
		flow.attempts.forget(attempt.key);
		throw new BuyerError(STORAGE_BLOCKED);
	}
	const claim = await flow.markCharging(tag, attempt.key, returnToken);
	if (!claim.claimed) {
		flow.attempts.forget(attempt.key);
		throw markedOrderError(claim.mark);
	}
	flow.payingAgain(tag);
	await settleAttempt(flow, attempt, input.requote, input.run, true);
}

export function chargeFailureMessage(failure: unknown): string {
	if (failure instanceof BuyerError) return failure.message;
	if (failure instanceof RefusedError) {
		return refusalMessage(failure, PAYMENT_FAILED);
	}
	const tokenized = tokenizationMessage(failure);
	return tokenized === null
		? PAYMENT_FAILED
		: buyerMessage(tokenized, PAYMENT_FAILED);
}

// The task runs straight from the click, so a wallet sheet it opens is still
// inside the tap, as Apple requires.
export async function runCharge(
	flow: ChargeFlow,
	task: (run: ChargeRun) => Promise<void>,
) {
	if (flow.inFlight.current) return;
	const generation = flow.generation.current;
	const run: ChargeRun = { live: () => flow.generation.current === generation };
	flow.inFlight.current = true;
	flow.busy(true);
	flow.error(null);
	try {
		await task(run);
	} catch (failure) {
		if (!(failure instanceof BuyerError)) {
			console.error("[checkout] the charge failed", failure);
		}
		if (run.live()) {
			flow.error(
				pageError(
					chargeFailureMessage(failure),
					failure instanceof BuyerError && failure.tax,
					failure instanceof BuyerError ? failure.continueTo : undefined,
				),
			);
			flow.unsettled(
				failure instanceof StepWaitingError
					? null
					: (flow.attempts.current()?.key ?? null),
			);
		}
	} finally {
		if (run.live() && !flow.leaving.current) {
			flow.inFlight.current = false;
			flow.busy(false);
		}
	}
}

// A charge without a final answer goes first, whatever the quote or address
// now. One made for another order is left for its own page.
export function resendStored(
	flow: ChargeFlow,
	input: {
		attempt: ChargeAttempt;
		order: Order;
		requote: Requote;
	},
) {
	const place = attemptPlace(input.attempt, input.order, flow.page());
	if (place) {
		flow.error(pageError(place.href ? ATTEMPT_ELSEWHERE : ATTEMPT_OTHER_ORDER));
		return;
	}
	void runCharge(flow, (run) =>
		settleAttempt(flow, input.attempt, input.requote, run),
	);
}

// A payment may hold the forgotten attempt's quote, so that quote is never
// charged again.
export function startOver(flow: ChargeFlow, stored: ChargeAttempt | null) {
	if (stored) {
		flow.attempts.forget(stored.key);
		void flow.clearCharging(
			orderTag(stored.origin, stored.orderKey),
			stored.key,
		);
		flow.retireQuote(stored.inputs.quoteId);
		if (stored.paymentId) {
			void flow.buyAgain(
				orderTag(stored.origin, stored.orderKey),
				stored.paymentId,
			);
		}
	}
	flow.unsettled(null);
	flow.error(null);
}
