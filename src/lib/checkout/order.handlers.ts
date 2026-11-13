import {
	isRecord,
	ORDER_COMPLETE_PATH,
	ORDER_PARAM,
	PAYMENT_ID,
	RETURN_TOKEN_PARAM,
} from "./shared";
import {
	CHARGE_KEY,
	type ChargedPayment,
	IN_PROGRESS_CODE,
	ITEMS_REFUSED_CODE,
	KEY_MISMATCH_CODE,
	LOCATION_REQUIRED_CODE,
	NOT_SENT_CODE,
	PROMO_REFUSED_CODE,
	QUOTE_IN_USE_CODE,
	STALE_QUOTE_CODES,
	STORE_UNAVAILABLE_CODE,
	STORE_UPDATED_CODE,
	TAX_UNAVAILABLE_CODE,
	type QuoteReading,
	type Refusal,
} from "./charge-attempt";
import { type PaymentState } from "./payment-state";
import {
	type Address,
	addressOf,
	AFFILIATE_CODE,
	promoCodeOk,
	formatOf,
	futureUsageFor,
	isLineQuantity,
	type MethodsRead,
	type MoneyFormat,
	mergeItems,
	NO_WALLETS,
	type Order,
	type OrderItem,
	type OrderLine,
	PAYABLE_MARGIN_MS,
	configurationKey,
	type GoneLine,
	type PaymentMethodConfiguration,
	type PolicyLink,
	planLinePrices,
	type Seller,
	shownByStore,
	stockLimited,
	unitsForSale,
} from "./order";
import {
	CART_ITEMS_GONE,
	cartRefused,
	onePerOrderMessage,
	CHARGE_NOT_SENT,
	PAYMENTS_UNAVAILABLE,
	ITEM_GONE,
	ITEMS_SHORT,
	ITEM_UNAVAILABLE,
	MIXED_CURRENCIES,
	MIXED_PAYMENT_METHODS,
	ORDER_REFUSED,
	PROMO_REFUSED,
	SHIP_COUNTRY_REFUSED,
	STORE_UPDATED,
	TOO_MANY_ITEMS,
} from "./messages";
import {
	CHARGE_BUDGET_MS,
	CHARGE_LEAST_MS,
	LOAD_ORDER_MS,
	NoAnswer,
	PAGE_READ_MS,
	within,
} from "./deadline";
import {
	type Call,
	type Payments,
	type QuoteCall,
	type VariantCall,
	type WhopPayment,
	type WhopPaymentQuote,
	type WhopPaymentStatus,
	type WhopVariant,
} from "./whop-api";
import { createExpiringMap, type ExpiringMap } from "./expiring-map";
import {
	AUTO,
	isCountryPick,
	presentmentOfInput,
	presentmentParams,
} from "./presentment";
import {
	CHECKOUT_SETTINGS,
	settingsFingerprint,
	shipCountries,
	shipsTo,
} from "./settings";

// The browser names plans and quotes, never whose they are: every call is for
// `store`, the account from the server's environment.

// Whop's own 403, `{ error: { type: "forbidden", message } }`: the store's key
// may not read or do this. A 403 Whop didn't write (an edge in front of it
// blocking the call) is none.
export function whopForbidden(failure: unknown): boolean {
	return (
		failure instanceof Error &&
		"statusCode" in failure &&
		failure.statusCode === 403 &&
		"body" in failure &&
		isRecord(failure.body) &&
		isRecord(failure.body.error) &&
		failure.body.error.type === "forbidden"
	);
}

// A read of an id the buyer sent that Whop refused with its own 403. It may be
// another store's, or the store's key may lack the scope to read the store's
// own, and Whop's answer doesn't say which, so a payment or quote read reads it
// as unanswered, never as gone, and never keeps it. It is no answer from Whop
// to `refusalOf`, and `logFailure` logs it with that scope hint.
export class UnreadId extends Error {
	constructor(readonly refused: unknown) {
		super(
			refused instanceof Error
				? refused.message
				: "Whop refused to show an id the buyer sent.",
		);
	}
}

export function unreadIfForbidden(failure: unknown): unknown {
	return whopForbidden(failure) ? new UnreadId(failure) : failure;
}

// No answer from Whop (a timeout, a dropped connection, a call never sent):
// the page sends a charge again under its key, and reads again.
export const NO_ANSWER: Refusal = {
	code: null,
	message: "Checkout could not continue.",
	status: null,
};

// Whop's answer an error carries, as @whop/sdk's WhopError holds it: its
// status and, for a v1 error, its code and message. Anything else (a timeout,
// a dropped connection, the store's own setup) is no answer.
export function refusalOf(failure: unknown): Refusal {
	const fallback = NO_ANSWER.message;
	if (
		!(failure instanceof Error) ||
		!("statusCode" in failure) ||
		typeof failure.statusCode !== "number"
	) {
		return NO_ANSWER;
	}
	const status = failure.statusCode;
	const body = "body" in failure && isRecord(failure.body) ? failure.body : {};
	const error = body.error;
	// A revoked key (401), or one Whop says lacks a scope or access
	// (`whopForbidden`), is the store's to fix, and Whop's text for it is
	// written for the developer, so the buyer reads only that the store can't
	// take payments. A 403 Whop didn't write is no answer from Whop.
	if (status === 401 || whopForbidden(failure)) {
		return {
			code: STORE_UNAVAILABLE_CODE,
			message: PAYMENTS_UNAVAILABLE,
			status,
		};
	}
	if (status === 403) return NO_ANSWER;
	if (!isRecord(error)) return { code: null, message: fallback, status };
	return {
		code: typeof error.code === "string" ? error.code : null,
		message: typeof error.message === "string" ? error.message : fallback,
		status,
	};
}

// One line in the store's hosting logs for each failure its owner may need to
// see: Whop or the network not answering, the store's own setup throwing, or
// Whop refusing what the store sent (its key, its account, an API version Whop
// no longer serves, a request whose shape it no longer takes). A refusal that
// is the buyer's outcome logs nothing: one the page tells the buyer
// (`BUYER_OUTCOMES`, a cart that can't share one payment), or a 404 for an id
// the buyer sent, where the caller says its ids are the buyer's.
export function logFailure(
	where: string,
	failure: unknown,
	ids: { buyerIds?: true } = {},
) {
	const refusal = refusalOf(failure);
	const message = failure instanceof Error ? failure.message : String(failure);
	if (failure instanceof UnreadId) {
		console.error(
			`[storefront] ${where}: Whop refused to show an id the buyer sent (403). It may be another store's; if the store's own ids get this too, its API key lacks the scope to read them.`,
			message,
		);
		return;
	}
	if (refusal.code === STORE_UNAVAILABLE_CODE) {
		console.error(
			`[storefront] Checkout can't take payments: Whop refused the store's API key (${refusal.status}).`,
			message,
		);
		return;
	}
	if (
		(refusal.code !== null && BUYER_OUTCOMES.has(refusal.code)) ||
		cartRefused(refusal) ||
		(ids.buyerIds && refusal.status === 404)
	) {
		return;
	}
	console.error(`[storefront] ${where} failed.`, message);
}

export const STORE_REFUSAL: Refusal = {
	code: "store_account_mismatch",
	message: "This order can't be checked out here.",
	status: 400,
};

const SHIP_REFUSED_CODE = "shipping_address_unserviceable";
export const ONE_PER_ORDER_CODE = "one_per_order";

export const STORE_UPDATED_REFUSAL: Refusal = {
	code: STORE_UPDATED_CODE,
	message: STORE_UPDATED,
	status: null,
};

export function currentSettings(data: unknown): boolean {
	return isRecord(data) && data.settings === settingsFingerprint();
}

const SHIP_REFUSAL: Refusal = {
	code: SHIP_REFUSED_CODE,
	message: SHIP_COUNTRY_REFUSED,
	status: 400,
};

// The refusals the page tells the buyer as their order's outcome: a quote or
// promo code it can't use any more (charge-flow.ts `handleRefusal`), a quote
// waiting on the buyer's address (quote-flow.ts `quoteFailure`), a send under
// a key already running or used for another (`settleAttempt`), and this
// server's own (ship country, items gone, a page built under other settings).
const BUYER_OUTCOMES: ReadonlySet<string> = new Set([
	...STALE_QUOTE_CODES,
	QUOTE_IN_USE_CODE,
	TAX_UNAVAILABLE_CODE,
	LOCATION_REQUIRED_CODE,
	IN_PROGRESS_CODE,
	KEY_MISMATCH_CODE,
	SHIP_REFUSED_CODE,
	ITEMS_REFUSED_CODE,
	STORE_UPDATED_CODE,
	ONE_PER_ORDER_CODE,
]);

// Whop's own cart limits, checked before any call on the store's key: anyone
// can call these server functions.
export const MAX_ORDER_LINES = 50;
// Far past any cart: a longer array is refused before it is read.
export const MAX_SENT_LINES = 200;
const VARIANT_ID = /^plan_[A-Za-z0-9]+$/;

function priceable(item: unknown): item is OrderItem {
	return (
		isRecord(item) &&
		typeof item.planId === "string" &&
		VARIANT_ID.test(item.planId) &&
		isLineQuantity(item.quantity)
	);
}

export function itemsRefusal(items: readonly OrderItem[]): string | null {
	if (items.length > MAX_ORDER_LINES) return TOO_MANY_ITEMS;
	return items.length > 0 && items.every(priceable) ? null : ITEM_UNAVAILABLE;
}

// Anyone can send any JSON to the server functions. Each line is checked as
// sent, before the lines naming one plan are merged, so two half units never
// make one.
export function linesOf(items: unknown): OrderItem[] | string {
	if (!Array.isArray(items)) return ITEM_UNAVAILABLE;
	if (items.length > MAX_SENT_LINES) return TOO_MANY_ITEMS;
	if (!items.every(priceable)) return ITEM_UNAVAILABLE;
	return mergeItems(items);
}

// A cart order names the lines it can't sell, so the buyer can drop them and
// go on with the rest.
// `updated`: the page was built under other settings (`currentSettings`).
export type OrderRefusal = {
	refused: string;
	gone?: GoneLine[];
	updated?: true;
};

export type PricedLine = {
	line: OrderLine;
	money: MoneyFormat;
	seller: Seller | null;
	paymentMethodConfiguration?: PaymentMethodConfiguration;
	planType: string;
	// How many one order can buy (`unitsForSale`).
	forSale: number;
	// Whether the variant's stock is limited, so whether it's for sale can
	// change without the seller editing it.
	limitedStock?: boolean;
	forInvoice?: boolean;
	// When Whop answered the variant's read (`KeptVariant`).
	readAt?: number;
	// Whether the storefront shows the variant itself (`shownByStore`): only
	// then do Whop's titles for it go back to whoever named it.
	shown: boolean;
};

type Variant = Pick<
	WhopVariant,
	| "title"
	| "image"
	| "product"
	| "account"
	| "initial_price"
	| "initial_price_due"
	| "strike_through_initial_price"
	| "strike_through_renewal_price"
	| "effective_payment_method_configuration"
	| "plan_type"
	| "invoice"
	| "release_method"
	| "stock"
	| "unlimited_stock"
	| "visibility"
>;

export type KeptVariant = Omit<Variant, "image" | "product"> & {
	image: { url: string } | null;
	product: { id?: string; title: string } | null;
	// When Whop answered the read, so what is kept from it expires from then.
	readAt?: number;
};

export type VariantApi = {
	variants: { retrieve: Call<VariantCall, Variant> };
};

export type KeptVariantApi = {
	variants: { retrieve: Call<VariantCall, KeptVariant | null> };
};

// Reads on the store's key are kept, so anyone calling these server functions
// can't spend the key on the same reads over and over. Only finished data is
// kept across requests: a Worker can't wait on I/O another request started
// (workerd: "Cannot perform I/O on behalf of a different request"), and that
// request's reads can be cut off when it ends. Nothing lists the catalog: on a
// large store a listing outlasts a checkout's budget.
export const KEPT_FOR_MS = 60_000;
export const REFUSED_KEPT_MS = 10_000;
export const MOST_KEPT = 1_000;

export type StoreReads = {
	variants: ExpiringMap<KeptVariant>;
	refused: ExpiringMap<KeptVariant | null>;
	now: () => number;
};

export function createStoreReads(now: () => number = Date.now): StoreReads {
	return {
		variants: createExpiringMap(MOST_KEPT),
		refused: createExpiringMap(MOST_KEPT),
		now,
	};
}

export function keptVariant(variant: Variant): KeptVariant {
	const { image, product, account, initial_price_due: due } = variant;
	const configuration = variant.effective_payment_method_configuration;
	return {
		title: variant.title,
		image:
			isRecord(image) && typeof image.url === "string"
				? { url: image.url }
				: null,
		product:
			isRecord(product) && typeof product.title === "string"
				? {
						...(typeof product.id === "string" ? { id: product.id } : {}),
						title: product.title,
					}
				: null,
		account: account ? { id: account.id, title: account.title } : null,
		initial_price: variant.initial_price,
		initial_price_due: {
			amount: due.amount,
			currency: due.currency,
			decimals: due.decimals,
			display_decimals: due.display_decimals,
		},
		strike_through_initial_price: variant.strike_through_initial_price,
		strike_through_renewal_price: variant.strike_through_renewal_price,
		effective_payment_method_configuration: configuration
			? {
					enabled: configuration.enabled,
					disabled: configuration.disabled,
					include_platform_defaults: configuration.include_platform_defaults,
				}
			: null,
		plan_type: variant.plan_type,
		invoice: variant.invoice === null ? null : {},
		release_method: variant.release_method,
		stock: variant.stock,
		unlimited_stock: variant.unlimited_stock,
		visibility: variant.visibility,
	};
}

export function keptVariantApi(
	api: VariantApi,
	store: string,
	reads: StoreReads,
	missing: (failure: unknown) => boolean,
): KeptVariantApi {
	const reading = new Map<string, Promise<KeptVariant | null>>();
	const readVariant = (id: string): Promise<KeptVariant | null> => {
		const now = reads.now();
		const known = reads.variants.get(id, now);
		if (known) return Promise.resolve(known);
		const refused = reads.refused.get(id, now);
		if (refused !== undefined) return Promise.resolve(refused);
		const running = reading.get(id);
		if (running) return running;
		const read = Promise.resolve(api.variants.retrieve({ id }))
			.then(
				(read) => {
					const at = reads.now();
					const variant = { ...keptVariant(read), readAt: at };
					if (variant.account?.id === store) {
						reads.variants.set(id, variant, at + KEPT_FOR_MS, at);
					} else {
						reads.refused.set(id, variant, at + REFUSED_KEPT_MS, at);
					}
					return variant;
				},
				(failure: unknown) => {
					// Only a 404 is no such variant. Whop reads a variant for
					// anyone, another account's included, so its own 403 here is
					// the store's key: no answer about the line, never kept, and
					// the store can't take payments (`refusalOf`).
					if (!missing(failure)) throw failure;
					const at = reads.now();
					reads.refused.set(id, null, at + REFUSED_KEPT_MS, at);
					return null;
				},
			)
			.finally(() => reading.delete(id));
		reading.set(id, read);
		return read;
	};
	return { variants: { retrieve: ({ id }) => readVariant(id) } };
}

// Whop has no read for a list of variants by id (@whop/sdk 2.4's
// `variants.list` filters by product, and its items carry no
// `effective_payment_method_configuration`), so each is read on its own, a few
// at a time on the store's key. A Worker opens at most six connections at
// once per request and queues the rest, and a queued read's wait counts
// against its own deadline, so more at once would only time reads out.
export const READS_AT_ONCE = 6;

// Every round of reads a cart needs gets a page read's whole budget, so a cart
// of up to MAX_ORDER_LINES loads however long it is.
export function loadOrderMs(
	lines: number,
	lanes: number = READS_AT_ONCE,
): number {
	return Math.max(LOAD_ORDER_MS, Math.ceil(lines / lanes) * PAGE_READ_MS);
}

export async function readEach<T, R>(
	items: readonly T[],
	read: (item: T) => PromiseLike<R>,
	lanes: number = READS_AT_ONCE,
): Promise<R[]> {
	const results: R[] = [];
	let next = 0;
	let failed = false;
	const reader = async () => {
		while (!failed && next < items.length) {
			const index = next;
			next += 1;
			try {
				results[index] = await read(items[index]);
			} catch (failure) {
				failed = true;
				throw failure;
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(lanes, items.length) }, reader),
	);
	return results;
}

// Only an id Whop doesn't know (a null read) means the plan is gone; any
// other failure is thrown, so the checkout says it couldn't load rather than
// that the product is gone. A line's image is the variant's own, on the same
// read; no product is read for one, and the page fills a line without one from
// the cart the buyer built (`withCartImages`).
export async function planLines(
	api: KeptVariantApi,
	items: readonly OrderItem[],
	lanes: number = READS_AT_ONCE,
): Promise<Array<PricedLine | null>> {
	const plans = await readEach(
		items,
		(item) => api.variants.retrieve({ id: item.planId }),
		lanes,
	);
	return plans.map((plan, index) => {
		const item = items[index];
		if (!plan || !item) return null;
		const productTitle = plan.product?.title;
		return {
			line: {
				planId: item.planId,
				...(plan.product?.id ? { productId: plan.product.id } : {}),
				title: productTitle ?? plan.title ?? "",
				subtitle: productTitle ? (plan.title ?? "") : "",
				image: plan.image?.url ?? "",
				quantity: item.quantity,
				...planLinePrices({
					dueToday: plan.initial_price_due,
					initialPrice: plan.initial_price,
					struckInitialPrice: plan.strike_through_initial_price,
					struckRenewalPrice: plan.strike_through_renewal_price,
					quantity: item.quantity,
				}),
			},
			money: formatOf(plan.initial_price_due),
			seller: plan.account
				? { accountId: plan.account.id, name: plan.account.title }
				: null,
			paymentMethodConfiguration:
				plan.effective_payment_method_configuration ?? undefined,
			planType: plan.plan_type,
			...saleOf(plan),
			shown: shownByStore(plan),
		};
	});
}

export const DOCUMENTS_REFUSED = "refused";

export type DocumentsRead = PolicyLink[] | typeof DOCUMENTS_REFUSED | null;

export type KeptDocuments = ExpiringMap<
	PolicyLink[] | typeof DOCUMENTS_REFUSED
>;

export function createKeptDocuments(): KeptDocuments {
	return createExpiringMap(1);
}

// Kept like the variant reads, so a client asking for terms on every call
// can't spend the store's key on each; a refused read is kept as long. A read
// that may answer next time (`sellerDocuments` answers null, or the deadline
// passes) isn't kept, and is null: unlike a seller who published none, it
// leaves the terms unknown. Anything else throws. The read logs its own
// failure, the call its deadline aborted included (`sellerDocuments`).
export async function keptDocuments(
	kept: KeptDocuments,
	store: string,
	read: () => PromiseLike<DocumentsRead>,
	now: () => number = Date.now,
): Promise<DocumentsRead> {
	const known = kept.get(store, now());
	if (known) return known;
	const documents = await Promise.resolve(read()).catch((failure: unknown) => {
		if (!(failure instanceof NoAnswer)) throw failure;
		return null;
	});
	if (!documents) return null;
	const at = now();
	kept.set(store, documents, at + KEPT_FOR_MS, at);
	return documents;
}

// Whether a variant was generated for an invoice, is on a waitlist, or is
// archived changes only when the seller edits it, so a server reads each
// variant for it at most every few minutes, not on every quote, and keeps at
// most MOST_KEPT of them: one of the store's own for 5 minutes, for sale or not
// (a waitlist, archived), so a variant moved onto or off a waitlist, archived
// or restored, is seen soon after, and one generated for an invoice or another
// account's for the hour, so a public quote naming it isn't read again on
// every call. One with limited stock can sell out at any time, so its answer
// is kept only as long as a variant read (KEPT_FOR_MS). One Whop doesn't know
// is kept only as long as a refused read (REFUSED_KEPT_MS), which already
// stops a burst of quotes naming it from reading it each time. The product
// page's own reads answer too (`rememberVariantSales`), and an answer never
// replaces one Whop gave later: an order's lines can come from a variant read
// up to KEPT_FOR_MS old, which a product page's fresh read of a sold-out
// variant outranks. Each answer is how many one order can buy
// (`unitsForSale`), none for a variant that isn't this store's. As with the
// variant reads, the store's own variants (`own`) are kept apart from ids Whop
// doesn't know and other accounts' (`others`), each up to MOST_KEPT, so a
// flood of made-up ids never pushes out a real answer.
type KeptSale = { forSale: number; readAt: number };

export type StoreSales = {
	own: ExpiringMap<KeptSale>;
	others: ExpiringMap<KeptSale>;
};

export const SALES_KEPT_MS = 60 * 60_000;
export const FOR_SALE_KEPT_MS = 5 * 60_000;

export function createStoreSales(): StoreSales {
	return {
		own: createExpiringMap(MOST_KEPT),
		others: createExpiringMap(MOST_KEPT),
	};
}

function keptSaleOf(
	sales: StoreSales,
	planId: string,
	now: number,
): KeptSale | undefined {
	return sales.own.get(planId, now) ?? sales.others.get(planId, now);
}

export function keptSale(
	sales: StoreSales,
	planId: string,
	now: number,
): number | undefined {
	return keptSaleOf(sales, planId, now)?.forSale;
}

type SaleRead = {
	seller: Pick<Seller, "accountId"> | null;
	forSale: number;
	limitedStock?: boolean;
	forInvoice?: boolean;
	readAt?: number;
} | null;

// Each answer is kept from when Whop gave it, so a kept read's own age counts
// against it.
function rememberSales(
	sales: StoreSales,
	store: string,
	items: readonly OrderItem[],
	lines: readonly SaleRead[],
	now: number,
) {
	lines.forEach((entry, index) => {
		const item = items[index];
		if (!item) return;
		const readAt = entry?.readAt ?? now;
		const kept = keptSaleOf(sales, item.planId, now);
		if (kept && kept.readAt > readAt) return;
		const forSale = soldHere(entry, store);
		const own = entry?.seller?.accountId === store;
		const keptFor = !entry
			? REFUSED_KEPT_MS
			: entry.limitedStock
				? KEPT_FOR_MS
				: own && !entry.forInvoice
					? FOR_SALE_KEPT_MS
					: SALES_KEPT_MS;
		(own ? sales.others : sales.own).delete(item.planId);
		(own ? sales.own : sales.others).set(
			item.planId,
			{ forSale, readAt },
			readAt + keptFor,
			now,
		);
	});
}

function soldHere(entry: SaleRead, store: string): number {
	return entry?.seller?.accountId === store ? entry.forSale : 0;
}

// What a variant's read says about selling it, for the sale check's cache and
// for an order's lines alike.
function saleOf(
	variant: Record<string, unknown>,
): Omit<NonNullable<SaleRead>, "seller"> {
	return {
		forSale: unitsForSale(variant),
		limitedStock: stockLimited(variant),
		forInvoice: variant.invoice !== null,
		...(typeof variant.readAt === "number" ? { readAt: variant.readAt } : {}),
	};
}

function saleReadOf(variant: unknown): SaleRead {
	if (!isRecord(variant)) return null;
	const { account } = variant;
	return {
		seller:
			isRecord(account) && typeof account.id === "string"
				? { accountId: account.id }
				: null,
		...saleOf(variant),
	};
}

// The product page reads its variants fresh on every view, so what it read
// answers the sale check too: a variant moved off a waitlist sells as soon as
// its page is viewed.
export function rememberVariantSales(
	sales: StoreSales,
	store: string,
	variants: readonly unknown[],
	now: number = Date.now(),
) {
	const read = variants.filter(
		(variant): variant is Record<string, unknown> & { id: string } =>
			isRecord(variant) && typeof variant.id === "string",
	);
	rememberSales(
		sales,
		store,
		read.map((variant) => ({ planId: variant.id, quantity: 1 })),
		read.map(saleReadOf),
		now,
	);
}

export async function itemsRefusedForSale(
	api: KeptVariantApi,
	store: string,
	items: readonly OrderItem[],
	sales: StoreSales,
	now: () => number = Date.now,
): Promise<Refusal | null> {
	// Decided from what the cache held before the reads and what the reads
	// found, never the cache read again: an answer that expires, or is pushed
	// out, while the reads run would otherwise let its line through.
	const before = now();
	const kept = new Map(
		items.map((item) => [item.planId, keptSale(sales, item.planId, before)]),
	);
	const unread = items.filter((item) => kept.get(item.planId) === undefined);
	const variants = await readEach(unread, (item) =>
		api.variants.retrieve({ id: item.planId }),
	);
	const read: SaleRead[] = variants.map(saleReadOf);
	rememberSales(sales, store, unread, read, now());
	const found = new Map(
		unread.map((item, index) => [
			item.planId,
			soldHere(read[index] ?? null, store),
		]),
	);
	const forSale = items.map(
		(item) => kept.get(item.planId) ?? found.get(item.planId) ?? 0,
	);
	if (forSale.some((units) => units === 0)) {
		return { code: ITEMS_REFUSED_CODE, message: ITEM_GONE, status: 400 };
	}
	return items.some((item, index) => item.quantity > (forSale[index] ?? 0))
		? { code: ITEMS_REFUSED_CODE, message: ITEMS_SHORT, status: 400 }
		: null;
}

// The check costs nothing once this isolate has read each variant (`sales`),
// so checking before every quote leaves no quote made for a line not for sale.
export async function quoteWithSaleCheck<Q>(
	check: () => PromiseLike<Refusal | null>,
	quote: () => PromiseLike<Q>,
	ms: number,
): Promise<{ quote: Q } | { refusal: Refusal }> {
	const refusal = await within(check(), ms);
	return refusal ? { refusal } : { quote: await quote() };
}

export type OrderRequest = {
	planId: string;
	quantity: number;
	items: OrderItem[];
	withTerms?: boolean;
	settings?: string;
};

export async function loadOrderFor(
	deps: {
		store: string;
		linesFor: (
			items: OrderItem[],
			lanes: number,
		) => Promise<Array<PricedLine | null>>;
		documents: () => Promise<DocumentsRead>;
		sales: StoreSales;
		deadlineMs?: number;
	},
	data: unknown,
): Promise<Order | OrderRefusal | null> {
	const request = isRecord(data) ? data : {};
	const cart = linesOf(request.items);
	if (typeof cart === "string") return { refused: cart };
	const fromCart = cart.length > 0;
	const single = { planId: request.planId, quantity: request.quantity };
	const wanted = fromCart ? cart : priceable(single) ? [single] : [];
	const refused = itemsRefusal(wanted);
	if (refused) return { refused };
	// The seller's documents are read beside the lines, one of the six reads
	// at once.
	const withTerms = request.withTerms === true;
	const lanes = withTerms ? READS_AT_ONCE - 1 : READS_AT_ONCE;
	let read: [Array<PricedLine | null>, DocumentsRead | undefined];
	try {
		read = await within(
			Promise.all([
				deps.linesFor(wanted, lanes),
				withTerms ? deps.documents() : undefined,
			]),
			deps.deadlineMs ?? loadOrderMs(wanted.length, lanes),
		);
	} catch (failure) {
		// The store's key refused (`keptVariantApi`): no line is gone, so the
		// cart is left as it is, and the store can't take payments.
		if (refusalOf(failure).code !== STORE_UNAVAILABLE_CODE) throw failure;
		logFailure("Reading the order's variants", failure);
		return { refused: PAYMENTS_UNAVAILABLE };
	}
	const [lines, sellerDocuments] = read;
	rememberSales(deps.sales, deps.store, wanted, lines, Date.now());
	const ours = (
		entry: PricedLine | null | undefined,
	): entry is PricedLine & { seller: Seller } =>
		entry?.seller?.accountId === deps.store;
	if (fromCart) {
		const gone = wanted.flatMap((item, index): GoneLine[] => {
			const entry = lines[index];
			if (ours(entry) && item.quantity <= entry.forSale) return [];
			const title = ours(entry) ? shownName(entry) : null;
			const left = ours(entry) ? entry.forSale : 0;
			return [{ planId: item.planId, title, ...(left > 0 ? { left } : {}) }];
		});
		if (gone.length > 0) return { refused: CART_ITEMS_GONE, gone };
	}
	if (lines.length !== wanted.length || !lines.every(ours)) return null;
	const [first] = lines;
	if (!lines.every((entry) => entry.forSale > 0)) return { refused: ITEM_GONE };
	// A plan's own link asking for more than is left is named as a cart's
	// short line is, so the buyer can go on with what is left.
	const short = lines.find((entry) => entry.line.quantity > entry.forSale);
	if (short) {
		return {
			refused: ITEMS_SHORT,
			gone: [
				{
					planId: short.line.planId,
					title: shownName(short),
					left: short.forSale,
				},
			],
		};
	}
	if (lines.some((entry) => entry.money.currency !== first.money.currency)) {
		return { refused: MIXED_CURRENCIES };
	}
	// Whop refuses to quote a cart whose plans resolve to different
	// configurations (multi_item_payment_configuration_mismatch).
	if (
		new Set(
			lines.map((entry) => configurationKey(entry.paymentMethodConfiguration)),
		).size > 1
	) {
		return { refused: MIXED_PAYMENT_METHODS };
	}
	const setupFutureUsage = futureUsageFor(lines.map((entry) => entry.planType));
	return {
		money: first.money,
		lines: lines.map((entry) => entry.line),
		seller: first.seller,
		origin: fromCart ? "cart" : "link",
		...(Array.isArray(sellerDocuments) ? { sellerDocuments } : {}),
		...(sellerDocuments === null ? { policiesUnread: true } : {}),
		...(sellerDocuments === DOCUMENTS_REFUSED ? { policiesRefused: true } : {}),
		paymentMethodConfiguration: first.paymentMethodConfiguration,
		...(setupFutureUsage ? { setupFutureUsage } : {}),
	};
}

// Whop's titles name only a variant the store shows: one generated for an
// invoice, or hidden or archived, can name a customer, so it goes by the
// cart's own title for it, or none.
function shownName(entry: PricedLine | null): string | null {
	if (!entry?.shown) return null;
	const { line } = entry;
	return line.subtitle
		? `${line.title} – ${line.subtitle}`
		: line.title || null;
}

// Whop's quote refuses more than one of a variant its seller sells one per
// order with an uncoded 400 in these words. The v1 API doesn't show that
// setting on a variant, so the store learns it only from this refusal, and
// names the line that asked for more than one, as a line short of stock is
// named.
const WHOP_ONE_PER_ORDER = "You can only purchase one per order";

export async function onePerOrderRefusal(
	refusal: Refusal,
	items: readonly OrderItem[],
	api: () => KeptVariantApi,
): Promise<Refusal | null> {
	if (
		refusal.code !== null ||
		refusal.status !== 400 ||
		refusal.message !== WHOP_ONE_PER_ORDER
	) {
		return null;
	}
	const many = items.filter((item) => item.quantity > 1);
	const [only] = many;
	return {
		code: ONE_PER_ORDER_CODE,
		message: onePerOrderMessage(
			many.length === 1 && only ? { name: await nameOf(api, only) } : null,
		),
		status: 400,
	};
}

async function nameOf(
	api: () => KeptVariantApi,
	item: OrderItem,
): Promise<string | null> {
	try {
		const [entry] = await planLines(api(), [item]);
		return shownName(entry ?? null);
	} catch {
		// A read that fails leaves the line unnamed; the refusal stands.
		return null;
	}
}

export type QuoteRequest = {
	items: OrderItem[];
	settings?: string;
	promoCode?: string;
	shippingAddress?: Address;
	presentment?: string;
};

// Merged once, so the lines checked are the lines quoted.
export function quoteItems(
	data: unknown,
): { items: OrderItem[] } | { refusal: Refusal } {
	const refusal = (message: string) => ({
		refusal: { code: ITEMS_REFUSED_CODE, message, status: 400 },
	});
	const items = linesOf(isRecord(data) ? data.items : null);
	if (typeof items === "string") return refusal(items);
	const refused = itemsRefusal(items);
	return refused ? refusal(refused) : { items };
}

// What the browser sends is checked before it reaches Whop on the store's key:
// Whop's own limits (a promo code as `promoCodeOk` reads it, an address as
// `addressOf` does), and only the fields a call reads.
const REFUSED_INPUT: Refusal = {
	code: "invalid_request",
	message: ORDER_REFUSED,
	status: 400,
};
// A code Whop would refuse is refused as Whop refuses one, so the page drops
// it and prices the order without it.
const REFUSED_PROMO: Refusal = {
	code: PROMO_REFUSED_CODE,
	message: PROMO_REFUSED,
	status: 400,
};

export function quoteRequestOf(
	data: unknown,
): QuoteRequest | { refusal: Refusal } {
	const checked = quoteItems(data);
	if ("refusal" in checked || !isRecord(data)) return checked;
	const refused = { refusal: REFUSED_INPUT };
	const { promoCode, shippingAddress } = data;
	if (
		promoCode !== undefined &&
		(typeof promoCode !== "string" || !promoCodeOk(promoCode))
	) {
		return { refusal: REFUSED_PROMO };
	}
	const presentment =
		data.presentment === undefined
			? undefined
			: typeof data.presentment === "string"
				? presentmentOfInput(data.presentment)
				: null;
	if (presentment === null) return refused;
	const address =
		shippingAddress === undefined ? undefined : addressOf(shippingAddress);
	if (address === null) return refused;
	if (address && !shipsTo(address.country, shipCountries())) {
		return { refusal: SHIP_REFUSAL };
	}
	// With adaptive pricing off a quote is only ever in the plans' own
	// currency, and the page asks for none.
	if (!CHECKOUT_SETTINGS.adaptivePricing && presentment !== undefined) {
		return refused;
	}
	return {
		items: checked.items,
		...(promoCode === undefined ? {} : { promoCode }),
		...(address ? { shippingAddress: address } : {}),
		...(presentment === undefined ? {} : { presentment }),
	};
}

const QUOTE_ID = /^pq_[A-Za-z0-9]{1,64}$/;
const CONFIRMATION_TOKEN = /^ctok_[A-Za-z0-9]{1,64}$/;
const RETURN_URL_LIMIT = 2048;

// The only places a buyer is sent back to: the host this call came in on, over
// its own scheme or https (a TLS-terminating proxy or a dev tunnel hands the
// server plain http for the page's https), and a dev build's own origins
// (VITE_WHOP_RETURN_ORIGIN, and the public origin `whop apps dev` serves it
// at). The host keeps its port, so an internal one never matches the public
// page.
export function returnOrigins(
	request: URL,
	...devOrigins: Array<string | undefined>
): string[] {
	const origins = [request.origin];
	if (request.protocol === "http:") origins.push(`https://${request.host}`);
	for (const origin of devOrigins) if (origin) origins.push(origin);
	return origins;
}

// A return URL the page could have built (environment.ts `returnUrl`): an http
// or https URL whose params are at most the order's tag and the charge's
// return token, each once, with no hash and no credentials, whatever its
// origin or path.
const RETURN_PARAMS: ReadonlySet<string> = new Set([
	ORDER_PARAM,
	RETURN_TOKEN_PARAM,
]);

function pageReturnUrl(value: unknown): URL | null {
	if (typeof value !== "string" || value.length > RETURN_URL_LIMIT) return null;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		// Not a URL, so not one the page built.
		return null;
	}
	const params = [...url.searchParams.keys()];
	return (url.protocol === "https:" || url.protocol === "http:") &&
		!url.username &&
		!url.password &&
		!url.hash &&
		params.every((key) => RETURN_PARAMS.has(key)) &&
		new Set(params).size === params.length
		? url
		: null;
}

function returnsToStore(url: URL, origins: readonly string[]): boolean {
	return origins.includes(url.origin) && url.pathname === ORDER_COMPLETE_PATH;
}

// Each origin a store's return URL check refuses is logged at most once a
// minute an isolate: the page's origin is the browser's to send, but any
// caller can send one.
export const RETURN_REFUSAL_LOGGED_MS = 60_000;

export type ReturnRefusals = ExpiringMap<true>;

export function createReturnRefusals(): ReturnRefusals {
	return createExpiringMap(MOST_KEPT);
}

export function quoteBody(
	store: string,
	items: readonly OrderItem[],
	data: Omit<QuoteRequest, "items">,
	ip: string | undefined,
) {
	return {
		account_id: store,
		line_items: items.map((item) => ({
			plan_id: item.planId,
			quantity: item.quantity,
		})),
		promo_code: data.promoCode,
		shipping_address: data.shippingAddress,
		ip_address: ip,
		...presentmentParams(data.presentment),
	};
}

export type ChargeApi = {
	payments: {
		create: Call<
			Payments["create"],
			Pick<WhopPayment, "id" | "status" | "client_secret" | "failure_message">
		>;
	};
	paymentQuotes: QuoteApi["paymentQuotes"];
};

const NOT_SENT: Refusal = {
	code: NOT_SENT_CODE,
	message: CHARGE_NOT_SENT,
	status: null,
};

const STORE_REFUSED: Refusal = {
	code: STORE_UNAVAILABLE_CODE,
	message: PAYMENTS_UNAVAILABLE,
	status: null,
};

// Whether a resend's quote already holds a payment Whop made, read by the
// server itself, never taken from the page's flag: Whop records the payment on
// the quote as it creates it. Such a resend is answered under its key as it
// was, whatever a redeploy changed since (the terms setting, the shipping
// countries), so the page gets back the secret of a payment that exists; a
// flag on an unused quote opens nothing. A "resend" whose quote holds no
// payment, or that Whop doesn't have, is a fresh charge, and one whose quote
// can't be read (Whop's 403 included, `UnreadId`) is answered as Whop not
// answering would be, so the page sends it again.
async function resendsHeldPayment(
	api: ChargeApi,
	store: string,
	quoteId: string,
	resend: unknown,
): Promise<boolean | Refusal> {
	if (resend !== true) return false;
	try {
		const quote = await api.paymentQuotes.retrieve({ id: quoteId });
		return quote.account_id === store && Boolean(quote.payment_id);
	} catch (failure) {
		const read = unreadIfForbidden(failure);
		logFailure("Reading a resent charge's quote", read, { buyerIds: true });
		const refusal = refusalOf(read);
		return refusal.status === 404 ? false : refusal;
	}
}

// The page's resends are the only retries: the SDK's would multiply each send.
// Anything in the request that fails before it leaves charged nothing
// (NOT_SENT); only the call itself can leave a charge open.
export async function chargeFor(
	connect: () => {
		api: ChargeApi;
		store: string;
		origins: string[];
		// The request's Origin header, which the browser sets to the page's.
		pageOrigin?: string;
		returnRefusals: ReturnRefusals;
		// The page was built under other settings (`currentSettings`).
		stale?: boolean;
	},
	data: unknown,
	whopRefusal: (failure: unknown) => Refusal,
	now: () => number = Date.now,
): Promise<{ payment: ChargedPayment } | { refusal: Refusal }> {
	const started = now();
	let send: (
		timeoutInSeconds: number,
	) => ReturnType<ChargeApi["payments"]["create"]>;
	const inputs = isRecord(data) ? data.inputs : null;
	if (!isRecord(data) || !isRecord(inputs)) return { refusal: REFUSED_INPUT };
	// The store's own configuration (its account, the URL the call came in on)
	// is read before anything else. One that can't be read is a decided
	// refusal, never resent, logged once for the owner's hosting logs: it is no
	// charge that failed to leave, and telling every buyer so would hide it.
	let connection: ReturnType<typeof connect>;
	try {
		connection = connect();
	} catch (failure) {
		console.error(
			"[storefront] Checkout can't take payments: the store's configuration can't be read.",
			failure,
		);
		return { refusal: STORE_REFUSED };
	}
	const { api, store, origins, pageOrigin, returnRefusals, stale } = connection;
	try {
		const { key, resend } = data;
		const { quoteId, confirmationToken, affiliateCode, termsAccepted } = inputs;
		if (inputs.accountId !== store) return { refusal: STORE_REFUSAL };
		const shippingAddress = addressOf(inputs.shippingAddress);
		const returnUrl = pageReturnUrl(inputs.returnUrl);
		if (
			typeof key !== "string" ||
			!CHARGE_KEY.test(key) ||
			!shippingAddress ||
			!returnUrl ||
			typeof quoteId !== "string" ||
			!QUOTE_ID.test(quoteId) ||
			typeof confirmationToken !== "string" ||
			!CONFIRMATION_TOKEN.test(confirmationToken) ||
			(affiliateCode !== undefined &&
				(typeof affiliateCode !== "string" ||
					!AFFILIATE_CODE.test(affiliateCode))) ||
			(termsAccepted !== undefined && termsAccepted !== true) ||
			(resend !== undefined && resend !== true)
		) {
			return { refusal: REFUSED_INPUT };
		}
		// A return URL at the page's own origin (the browser's Origin header)
		// that the server won't send buyers back to is the store's own setup (a
		// proxy that rewrites the Host, a tunnel with no dev origin, a renamed
		// order-complete route), never the buyer's: the store can't take
		// payments until it is fixed. One at any other origin is no page's.
		if (!returnsToStore(returnUrl, origins)) {
			if (returnUrl.origin !== pageOrigin) return { refusal: REFUSED_INPUT };
			const at = now();
			if (!returnRefusals.get(returnUrl.origin, at)) {
				returnRefusals.set(
					returnUrl.origin,
					true,
					at + RETURN_REFUSAL_LOGGED_MS,
					at,
				);
				console.error(
					`[storefront] Checkout can't take payments: the page's return URL ${returnUrl.origin}${returnUrl.pathname} isn't the store's order-complete page, which this server takes only at ${origins.map((origin) => `${origin}${ORDER_COMPLETE_PATH}`).join(", ")}. Pass the page's Host through any proxy in front of the server, and keep ORDER_COMPLETE_PATH in step with the order-complete route.`,
				);
			}
			return { refusal: STORE_REFUSED };
		}
		// The ship countries are checked on every send: Whop holds a quote to
		// the address it was priced for only when the quote has a location, and
		// one made with no address and no IP (a seller who collects no tax, off
		// Whop hosting) can be charged anywhere. A page built under the current
		// settings holds its button until the terms box is ticked. A page built
		// under other ones charges nothing new; its resend of a payment Whop
		// already made goes on, so that payment can finish.
		const unagreed =
			CHECKOUT_SETTINGS.requireTermsAgreement && termsAccepted !== true;
		const unshipped = !shipsTo(shippingAddress.country, shipCountries());
		if (stale || unagreed || unshipped) {
			const held = await resendsHeldPayment(api, store, quoteId, resend);
			if (typeof held !== "boolean") return { refusal: held };
			if (!held) {
				return {
					refusal: stale
						? STORE_UPDATED_REFUSAL
						: unagreed
							? REFUSED_INPUT
							: SHIP_REFUSAL,
				};
			}
		}
		const body = {
			account_id: store,
			quote_id: quoteId,
			confirmation_token: confirmationToken,
			shipping_address: shippingAddress,
			return_url: returnUrl.href,
			affiliate_code: affiliateCode,
			// Whop's charge has no field for it, so the agreement rides on the
			// payment for the seller to see. It follows the attempt's own inputs,
			// never the live setting, so a resend after a redeploy that flips it
			// is the same request under the key.
			...(termsAccepted === true
				? { metadata: { terms_accepted: "true" } }
				: {}),
		};
		send = (timeoutInSeconds) =>
			api.payments.create(body, {
				idempotencyKey: key,
				maxRetries: 0,
				timeoutInSeconds,
			});
	} catch (failure) {
		logFailure("Preparing a charge", failure);
		return { refusal: NOT_SENT };
	}
	// The charge call gets what is left of the charge's budget once the
	// checks before it (a resend's quote read) ran; too little left, and none
	// is sent: no answer, which the page sends again.
	const left = CHARGE_BUDGET_MS - (now() - started);
	if (left < CHARGE_LEAST_MS) return { refusal: NO_ANSWER };
	try {
		const payment = await send(left / 1000);
		return {
			payment: { id: payment.id, clientSecret: payment.client_secret },
		};
	} catch (failure) {
		logFailure("Charging a quote", failure, { buyerIds: true });
		return { refusal: whopRefusal(failure) };
	}
}

type StatusRead = Pick<WhopPaymentStatus, "status" | "last_payment_error"> & {
	account: Pick<NonNullable<WhopPaymentStatus["account"]>, "id"> | null;
	next_action: Pick<
		NonNullable<WhopPaymentStatus["next_action"]>,
		"type"
	> | null;
	processing_details: unknown;
};

export type StatusApi = {
	payments: { retrieveStatus: Call<Payments["retrieveStatus"], StatusRead> };
};

// The browser's payment reads take any id anyone sends, so an id an endpoint
// answers 404 for is a miss there for as long as a refused variant read is
// kept, and a succeeded payment's status, which can't change any more, is
// kept as long as a variant read. Both are shared by every read of the
// isolate's (`PaymentReads`).
export const KEPT_STATUSES: ReadonlySet<string> = new Set(["succeeded"]);

// Every other answer is kept briefly too, whatever it says, so a caller
// holding a real id can't drive reads on the store's key in a loop, and a page
// polling it (2 seconds or more apart) still sees it move by its next check: a
// canceled payment can still be paid, as Whop lets its receipt be retried.
// Each server function keeps its own (`RecentReads`), so none answers with
// what another read just before the page acted on it (a 3D Secure step
// between a quote's read and the order-complete page's).
export const ANSWER_KEPT_MS = 3_000;

export type PaymentEndpoint = "payment" | "status" | "quote";

// A kept 404 holds only its status: Whop's own error, its raw response
// included, is let go as soon as it is read.
export type PaymentReads = {
	missed: ExpiringMap<404>;
	statuses: ExpiringMap<StatusRead>;
	now: () => number;
};

// What a read of an id kept as missing (`PaymentReads.missed`) throws in
// place of Whop's 404: `missing` and `refusalOf` read it as one.
export class KeptMiss extends Error {
	readonly statusCode = 404;

	constructor() {
		super("Whop has no such id (a kept 404).");
	}
}

export function createPaymentReads(now: () => number = Date.now): PaymentReads {
	return {
		missed: createExpiringMap(MOST_KEPT),
		statuses: createExpiringMap(MOST_KEPT),
		now,
	};
}

type QuoteRead = Pick<WhopPaymentQuote, "account_id" | "payment_id">;

export type RecentReads = {
	statuses: ExpiringMap<StatusRead>;
	quotes: ExpiringMap<QuoteRead>;
};

export function createRecentReads(): RecentReads {
	return {
		statuses: createExpiringMap(MOST_KEPT),
		quotes: createExpiringMap(MOST_KEPT),
	};
}

// Every answer is `shape`d to what its readers use before it is kept or
// returned, so a cache holds nothing more of Whop's answer than that.
export async function keptRead<R, T>(
	reads: PaymentReads,
	endpoint: PaymentEndpoint,
	id: string,
	read: () => PromiseLike<R>,
	notFound: (failure: unknown) => boolean,
	kept: {
		shape: (read: R) => T;
		recent: ExpiringMap<T>;
		settled?: { values: ExpiringMap<T>; final: (value: T) => boolean };
	},
): Promise<T> {
	const now = reads.now();
	const known = kept.settled?.values.get(id, now) ?? kept.recent.get(id, now);
	if (known !== undefined) return known;
	const missKey = `${endpoint}:${id}`;
	if (reads.missed.get(missKey, now)) throw new KeptMiss();
	let value: T;
	try {
		value = kept.shape(await read());
	} catch (failure) {
		if (notFound(failure)) {
			const at = reads.now();
			reads.missed.set(missKey, 404, at + REFUSED_KEPT_MS, at);
		}
		throw failure;
	}
	const at = reads.now();
	kept.recent.set(id, value, at + ANSWER_KEPT_MS, at);
	if (kept.settled?.final(value)) {
		kept.settled.values.set(id, value, at + KEPT_FOR_MS, at);
	}
	return value;
}

// An empty answer is kept as it came, for the reader to refuse.
function statusShape(read: StatusRead): StatusRead {
	if (!read) return read;
	const error = read.last_payment_error;
	return {
		account: read.account ? { id: read.account.id } : null,
		status: read.status,
		next_action: read.next_action ? { type: read.next_action.type } : null,
		last_payment_error: error
			? {
					code: error.code ?? null,
					decline_code: error.decline_code ?? null,
					message: error.message ?? null,
				}
			: null,
		processing_details: read.processing_details ? true : null,
	};
}

function quoteShape(read: QuoteRead): QuoteRead {
	if (!read) return read;
	return { account_id: read.account_id, payment_id: read.payment_id };
}

export function keptStatusApi(
	api: StatusApi,
	reads: PaymentReads,
	recent: RecentReads,
	notFound: (failure: unknown) => boolean,
): StatusApi {
	return {
		payments: {
			retrieveStatus: (request) =>
				keptRead(
					reads,
					"status",
					request.payment_id,
					() => api.payments.retrieveStatus(request),
					notFound,
					{
						shape: statusShape,
						recent: recent.statuses,
						settled: {
							values: reads.statuses,
							final: (read) => Boolean(read) && KEPT_STATUSES.has(read.status),
						},
					},
				),
		},
	};
}

export type QuoteApi = Pick<ReadApi, "paymentQuotes">;

export function keptQuoteApi(
	api: QuoteApi,
	reads: PaymentReads,
	recent: RecentReads,
	notFound: (failure: unknown) => boolean,
): QuoteApi {
	return {
		paymentQuotes: {
			retrieve: (request) =>
				keptRead(
					reads,
					"quote",
					request.id,
					() => api.paymentQuotes.retrieve(request),
					notFound,
					{ shape: quoteShape, recent: recent.quotes },
				),
		},
	};
}

export function keptReadApi(
	api: ReadApi,
	reads: PaymentReads,
	recent: RecentReads,
	notFound: (failure: unknown) => boolean,
): ReadApi {
	return {
		...keptStatusApi(api, reads, recent, notFound),
		...keptQuoteApi(api, reads, recent, notFound),
	};
}

export async function paymentStateFor(
	api: StatusApi,
	store: string,
	paymentId: string,
): Promise<PaymentState | null> {
	if (typeof paymentId !== "string" || !PAYMENT_ID.test(paymentId)) return null;
	return stateOfStatus(
		await api.payments.retrieveStatus({ payment_id: paymentId }),
		store,
	);
}

export function stateOfStatus(
	read: StatusRead | undefined,
	store: string,
): PaymentState | null {
	if (!read || read.account?.id !== store) return null;
	return {
		status: read.status,
		lastPaymentError: read.last_payment_error,
		step: read.next_action?.type ?? null,
		settling: Boolean(read.processing_details),
	};
}

export type ReadApi = StatusApi & {
	paymentQuotes: { retrieve: Call<QuoteCall, QuoteRead> };
};

export async function readQuoteFor(
	api: ReadApi,
	store: string,
	quoteId: string,
	notFound: (failure: unknown) => boolean,
): Promise<QuoteReading | null> {
	if (typeof quoteId !== "string" || !QUOTE_ID.test(quoteId)) return null;
	let quote: QuoteRead;
	try {
		quote = await api.paymentQuotes.retrieve({ id: quoteId });
	} catch (failure) {
		if (notFound(failure)) return { gone: true };
		logFailure("Reading a quote", unreadIfForbidden(failure));
		return null;
	}
	if (quote.account_id !== store) return null;
	if (!quote.payment_id) return { payment: null };
	const id = quote.payment_id;
	const state = await paymentStateFor(api, store, id).catch(
		(failure: unknown) => {
			logFailure("Reading a payment's status", failure);
			return null;
		},
	);
	return state ? { payment: { id, state } } : null;
}

type QuoteLine = WhopPaymentQuote["line_items"][number];

// What a handover reads of Whop's quote: the fields `handedQuoteFor` checks and
// the checkout shows (`quoteOf`), and of its delivery address only whether it
// has one. Nothing more of the quote is kept.
export type HandoverRead = Pick<
	WhopPaymentQuote,
	| "id"
	| "account_id"
	| "payment_id"
	| "currency"
	| "base_currency"
	| "promo_code_id"
	| "exchange_rate"
	| "recommended_currencies"
	| "tax_status"
	| "tax_behavior"
	| "located_by"
	| "created_at"
	| "expires_at"
	| "total"
	| "base_total"
	| "subtotal"
	| "discount"
	| "tax_amount"
> & {
	shipped: boolean;
	line_items: Array<Pick<QuoteLine, "plan_id" | "quantity" | "subtotal">>;
};

function handoverShape(read: WhopPaymentQuote): HandoverRead {
	return {
		id: read.id,
		account_id: read.account_id,
		payment_id: read.payment_id,
		currency: read.currency,
		base_currency: read.base_currency,
		promo_code_id: read.promo_code_id,
		exchange_rate: read.exchange_rate,
		recommended_currencies: read.recommended_currencies,
		tax_status: read.tax_status,
		tax_behavior: read.tax_behavior,
		located_by: read.located_by,
		created_at: read.created_at,
		expires_at: read.expires_at,
		total: read.total,
		base_total: read.base_total,
		subtotal: read.subtotal,
		discount: read.discount,
		tax_amount: read.tax_amount,
		shipped: read.shipping_address !== null,
		line_items: read.line_items.map((line: QuoteLine) => ({
			plan_id: line.plan_id,
			quantity: line.quantity,
			subtotal: line.subtotal,
		})),
	};
}

export type HandoverApi = {
	paymentQuotes: { retrieve: Call<QuoteCall, HandoverRead> };
};

// Anyone can name any quote id, so a handover's read is kept as the browser's
// payment reads are (`keptRead`): a 404 as a miss, every other answer for
// ANSWER_KEPT_MS, in its own reader's map.
export function keptHandoverApi(
	api: { paymentQuotes: { retrieve: Call<QuoteCall> } },
	reads: PaymentReads,
	recent: ExpiringMap<HandoverRead>,
	notFound: (failure: unknown) => boolean,
): HandoverApi {
	return {
		paymentQuotes: {
			retrieve: (request) =>
				keptRead(
					reads,
					"quote",
					request.id,
					() => api.paymentQuotes.retrieve(request),
					notFound,
					{ shape: handoverShape, recent },
				),
		},
	};
}

// A quote handed over must have more left of its life than a charge needs.
export const HANDOVER_MARGIN_MS = PAYABLE_MARGIN_MS;

// A quote the cart or a product page handed over (quote-handover.ts) opens the
// checkout only as Whop holds it now: the store's, not yet paid, priced with
// no address, for exactly the order's lines, in the currency asked for (any,
// for `auto`), with no code when none was asked, and with more than
// HANDOVER_MARGIN_MS left before Whop's `expires_at` on this server's clock;
// the page is told what is left (`lifetimeMs`), never a time to compare with
// its own clock. Anything else, or a read that fails, is no quote, and the
// checkout quotes the order as it always does.
export async function handedQuoteFor(
	api: HandoverApi,
	store: string,
	data: unknown,
	notFound: (failure: unknown) => boolean,
	now: () => number = Date.now,
): Promise<{
	quote: HandoverRead;
	promoCode: string | undefined;
	lifetimeMs: number;
} | null> {
	if (
		!isRecord(data) ||
		typeof data.quoteId !== "string" ||
		!QUOTE_ID.test(data.quoteId)
	) {
		return null;
	}
	const request = quoteRequestOf(data);
	if ("refusal" in request || request.shippingAddress) return null;
	let quote: HandoverRead;
	try {
		quote = await api.paymentQuotes.retrieve({ id: data.quoteId });
	} catch (failure) {
		if (notFound(failure)) return null;
		logFailure("Reading a handed-over quote", unreadIfForbidden(failure), {
			buyerIds: true,
		});
		return null;
	}
	const lifetimeMs = Date.parse(quote.expires_at) - now();
	const currency = quote.currency.toLowerCase();
	const asked = request.presentment;
	const priced =
		asked === AUTO ||
		isCountryPick(asked) ||
		currency === (asked ?? quote.base_currency.toLowerCase());
	const lines = (entries: ReadonlyArray<{ plan: string; quantity: number }>) =>
		entries
			.map(({ plan, quantity }) => `${plan}:${quantity}`)
			.sort()
			.join(",");
	const sameLines =
		lines(
			quote.line_items.map((line) => ({
				plan: line.plan_id ?? "",
				quantity: line.quantity,
			})),
		) ===
		lines(
			request.items.map((item) => ({
				plan: item.planId,
				quantity: item.quantity,
			})),
		);
	return quote.account_id === store &&
		!quote.payment_id &&
		!quote.shipped &&
		lifetimeMs > HANDOVER_MARGIN_MS &&
		priced &&
		sameLines &&
		(request.promoCode !== undefined || !quote.promo_code_id)
		? { quote, promoCode: request.promoCode, lifetimeMs }
		: null;
}

export async function planConfigurations(
	api: KeptVariantApi,
	store: string,
	planIds: readonly string[],
): Promise<MethodsRead[]> {
	return readEach(planIds, async (id): Promise<MethodsRead> => {
		if (typeof id !== "string" || !VARIANT_ID.test(id)) {
			return { configuration: NO_WALLETS };
		}
		let plan: KeptVariant | null;
		try {
			plan = await api.variants.retrieve({ id });
		} catch (failure) {
			logFailure("Reading a variant's payment methods", failure, {
				buyerIds: true,
			});
			return { failed: true };
		}
		if (plan?.account?.id !== store) return { configuration: NO_WALLETS };
		return { configuration: plan.effective_payment_method_configuration };
	});
}
