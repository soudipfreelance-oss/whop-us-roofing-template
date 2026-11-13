import { getRequestHeader } from "./lib/request.server";
import { WhopClient, WhopError } from "@whop/sdk";
import { API_VERSION_DATE } from "./api-version";
import { requestCookies } from "./lib/checkout/cookie-storage";
import {
	createStoreReads,
	createStoreSales,
	KeptMiss,
	type KeptVariantApi,
	keptVariantApi,
	logFailure,
	readEach,
	refusalOf,
	rememberVariantSales,
	type StoreSales,
	unreadIfForbidden,
} from "./lib/checkout/order.handlers";
import {
	definite,
	STORE_UNAVAILABLE_CODE,
} from "./lib/checkout/charge-attempt";
import {
	CATALOG_READ_MS,
	NoAnswer,
	PAGE_READ_MS,
	within,
} from "./lib/checkout/deadline";
// Never import order.server.ts here: it imports this file, and in the dev
// server a page that asks for one of the pair while an edit reloads it gets a
// half-loaded copy ("Cannot access ... before initialization") until reloaded.
import { buyerIpOf } from "./lib/checkout/public-ip";
import { storedPick } from "./lib/checkout/quote-handover";
import { CHECKOUT_SETTINGS } from "./lib/checkout/settings";
import { isRecord } from "./lib/checkout/shared";
import {
	createKeptProductIndex,
	forgetIndexedSlug,
	type KeptProductIndex,
	planProductId,
	productChoices,
	productIdFor,
	productVariantPlans,
	type ShownPricing,
	shownPricingFor,
	tilePrice,
} from "./lib/storefront-account";
import type { ProductView } from "./lib/variant-selection";

const productIndexKept: KeptProductIndex = createKeptProductIndex();

// Nothing in here may be reached from a route's module scope. A loader runs in
// the browser on client-side navigation, so anything touching node:fs or
// process has to sit behind a createServerFn handler — otherwise the first link
// click throws and only a refresh recovers.

export type ClientCalls = { timeoutInSeconds?: number; maxRetries?: number };

const STORE_VISIBILITY = "visible";
const SLUG_LIMIT = 256;

// One client per configuration for the life of the isolate; the environment
// it reads is fixed at deploy.
const clients = new Map<string, WhopClient>();

export function whopClient(calls: ClientCalls = {}): WhopClient {
	const key = JSON.stringify(calls);
	const known = clients.get(key);
	if (known) return known;
	const client = new WhopClient({
		token: process.env.WHOP_API_KEY ?? "",
		baseUrl: `${process.env.WHOP_API_ORIGIN ?? "https://api.whop.com"}/api/v1`,
		apiVersionDate: API_VERSION_DATE,
		...calls,
	});
	clients.set(key, client);
	return client;
}

type ProductPage = Awaited<ReturnType<WhopClient["products"]["list"]>>;
type ListedProduct = ProductPage["data"][number];
type ListedVariant = Awaited<
	ReturnType<WhopClient["variants"]["list"]>
>["data"][number];

const storeReads = createStoreReads();
// One per isolate: the checkout's sale check, and the product page's own reads
// of its variants (`loadProductView`).
export const storeSales: StoreSales = createStoreSales();

// Whop's own 404, for a call made straight to it, or one a payment read kept
// (`KeptMiss`). A variant read goes through `keptVariantApi`, which answers
// one with null. Its 403 for an id the buyer sent is no answer (`UnreadId`),
// never a miss.
export function missing(failure: unknown): boolean {
	return (
		failure instanceof KeptMiss ||
		(failure instanceof WhopError && failure.statusCode === 404)
	);
}

// The store's kept variant reads (`keptVariantApi`), each read on `budget`: a
// page's (`pageRead`), or a quote's own client settings, whose wait is the
// quote's. Make one inside each request's handler, never at module scope: the
// reads it has running belong to that request.
export function storeVariantApi(
	budget: ReadBudget | { calls: ClientCalls } = PAGE_READ,
): KeptVariantApi {
	return keptVariantApi(
		{
			variants: {
				retrieve: ({ id }) =>
					"deadlineMs" in budget
						? pageRead(
								(client, options) => client.variants.retrieve({ id }, options),
								budget,
							)
						: whopClient(budget.calls).variants.retrieve({ id }),
			},
		},
		storefrontAccountId(),
		storeReads,
		missing,
	);
}

// A page's render waits on these reads: one retry absorbs a blip, and both
// tries share one deadline, as the SDK would wait out a Retry-After of up to
// a minute between them. The abort stops a try still to come.
type ReadBudget = { calls: ClientCalls; deadlineMs: number };
const PAGE_READ: ReadBudget = {
	calls: { timeoutInSeconds: 2, maxRetries: 1 },
	deadlineMs: PAGE_READ_MS,
};
// The order-complete page waits on its payment and status reads, run side by
// side, just after the buyer paid, with nothing else to show: twice a page
// read's budget, and a read slower than that is asked again from the browser
// (order-complete-checks.ts `checkOrderAgain`).
export const PAYMENT_READ: ReadBudget = {
	calls: { timeoutInSeconds: 4, maxRetries: 1 },
	deadlineMs: 10_000,
};
// A whole catalog lists in pages, each page call bounded like a page read, and
// all of them within one deadline a grid's render can wait on.
export const CATALOG_READ: ReadBudget = {
	calls: { timeoutInSeconds: 4, maxRetries: 1 },
	deadlineMs: CATALOG_READ_MS,
};

export function pageRead<T>(
	read: (
		client: WhopClient,
		options: { abortSignal: AbortSignal },
	) => Promise<T>,
	budget: ReadBudget = PAGE_READ,
): Promise<T> {
	return within(
		read(whopClient(budget.calls), {
			abortSignal: AbortSignal.timeout(budget.deadlineMs),
		}),
		budget.deadlineMs,
	);
}

// The largest page Whop's list endpoints return; their default is 20.
const PAGE_SIZE = 100;

// Calls that share one deadline: the abort reaches every call still running,
// and `until` is when the reads stop waiting.
type CatalogBudget = { abortSignal: AbortSignal; until: number };

function catalogBudget(ms: number = CATALOG_READ.deadlineMs): CatalogBudget {
	return { abortSignal: AbortSignal.timeout(ms), until: Date.now() + ms };
}

async function withinUntil<T>(read: Promise<T>, until: number): Promise<T> {
	return within(read, Math.max(0, until - Date.now()));
}

type ListPage<T> = {
	data: T[];
	response: {
		page_info: { end_cursor: string | null; has_next_page: boolean };
	};
};
type ListCall<T> = (
	after: string | null,
	options: { abortSignal?: AbortSignal },
) => Promise<ListPage<T>>;

// `next` is where a listing that didn't reach the end stopped (Whop's cursor),
// and `cut` says its budget stopped it rather than its page cap.
type Listing<T> = {
	items: T[];
	complete: boolean;
	next: string | null;
	cut: boolean;
};

async function listPages<T>(
	list: ListCall<T>,
	after: string | null,
	budget: CatalogBudget | null,
	pages = Number.POSITIVE_INFINITY,
): Promise<Listing<T>> {
	const items: T[] = [];
	let cursor = after;
	try {
		for (let read = 0; read < pages; read += 1) {
			const call = list(
				cursor,
				budget ? { abortSignal: budget.abortSignal } : {},
			);
			const page = await (budget ? withinUntil(call, budget.until) : call);
			items.push(...page.data);
			const { end_cursor: end, has_next_page: more } = page.response.page_info;
			if (!more || !end) {
				return { items, complete: true, next: null, cut: false };
			}
			cursor = end;
		}
		return { items, complete: false, next: cursor, cut: false };
	} catch (failure) {
		if (failure instanceof NoAnswer || budget?.abortSignal.aborted) {
			return { items, complete: false, next: cursor, cut: true };
		}
		throw failure;
	}
}

// Only `visible` products: the account can also hold hidden or archived ones,
// and a shopper reaching those through a grid or a product URL is a leak. A
// grid built on one page would drop products the moment the store outgrows it.
function productList(
	params: { account_id: string; labels?: string[]; query?: string },
	calls: ClientCalls = CATALOG_READ.calls,
): ListCall<ListedProduct> {
	return (after, options) =>
		whopClient(calls).products.list(
			{
				...params,
				visibilities: [STORE_VISIBILITY],
				first: PAGE_SIZE,
				...(after ? { after } : {}),
			},
			options,
		);
}

// `pricing` states the variants' prices in the buyer's currency
// (`shownPricing`): only for a read that shows them, never one a checkout
// starts from.
function variantList(
	accountId: string,
	productIds: string[],
	pricing: ShownPricing | null = null,
): ListCall<ListedVariant> {
	return (after, options) =>
		whopClient(CATALOG_READ.calls).variants.list(
			{
				account_id: accountId,
				product_ids: productIds,
				visibilities: [STORE_VISIBILITY],
				first: PAGE_SIZE,
				...(after ? { after } : {}),
				...pricing,
			},
			options,
		);
}

// The request's own buyer: the store's pick from their cookie, else their IP
// where Whop hosting vouches for it (`buyerIpOf`).
function shownPricing(): ShownPricing | null {
	return shownPricingFor(
		CHECKOUT_SETTINGS.adaptivePricing,
		storedPick(() => requestCookies(getRequestHeader("cookie"))),
		buyerIpOf(
			getRequestHeader("cf-connecting-ip"),
			Boolean(process.env.APP_ID && process.env.BUILD_ID),
		),
	);
}

// A listing the budget cut short says where it stopped (`next`), so the next
// one goes on from there.
async function listCatalogFrom(
	accountId: string,
	after: string | null,
): Promise<{ items: ListedProduct[]; complete: boolean; next: string | null }> {
	const { items, complete, next } = await listPages(
		productList({ account_id: accountId }),
		after,
		catalogBudget(),
	);
	return { items, complete, next };
}

// Every visible product of the account: the whole catalog, paged to the end
// however long that takes. Each page's call has its own timeout
// (CATALOG_READ's), but the listing as a whole has no deadline, so call it
// from a builder's own server code, never from a page that must render in
// time (the template's pages read within their budgets).
export async function listAllProducts(
	accountId: string,
): Promise<ListedProduct[]> {
	const { items } = await listPages(
		productList({ account_id: accountId }),
		null,
		null,
	);
	return items;
}

// The handler's return crosses to the browser, so it is a plain shape rather
// than the SDK's objects: those carry fields the serializer cannot check.
export type CollectionItem = {
	id: string;
	title: string;
	slug: string;
	image: string | null;
	priceLabel: string | null;
};

// `unread` is a stretch whose page of products didn't come, within its share
// of the budget or at all: the page says so, rather than showing an empty
// collection. `ended` is a later stretch Whop refused for good: the page says
// the rest didn't load, and offers no more.
export type CollectionStretch = {
	label: string;
	items: CollectionItem[];
	next: string | null;
	unread?: true;
	ended?: true;
};

const CURSOR_LIMIT = 512;
// Far past any label a seller writes: a longer one names no collection.
const LABEL_LIMIT = 100;
// A few products' variants per listing, so a listing the deadline cuts short
// leaves only its own products' tiles without a price.
const VARIANT_GROUP = 20;

function groupsOf<T>(items: readonly T[], size: number): T[][] {
	return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
		items.slice(index * size, (index + 1) * size),
	);
}

// `next` is null once the catalog is read, and for a first stretch that
// didn't come (`unread`): the page then offers its own Try again, which loads
// the first stretch again, rather than Load more. Every failure of the first
// stretch is unread, as is a later one Whop didn't answer (a timeout, a 429,
// a 5xx) or the store's key refused (a 401, a 403 Whop wrote), so the page
// offers to try again rather than the router's error, and never shows an
// empty collection. A later stretch's cursor Whop refused for good (any other
// 4xx) ends the collection's paging (`ended`), as asking again would get the
// same answer. Each failure logs one line.
async function productStretch(
	accountId: string,
	label: string,
	after: string | null,
	budget: CatalogBudget,
): Promise<{
	products: ListedProduct[];
	next: string | null;
	unread?: true;
	ended?: true;
}> {
	try {
		const listed = await listPages(
			productList({
				account_id: accountId,
				...(label === "all" ? {} : { labels: [label] }),
			}),
			after,
			budget,
			1,
		);
		if (listed.cut) throw new NoAnswer(CATALOG_READ.deadlineMs / 2);
		return { products: listed.items, next: listed.next };
	} catch (failure) {
		logFailure("Listing a collection", failure);
		const refusal = refusalOf(failure);
		if (
			after !== null &&
			definite(refusal) &&
			refusal.code !== STORE_UNAVAILABLE_CODE
		) {
			return { products: [], next: null, ended: true };
		}
		return { products: [], next: after, unread: true };
	}
}

// A collection reads the catalog a stretch at a time, within one budget of
// 15 seconds: its page of products gets the first half, their variants what
// is left. The page loads the rest on request. A tile whose variants weren't
// all read shows no price rather than a wrong one, whatever stopped its
// group's listing: a 429 or a 5xx there leaves the rest of the page priced. A
// cursor no page of Whop's could have handed out is refused, so its "Load
// more" fails and offers to try again, never starts over at the first page.
export async function loadCollectionStretch(
	rawLabel: string,
	rawAfter: string | null,
): Promise<CollectionStretch> {
	const label = rawLabel.toLowerCase();
	if (rawAfter && rawAfter.length > CURSOR_LIMIT) {
		throw new Error("This collection's next page can't be read.");
	}
	if (label.trim().length > LABEL_LIMIT) {
		return { label, items: [], next: null };
	}
	const after = rawAfter || null;
	const accountId = storefrontAccountId();
	const pricing = shownPricing();
	const budget = catalogBudget();
	const { products, next, unread, ended } = await productStretch(
		accountId,
		label,
		after,
		{ ...budget, until: Date.now() + CATALOG_READ.deadlineMs / 2 },
	);
	// A group whose variants didn't list shows no price; the rest still do. A
	// group whose variants didn't list again in the buyer's currency shows their
	// own prices. The stretch logs one line for each, however many groups or
	// tiles it cost. A Worker opens only READS_AT_ONCE connections at a time, so
	// every group's own read is queued ahead of the second reads: a second read
	// waits behind them, never one of them behind a second read.
	let unpriced: unknown = null;
	let unconverted: unknown = null;
	const missed = (asked: ShownPricing | null, failure: unknown) => {
		if (asked) unconverted ??= failure;
		else unpriced ??= failure;
	};
	const groups = groupsOf(products, VARIANT_GROUP).map((group) =>
		group.map((product) => product.id),
	);
	const listings = await readEach(
		[
			...groups.map((ids) => ({ ids, asked: null })),
			...(pricing ? groups.map((ids) => ({ ids, asked: pricing })) : []),
		],
		({ ids, asked }) =>
			listPages(variantList(accountId, ids, asked), null, budget).then(
				(listed) => {
					if (!listed.complete) {
						missed(asked, new NoAnswer(CATALOG_READ.deadlineMs));
					}
					return listed;
				},
				(failure: unknown): Listing<ListedVariant> => {
					missed(asked, failure);
					return { items: [], complete: false, next: null, cut: false };
				},
			),
	);
	if (unpriced) logFailure("Pricing a collection's products", unpriced);
	if (unconverted) {
		logFailure("Pricing a collection in the buyer's currency", unconverted);
	}
	const priced = new Map<
		string,
		{ plans: ListedVariant[]; shown: ListedVariant[] | null }
	>();
	groups.forEach((ids, index) => {
		const listed = listings[index];
		if (!listed?.complete) return;
		const again = pricing ? listings[groups.length + index] : undefined;
		const shown = again?.complete ? again.items : null;
		for (const id of ids) priced.set(id, { plans: [], shown });
		for (const plan of listed.items) {
			const productId = planProductId(plan);
			if (productId) priced.get(productId)?.plans.push(plan);
		}
	});
	return {
		label,
		next,
		...(unread ? { unread } : {}),
		...(ended ? { ended } : {}),
		items: products.map((product) => {
			const read = priced.get(product.id);
			return {
				id: product.id,
				title: product.title,
				slug:
					typeof product.metadata?.source_slug === "string"
						? product.metadata.source_slug
						: product.id,
				image: product.gallery_images?.[0]?.url ?? null,
				priceLabel: read ? tilePrice(product, read.plans, read.shown) : null,
			};
		}),
	};
}

// Every visible variant of the products: VARIANT_GROUP products to a query, a
// few queries at once (`readEach`), each paged to the end. Like
// `listAllProducts`, each page's call has its own timeout but the listing as a
// whole has no deadline, so call it from a builder's own server code, never
// from a page that must render in time.
export async function listAllVariants(
	accountId: string,
	productIds: string[],
): Promise<ListedVariant[]> {
	const groups = await readEach(
		groupsOf(productIds, VARIANT_GROUP),
		async (group) =>
			(await listPages(variantList(accountId, group), null, null)).items,
	);
	return groups.flat();
}

// A product with more plans than its retrieve embeds has them listed within
// the page's catalog read budget.
async function productVariants(
	accountId: string,
	productId: string,
	pricing: ShownPricing | null = null,
	deadlineMs: number = CATALOG_READ.deadlineMs,
): Promise<ListedVariant[]> {
	const { items, complete } = await listPages(
		variantList(accountId, [productId], pricing),
		null,
		catalogBudget(deadlineMs),
	);
	if (!complete) throw new NoAnswer(deadlineMs);
	return items;
}

// The product page's variants again, in the buyer's currency, for the prices
// it shows. Within a page read's deadline: a page whose read fails or runs
// long shows its variants' own prices rather than wait.
async function shownVariants(
	accountId: string,
	productId: string,
	pricing: ShownPricing | null,
): Promise<ListedVariant[] | null> {
	if (!pricing) return null;
	try {
		return await productVariants(
			accountId,
			productId,
			pricing,
			PAGE_READ.deadlineMs,
		);
	} catch (failure) {
		logFailure("Pricing a product in the buyer's currency", failure);
		return null;
	}
}

const PRODUCT_ID = /^prod_[A-Za-z0-9]+$/;
// A title search ranks by its words, so a slug's product can sit past the
// first page when many titles share them: a few pages are read, all within one
// page read's deadline. A page after the first that fails ends the search
// without the product, so the catalog listing looks for it.
const LOOKUP_PAGES = 5;

async function lookUpProduct(
	accountId: string,
	slug: string,
): Promise<{ id: string; product?: Product } | null> {
	if (PRODUCT_ID.test(slug)) {
		const product = await retrieveProduct(slug);
		const ours = isRecord(product?.account) && product.account.id === accountId;
		// One the store doesn't show (hidden, archived) is a miss, never indexed,
		// so a second view within the minute reads nothing.
		const shown = ours ? storeVisible(product) : null;
		return shown ? { id: slug, product: shown } : null;
	}
	const budget = catalogBudget(PAGE_READ.deadlineMs);
	const search = productList(
		{ account_id: accountId, query: slug.replace(/[-_]+/g, " ") },
		PAGE_READ.calls,
	);
	let after: string | null = null;
	for (let read = 0; read < LOOKUP_PAGES; read += 1) {
		let page: Listing<ListedProduct>;
		try {
			page = await listPages(search, after, budget, 1);
			if (page.cut) throw new NoAnswer(PAGE_READ.deadlineMs);
		} catch (failure) {
			if (read === 0) throw failure;
			logFailure("Searching the catalog for a product", failure);
			return null;
		}
		const id = page.items.find(
			(product) => product.metadata?.source_slug === slug,
		)?.id;
		if (id) return { id };
		if (!page.next) return null;
		after = page.next;
	}
	return null;
}

/**
 * Everything a product page needs, found by the source store's slug (or the
 * product id), or null for an unknown slug. The option set and the plan behind
 * each combination come from one product retrieve, which embeds the visible
 * plans; a product with more than 1,000 of them has its plans listed instead.
 */
export async function loadProductView(
	rawSlug: unknown,
): Promise<ProductView | null> {
	// Anyone can call the page's server function with any JSON: a slug that
	// isn't text, or is longer than any a product could have, is a miss.
	if (typeof rawSlug !== "string" || rawSlug.length > SLUG_LIMIT) return null;
	const slug = rawSlug;
	const accountId = storefrontAccountId();
	// The product a `prod_` slug's lookup retrieved is the one shown.
	let retrieved: Product | null = null;
	const find = () =>
		productIdFor(productIndexKept, accountId, slug, {
			list: async (after) => {
				const listed = await listCatalogFrom(accountId, after);
				if (!listed.complete) {
					logFailure(
						"Listing the catalog",
						new NoAnswer(CATALOG_READ.deadlineMs),
					);
				}
				return listed;
			},
			lookUp: async () => {
				const found = await lookUpProduct(accountId, slug);
				retrieved = found?.product ?? null;
				return found?.id ?? null;
			},
		});
	const shown = (productId: string | null) => {
		if (!productId) return Promise.resolve(null);
		if (retrieved?.id === productId) {
			return Promise.resolve(storeVisible(retrieved));
		}
		return visibleProduct(productId);
	};
	const first = await find();
	let product = await shown(first);
	// A slug the index named for a product gone since (re-imported under a new
	// id) is looked up again, once.
	if (!product && first && forgetIndexedSlug(productIndexKept, slug, first)) {
		product = await shown(await find());
	}
	if (!product) return null;
	const shownRead = shownVariants(accountId, product.id, shownPricing());
	const rawPlans: unknown[] =
		productVariantPlans(product) ??
		(await productVariants(accountId, product.id));
	rememberVariantSales(storeSales, accountId, rawPlans);
	const { options, plans, opening } = productChoices(
		product,
		rawPlans,
		await shownRead,
	);
	const gallery = (product.gallery_images ?? []).flatMap((image) =>
		image?.url ? [image.url] : [],
	);

	return {
		id: product.id,
		title: product.title,
		headline: product.headline ?? null,
		description: product.description ?? null,
		image: gallery[0] ?? null,
		gallery,
		options,
		plans,
		defaultPlanId: opening?.id ?? null,
	};
}

type Product = Awaited<ReturnType<WhopClient["products"]["retrieve"]>>;

function retrieveProduct(productId: string): Promise<Product | null> {
	return pageRead((client, options) =>
		client.products.retrieve({ id: productId }, options),
	).catch((failure: unknown) => {
		if (missing(failure)) return null;
		throw unreadIfForbidden(failure);
	});
}

// The slug index only names products. The product itself decides, as the
// listing does, so one hidden, archived or deleted since 404s at once.
function storeVisible(product: Product | null): Product | null {
	return product?.visibility === STORE_VISIBILITY ? product : null;
}

async function visibleProduct(productId: string) {
	return storeVisible(await retrieveProduct(productId));
}

export function storefrontAccountId(): string {
	const accountId =
		process.env.WHOP_ACCOUNT_ID ??
		process.env.WHOP_COMPANY_ID ??
		process.env.COMPANY_ID;
	if (!accountId) {
		throw new Error(
			"WHOP_ACCOUNT_ID is not set. Whop hosting and `whop apps dev` provide it; when running the server any other way, set it to the store's biz_ id so storefront routes can load products.",
		);
	}
	return accountId;
}
