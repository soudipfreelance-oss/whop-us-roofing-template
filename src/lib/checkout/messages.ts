import { NEXT_ACTION_MS, NoAnswer, within } from "./deadline";
import type { OrderMarkState } from "./order-marks";
import { isRecord } from "./shared";
import {
	type AddressField,
	money,
	type PromoAwaiting,
	type Quote,
} from "./order";

export const PAYMENT_FAILED = "Your payment could not be completed.";
export const PAYMENT_DECLINED =
	"Your payment didn't go through. Try again or use another payment method.";
export const LAST_PAYMENT_UNCHECKED =
	"We couldn't check on your last payment just now. Try again in a moment.";
export const LAST_PAYMENT_GONE =
	"We can't find your last payment's details. Check your email for a receipt, then start over to pay again.";
export const CHARGE_NOT_SENT =
	"Checkout couldn't send your payment, so nothing was charged.";
export const LAST_PAYMENT_UNKNOWN =
	"We couldn't confirm your last payment. Check your email for a receipt before paying again.";
export const ORDER_PAID = "This order was paid.";
// One answer for every reason the store itself can't take a payment (its
// configuration can't be read, Whop refused its policies): nothing the buyer
// can change.
export const PAYMENTS_UNAVAILABLE = "This store can't take payments right now.";
export const STORE_UPDATED =
	"This store was just updated. Reload the page to continue.";

const ADDRESS_FIELD_NAMES: Record<AddressField, string> = {
	name: "The name on the address",
	line1: "The first address line",
	line2: "The second address line",
	city: "The city",
	state: "The state or region",
	postal_code: "The postal code",
};

export function addressTooLongMessage(field: AddressField): string {
	return `${ADDRESS_FIELD_NAMES[field]} is too long. Shorten it to 255 characters.`;
}

export function walletPromoRefused(code: string, message: string): string {
	return code ? `The code ${code} wasn't applied: ${message}` : message;
}

export function storeUpdated(message: string | null | undefined): boolean {
	return message === STORE_UPDATED;
}
export const PAYMENT_DETAILS_SILENT =
	"Your payment details didn't respond. Try again.";
export const STORAGE_BLOCKED =
	"Your browser is blocking storage this checkout needs to keep you from being charged twice. Allow this site to store data, or use another browser.";
export const ORDER_PROCESSING =
	"Your last payment for this order is still processing.";
export const ORDER_DECLINED =
	"This payment didn't go through; you can pay again.";
export const ORDER_CHARGING =
	"A payment for this order is in progress in another tab.";

// Only a cart checkout left a cart behind to go back to.
export function declinedNote(
	failure: string | null | undefined,
	fromCart: boolean,
): string {
	const reason = buyerMessage(failure, PAYMENT_NOT_CHARGED);
	return fromCart
		? `${reason} ${ORDER_DECLINED} Your cart is just as you left it.`
		: `${reason} ${ORDER_DECLINED}`;
}

export const ORDER_MARK_MESSAGES: Record<OrderMarkState, string> = {
	charging: ORDER_CHARGING,
	paid: ORDER_PAID,
	pending: ORDER_PROCESSING,
	declined: ORDER_DECLINED,
};
export const START_OVER_CONFIRM =
	"Forget your last payment and start over? If it went through, a receipt is on its way to your email.";
export const ATTEMPT_ELSEWHERE =
	"Your last payment, started on another page, is still being confirmed. Go back to it to finish.";
export const ATTEMPT_OTHER_ORDER =
	"Your last payment, for a different order, is still being confirmed. Start over to pay for this one.";
export const BANK_PAGE_UNOPENED = "If your bank's page didn't open, try again.";
export const PAYMENT_UNCONFIRMED =
	"We couldn't confirm your payment. Try again to pick up where it left off.";
export const CHARGE_RUNNING = "Processing your payment.";
export const PAYMENT_NOT_CHARGED =
	"Your payment was declined or canceled, so nothing has been charged.";
export const FINISH_VERIFYING =
	"Finish verifying your payment to complete your purchase.";
export const PAYMENT_FORM_NEEDED =
	"Your payment needs a step on the payment form, which didn't load. Reload the page or try again later.";
export const STILL_CONFIRMING =
	"We're still confirming your payment. Try again in a moment.";
export const ATTEMPT_CONFIRMING = "Your last payment is still being confirmed.";
export const ATTEMPT_PENDING =
	"Your last payment is still being confirmed. Paying now checks on it before anything new is charged.";
export function attemptNote(note: {
	elsewhere: { href: string | null } | null;
	payControl: boolean;
}): string {
	if (note.elsewhere) {
		return note.elsewhere.href ? ATTEMPT_ELSEWHERE : ATTEMPT_OTHER_ORDER;
	}
	return note.payControl ? ATTEMPT_PENDING : ATTEMPT_CONFIRMING;
}
export const QUOTE_HELD =
	"A payment already holds this order. Check your email for a receipt before paying again.";
export const ORDER_REFUSED = "This order can't be checked out.";
export const ITEM_UNAVAILABLE = "This order has an item that can't be bought.";
export const ITEM_GONE = "This item is no longer available.";
export const CART_ITEMS_GONE =
	"Some items in your cart are no longer available.";

export const ITEMS_SHORT =
	"The store has fewer of an item left than your order holds.";

// The gone-lines notice's button says what it does (`afterGoneLines`): on the
// cart's own checkout it changes the cart; on any other link it leaves the
// cart alone and goes on with what the link has left, or back to the store.
export function goneLinesButton(
	gone: ReadonlyArray<{ left?: number }>,
	after: { cart: unknown[] | null; lines: ReadonlyArray<{ quantity: number }> },
): string {
	const them = gone.length === 1 ? "it" : "them";
	const lowered = gone.filter((line) => line.left !== undefined);
	if (after.cart) {
		if (lowered.length > 0) return "Update your cart and continue";
		return after.lines.length > 0
			? `Remove ${them} and continue`
			: `Remove ${them} and go back to the store`;
	}
	const [only] = after.lines;
	if (!only) return "Go back to the store";
	if (lowered.length < gone.length) return "Continue with the rest";
	return after.lines.length === 1
		? `Continue with ${only.quantity}`
		: "Continue with what's left";
}

// One line's name when exactly one line asks for more than one, which is the
// line Whop refused; none when several do, as Whop names none of them.
export function onePerOrderMessage(
	line: { name: string | null } | null,
): string {
	if (!line) return "Some items in your order are limited to one per order.";
	return `${line.name || "An item in your order"} is limited to one per order.`;
}

export function goneLinesMessage(
	lines: ReadonlyArray<{ title: string | null; left?: number }>,
): string {
	const short = lines.flatMap((line) =>
		line.left === undefined
			? []
			: [`${line.title || "An item in your cart"} has only ${line.left} left.`],
	);
	const gone = lines.flatMap((line) =>
		line.left === undefined ? [line.title] : [],
	);
	return [...(gone.length > 0 ? [goneTitlesMessage(gone)] : []), ...short].join(
		" ",
	);
}

function goneTitlesMessage(titles: ReadonlyArray<string | null>): string {
	const named = titles.filter((title): title is string => Boolean(title));
	const unnamed = titles.length - named.length;
	const verb = titles.length === 1 ? "is" : "are";
	if (named.length === 0) {
		const lines = unnamed === 1 ? "An item" : `${unnamed} items`;
		return `${lines} in your cart ${verb} no longer available.`;
	}
	const others =
		unnamed === 0
			? []
			: [unnamed === 1 ? "1 other item" : `${unnamed} other items`];
	const listed = new Intl.ListFormat("en", { type: "conjunction" }).format([
		...named,
		...others,
	]);
	return `${listed} ${verb} no longer available.`;
}
export const MIXED_PAYMENT_METHODS =
	"These items take different payment methods, so they can't be bought together. Check them out separately.";
export const MIXED_CURRENCIES =
	"These items are sold in different currencies, so they can't be bought together. Check them out separately.";
export const MIXED_ITEMS =
	"These items can't be bought together. Check them out separately.";
export const CART_ITEM_ALONE =
	"Some items in your cart can only be bought on their own. Check them out separately.";
export const CART_STOCK_SHORT =
	"Some items in your cart don't have enough stock for this order. Lower their quantities or remove them.";
export const FREE_CART =
	"Free items can't be checked out together in a cart. Get each one on its own.";
export const TOO_MANY_ITEMS =
	"A cart can hold up to 50 different items. Remove some, then check out again.";
export const TAX_UNAVAILABLE =
	"We couldn't calculate tax for your order just now. Try again in a moment.";
// `tax`: the quote's missing tax caused it, which the page's own tax row already
// says, with its Try again.
// `continueTo` is a bank's page the buyer opens with their own press.
export type PageError = { message: string; tax: boolean; continueTo?: string };

export function pageError(
	message: string,
	tax = false,
	continueTo?: string,
): PageError {
	return continueTo ? { message, tax, continueTo } : { message, tax };
}

export function besideTaxRow(
	error: PageError | null,
	taxUnavailable: boolean,
): string | null {
	return !error || (taxUnavailable && error.tax) ? null : error.message;
}
export const PRICE_REFRESHED =
	"We refreshed your order's price. Check it over, then pay again.";
export const PRICE_CHANGED =
	"Your order's price changed. Check your total, then try again.";
export const ORDER_CHANGED =
	"Your order changed while it was being priced. Check it over, then pay again.";
export const PROMO_REFUSED = "That discount code can't be used.";
export const CHECKOUT_FAILED =
	"Part of checkout didn't load. Refresh the page to try again.";
export const WALLET_ADDRESS_NEEDED =
	"Choose a delivery address in the wallet to pay.";
export const WALLET_ADDRESS_UNPRICED =
	"We couldn't price your order for that address. Try again or use another address.";
export const BILLING_ADDRESS_NEEDED = "Enter a billing address to continue.";
export const DELIVERY_ADDRESS_NEEDED =
	"Enter your delivery address under Delivery to continue.";
export const PRICING_RETRYING =
	"We couldn't price your order just now. Trying again…";
export const ADDRESS_UNPLACED =
	"We couldn't place this delivery address for tax. Check it over and it will be priced again.";
export const QUOTE_UNAVAILABLE =
	"We couldn't update your order just now. Try again in a moment.";
export const PROMO_NOT_APPLIED = "This code can't be used for this order.";

export function promoAwaitingNote(awaiting: PromoAwaiting): string {
	return awaiting.until === "address"
		? `We'll apply ${awaiting.code} once your address is entered.`
		: `We'll apply ${awaiting.code} as soon as your order updates.`;
}
export const CURRENCY_REFUSED =
	"This order can't be paid in that currency. Pick another.";
export const SHEET_CURRENCY_CHANGED =
	"Your order is now priced in another currency. Close this and pay again.";

export const SHIP_COUNTRY_REFUSED = "We don't deliver to this country.";
export const SHEET_ADDRESS_UNPRICED =
	"We couldn't price your order for this address. Try another address.";

// `place` names the address a wallet priced when it isn't the page's own, so
// the page keeps its own total beside it.
export function totalChanged(quote: Quote, place?: string): string {
	const total = money(quote.total, quote.money);
	const changed = place
		? `For delivery to ${place}, your total is now ${total}.`
		: `Your total is now ${total}.`;
	return `${changed} Check your order, then pay again.`;
}

// A quote whose tax couldn't be worked out leaves tax out of its total, so that
// total is never told.
export function repricedMessage(
	next: Quote,
	seen: { total: number; currency: string },
	place?: string,
): string | null {
	if (next.taxStatus === "unavailable") return TAX_UNAVAILABLE;
	return next.total === seen.total && next.money.currency === seen.currency
		? null
		: totalChanged(next, place);
}

export function payInstead(amount: string, currency: string): string {
	return `Pay ${amount} in ${currency.toUpperCase()} instead`;
}

export function payInLocal(currency: string): string {
	return `Pay in ${currency.toUpperCase()} instead`;
}

export function taxRow(
	quote: Quote | null,
): { label: string; figure: string } | null {
	if (!quote) return { label: "Tax", figure: "Calculated from your address" };
	if (quote.taxStatus === "not_applicable") return null;
	// Before an address, tax not worked out yet is the normal state: only an
	// address quote missing it says so.
	if (quote.taxStatus === "unavailable") {
		return quote.estimated
			? { label: "Tax", figure: "Calculated from your address" }
			: { label: "Tax", figure: "Not available yet" };
	}
	// The wallet sheet leaves a $0 tax out too.
	if (quote.tax === 0) return null;
	const label = quote.estimated ? "Estimated tax" : "Tax";
	return {
		label: quote.taxBehavior === "inclusive" ? `${label} (included)` : label,
		figure: money(quote.tax, quote.money),
	};
}

export function taxNote(quote: Quote | null): string | null {
	if (!quote) return "Tax is calculated based on your delivery address.";
	if (quote.taxStatus === "unavailable") {
		return quote.estimated
			? "Tax is calculated based on your delivery address."
			: null;
	}
	if (quote.taxStatus === "not_applicable") return null;
	if (quote.tax === 0) {
		return quote.estimated
			? "Tax is calculated based on your delivery address."
			: null;
	}
	const basis =
		quote.taxBehavior === "inclusive"
			? "Prices include tax."
			: "Tax is added to the prices above.";
	return quote.estimated
		? `${basis} It is estimated from your location until you enter a delivery address.`
		: null;
}

export class BuyerError extends Error {
	readonly tax: boolean;
	readonly continueTo?: string;

	constructor(message: string, tax = false, continueTo?: string) {
		super(message);
		this.tax = tax;
		if (continueTo) this.continueTo = continueTo;
	}
}

// A payment only this page's payment form can finish: its attempt stays, and
// starting over isn't offered, since the payment may still go through.
export class StepWaitingError extends BuyerError {}

export function markedOrderError(mark: { state: OrderMarkState }): BuyerError {
	return new BuyerError(ORDER_MARK_MESSAGES[mark.state]);
}

// The words Elements' own payment element shows under a wallet method that is
// saved for later charges. A wallet sheet that saves the method for a renewal
// (`setupFutureUsage` "off_session") may be opened only once the buyer has
// seen them.
export function walletSaveConsent(wallets: readonly string[]): string {
	const named = new Intl.ListFormat("en", { type: "disjunction" }).format(
		wallets,
	);
	return `By continuing, you allow Whop to charge your ${named} for this payment and future payments in accordance with their Terms of Service.`;
}

export const BANK_STEP_BLOCKED =
	"Your bank needs you to finish this payment on its own page.";
export const CONTINUE_TO_BANK = "Continue to your bank";
export const BANK_STEP_UNREACHABLE =
	"Your bank's page couldn't open from here. Open this store in its own browser tab, then choose Confirm my payment.";

// Elements' handleNextAction rejects a full-page step the page embedding it
// won't let the tab leave for with a NextActionError coded
// TAB_NAVIGATION_BLOCKED, the bank's url on its `url`. A rejection that
// crossed Elements' frame keeps only the `[CODE]` prefix of its message. Only
// an https url is offered.
export function blockedBankStep(
	failure: unknown,
): { url: string | null } | null {
	const code = isRecord(failure) ? failure.code : undefined;
	const message = failure instanceof Error ? failure.message : "";
	if (
		code !== "TAB_NAVIGATION_BLOCKED" &&
		!message.startsWith("[TAB_NAVIGATION_BLOCKED]")
	) {
		return null;
	}
	const url = isRecord(failure) ? failure.url : undefined;
	if (typeof url !== "string") return { url: null };
	try {
		return new URL(url).protocol === "https:" ? { url } : { url: null };
	} catch {
		// Not a URL: no link is offered.
		return { url: null };
	}
}

// Whop's errors lead with a code for programs (`promo_code_invalid: …`).
export function buyerMessage(message: unknown, fallback: string): string {
	if (typeof message !== "string" || !message || isCode(message)) {
		return fallback;
	}
	return message.replace(/^[a-z_]+:\s*/, "");
}

export const CHECK_DETAILS = "Check your details and try again.";

const FIELD_ROOTS: Record<string, string> = {
	shipping_address: "delivery address",
	address: "billing address",
	billing_address: "billing address",
	promo_code: "promo code",
	presentment_currency: "currency",
	presentment_country: "country",
	tax_ids: "tax ID",
	email: "email",
	customer_email: "email",
};

const FIELD_LEAVES: Record<string, string> = {
	line1: "first line",
	line2: "second line",
	city: "city",
	state: "state or region",
	postal_code: "postal code",
	country: "country",
	name: "name",
};

// A request field Whop's API names in its own words: snake_case, or a path
// into the address (`shipping_address.line1`, `address.city`).
// The input validators lead with the field they checked; a snake_case word
// further into a sentence (`charge without quote_id …`) names no field the
// buyer sent.
const API_FIELD =
	/^(?:[a-z][a-z0-9]*_[a-z0-9_]*(?:\.[a-z0-9_]+)*|address(?:\.[a-z0-9_]+)+)\b/;

function fieldWords(path: string): string | null {
	const [root = "", leaf] = path.split(".");
	const rootWords = FIELD_ROOTS[root];
	if (!rootWords) return null;
	const leafWords = leaf === undefined ? undefined : FIELD_LEAVES[leaf];
	if (leaf !== undefined && !leafWords) return `the ${rootWords}`;
	return leafWords
		? `the ${leafWords} of the ${rootWords}`
		: `the ${rootWords}`;
}

// Whop refuses a cart it can't take as one payment with a `multi_item_…` code
// leading its message. The checkout doesn't check each rule first; each code
// is told as what the buyer can do about it. Most say the items can't share
// one payment (their seller, billing periods, trials, 3D Secure levels, tax
// and the rest), so the cart is split; some say an item can't be in a cart at
// all, that stock is short, or that a cart of free items isn't taken. A code
// not listed here (`multi_item_required`, which a cart of one line never
// meets) is the order's generic refusal.
const CART_REFUSAL = /^(multi_item_[a-z0-9_]*)(?::|$)/;

const CART_REFUSALS: Readonly<Record<string, string>> = {
	multi_item_limit_exceeded: TOO_MANY_ITEMS,
	multi_item_inventory_unavailable: CART_STOCK_SHORT,
	multi_item_free_unsupported: FREE_CART,
	multi_item_currency_mismatch: MIXED_CURRENCIES,
	multi_item_payment_configuration_mismatch: MIXED_PAYMENT_METHODS,
	multi_item_access_pass_required: CART_ITEM_ALONE,
	multi_item_product_type_unsupported: CART_ITEM_ALONE,
	multi_item_waitlist_unsupported: CART_ITEM_ALONE,
	multi_item_invoice_unsupported: CART_ITEM_ALONE,
	multi_item_installments_unsupported: CART_ITEM_ALONE,
	multi_item_customization_unsupported: CART_ITEM_ALONE,
	multi_item_seller_mismatch: MIXED_ITEMS,
	multi_item_tax_unsupported: MIXED_ITEMS,
	multi_item_tax_mismatch: MIXED_ITEMS,
	multi_item_billing_period_mismatch: MIXED_ITEMS,
	multi_item_trial_period_mismatch: MIXED_ITEMS,
	multi_item_adaptive_pricing_mismatch: MIXED_ITEMS,
	multi_item_buyer_fee_mismatch: MIXED_ITEMS,
	multi_item_three_ds_mismatch: MIXED_ITEMS,
	multi_item_expiration_mismatch: MIXED_ITEMS,
};

function cartRefusalCode(refusal: {
	code: string | null;
	message: string;
}): string | null {
	return (
		CART_REFUSAL.exec(refusal.code ?? "")?.[1] ??
		CART_REFUSAL.exec(refusal.message)?.[1] ??
		null
	);
}

export function cartRefused(refusal: {
	code: string | null;
	message: string;
}): boolean {
	return cartRefusalCode(refusal) !== null;
}

// Whop's v1 errors are `{ type, message, code? }`. A coded one is written for
// the buyer, as is a message led by its code (`plan_not_found: …`), the code
// dropped. An uncoded one is in words written for developers (`Payment quote
// not found`): an uncoded 400 that leads with a request field
// (`shipping_address.line1 must be at most 200 characters`) tells the buyer
// which detail to fix, never the field path, and any other is the generic
// refusal. The page's own refusals carry no status, and their words are the
// buyer's.
export function refusalMessage(
	refusal: { code: string | null; message: string; status: number | null },
	fallback: string,
): string {
	const cart = cartRefusalCode(refusal);
	if (cart !== null) return CART_REFUSALS[cart] ?? fallback;
	if (refusal.code === null && refusal.status !== null) {
		const field = API_FIELD.exec(refusal.message)?.[0];
		const coded = field && refusal.message.charAt(field.length) === ":";
		if (!coded) {
			if (refusal.status !== 400) return fallback;
			const words = field ? fieldWords(field) : null;
			if (words) return `Check your details: ${words} wasn't accepted.`;
			return field ? CHECK_DETAILS : fallback;
		}
	}
	return buyerMessage(refusal.message, fallback);
}

// Elements' createConfirmationToken rejects with a PaymentTokenizationError
// whose `buyerMessage` its own checkout shows the buyer. Across its frame that
// arrives as `[code] message`, the family's wire encoding. Only its own codes are read, so a developer error
// (`[BRANDING_HIDDEN] …`) never reaches the buyer; a tool-server test keeps the
// list equal to Elements'.
export const TOKENIZATION_CODES: ReadonlySet<string> = new Set([
	"billing_details_incomplete",
	"card_fields_not_ready",
	"card_tokenizer_session_failed",
	"card_number_validation_failed",
	"card_number_tokenization_failed",
	"card_session_authorization_failed",
	"card_expiry_validation_failed",
	"card_expiry_tokenization_failed",
	"card_cvc_validation_failed",
	"card_cvc_tokenization_failed",
	"bank_connection_unavailable",
	"confirmation_token_create_failed",
]);

export function tokenizationMessage(failure: unknown): string | null {
	if (!(failure instanceof Error)) return null;
	if (
		"buyerMessage" in failure &&
		typeof failure.buyerMessage === "string" &&
		"code" in failure &&
		typeof failure.code === "string" &&
		TOKENIZATION_CODES.has(failure.code)
	) {
		return failure.buyerMessage;
	}
	const wire = /^\[([a-z_]+)\] ([\s\S]*)$/.exec(failure.message);
	return wire?.[1] && TOKENIZATION_CODES.has(wire[1])
		? (wire[2] ?? null)
		: null;
}

const WALLET_NAMES = {
	apple_pay: "Apple Pay",
	google_pay: "Google Pay",
	paypal_express: "PayPal",
};

// Closing a wallet sheet, or Plaid Link inside createConfirmationToken, rejects
// with this code; it isn't a failure.
export function buyerCanceled(failure: unknown): boolean {
	return codeOf(failure) === "payment_request_cancelled";
}

export function unlessCanceled<T>(work: Promise<T>): Promise<T | null> {
	return work.catch((failure: unknown) => {
		if (buyerCanceled(failure)) return null;
		throw failure;
	});
}

// A step the buyer takes inside the token (a bank's sign-in) finishes within
// NEXT_ACTION_MS, as a payment's next action does. Past it Elements' frame has
// stopped answering: the button is given back, with nothing charged or kept.
export function tokenUnlessCanceled<T>(work: Promise<T>): Promise<T | null> {
	return unlessCanceled(within(work, NEXT_ACTION_MS)).catch(
		(failure: unknown) => {
			if (failure instanceof NoAnswer) {
				throw new BuyerError(PAYMENT_DETAILS_SILENT);
			}
			throw failure;
		},
	);
}

// Elements keeps a failed wallet's own wording internal and only names the
// stage it failed at (`wallet_<stage>_failed`).
export function walletMessage(
	failure: unknown,
	wallet: keyof typeof WALLET_NAMES,
): string {
	const name = WALLET_NAMES[wallet];
	switch (codeOf(failure)) {
		case "wallet_start_failed":
			return `${name} couldn't open. Try again or pay another way.`;
		case "wallet_approval_failed":
			return `${name} didn't approve the payment. Try again or pay another way.`;
		case "wallet_token_failed":
			return `${name} couldn't share ${wallet === "paypal_express" ? "your payment details" : "your card"}. Try again or pay another way.`;
		default:
			return `${name} couldn't finish. Try again or pay another way.`;
	}
}

function isCode(message: string): boolean {
	return /^[a-z][a-z0-9_]*$/.test(message);
}

// By shape rather than `instanceof`, so it holds whichever realm built the
// error.
function codeOf(failure: unknown): string | null {
	if (!isRecord(failure)) return null;
	const { code, message } = failure;
	if (typeof code === "string" && code) return code;
	return typeof message === "string" && isCode(message) ? message : null;
}

export function promoRefused(failure: unknown): boolean {
	return codeOf(failure)?.startsWith("promo_") ?? false;
}

export function promoMessage(failure: unknown): string {
	return failure instanceof Error
		? buyerMessage(failure.message, PROMO_REFUSED)
		: PROMO_REFUSED;
}
