import { CATALOG_READ_MS, NoAnswer, sleep } from "./checkout/deadline";
import { createExpiringMap, type ExpiringMap } from "./checkout/expiring-map";
import { AUTO, presentmentParams } from "./checkout/presentment";
import { isRecord } from "./checkout/shared";
// Everything here has to be safe in the browser: a route that renders a price
// or a label pulls this module into the client bundle. Anything reading the
// filesystem or the environment belongs in whop.server.ts instead.

import {
	type Amount,
	amountOf,
	futureUsageFor,
	isApiMoney,
	money,
	type MoneyFormat,
	type Order,
	type PaymentMethodConfiguration,
	soldByStore,
} from "./checkout/order";

export function planProductId(plan: { product?: unknown }): string | undefined {
	const product = plan.product;
	if (typeof product !== "object" || product === null) return undefined;
	if (!("id" in product)) return undefined;
	return typeof product.id === "string" ? product.id : undefined;
}

// `initial_price_due` includes a renewal's first period unless a trial applies,
// as checkout charges it.
export function planPrice(plan: unknown): Amount | null {
	const due = isRecord(plan) ? plan.initial_price_due : undefined;
	return isApiMoney(due) ? amountOf(due) : null;
}

// API order is not price order, and minor units only compare within one
// currency.
export function cheapestByPrice<T>(
	plans: readonly T[],
	priceOf: (plan: T) => Amount | null,
): T | undefined {
	const currency = plans.map(priceOf).find((price) => price !== null)
		?.money.currency;
	const amount = (plan: T) => {
		const price = priceOf(plan);
		return price && price.money.currency === currency
			? price.units
			: Number.POSITIVE_INFINITY;
	};
	return plans.reduce<T | undefined>(
		(cheapest, plan) =>
			cheapest === undefined || amount(plan) < amount(cheapest)
				? plan
				: cheapest,
		undefined,
	);
}

// Ranked by the variants' own prices: a read in the buyer's currency leaves
// some variants in the seller's (renewing ones, free ones), so its prices
// don't compare, and the page would open on a different variant per currency.
export function cheapestChoice(plans: PlanChoice[]): PlanChoice | undefined {
	const buyable = plans.filter((plan) => plan.available);
	return cheapestByPrice(
		buyable.length > 0 ? buyable : plans,
		(plan) => plan.price,
	);
}

export type VariantOption = { name: string; label: string; values: string[] };

export type PlanCheckout = {
	sellerAccountId: string;
	sellerName: string;
	dueToday: number;
	money: MoneyFormat;
	planType: string;
};

// `price` is the variant's own, which its checkout starts from; `shownPrice`
// is what the page shows, in the buyer's currency where a priced read
// (`shownPricingFor`) converted it.
export type PlanChoice = {
	id: string;
	title: string | null;
	price: Amount | null;
	shownPrice: Amount | null;
	attributes: Record<string, string> | null;
	available: boolean;
	checkout: PlanCheckout | null;
};

function stringMap(value: unknown): Record<string, string> | null {
	if (!isRecord(value)) return null;
	const entries = Object.entries(value).filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export function optionLabel(name: string): string {
	const words = name.replace(/_/g, " ").trim();
	return words.charAt(0).toUpperCase() + words.slice(1);
}

export function productOptions(product: unknown): VariantOption[] {
	if (!isRecord(product) || !isRecord(product.variant_attributes)) return [];
	return Object.entries(product.variant_attributes).flatMap(
		([name, values]) => {
			if (!Array.isArray(values)) return [];
			const strings = values.filter(
				(value): value is string => typeof value === "string",
			);
			return strings.length > 0
				? [{ name, label: optionLabel(name), values: strings }]
				: [];
		},
	);
}

// The product's visible plans as embedded in a product retrieve, or null when
// the API left them out (products with over 1,000 plans) and they have to be
// listed instead.
export function productVariantPlans(product: unknown): unknown[] | null {
	if (!isRecord(product) || !Array.isArray(product.variants)) return null;
	return product.variants;
}

function planCheckout(plan: Record<string, unknown>): PlanCheckout | null {
	const { account, plan_type: planType } = plan;
	const price = planPrice(plan);
	if (
		!isRecord(account) ||
		typeof account.id !== "string" ||
		!price ||
		typeof planType !== "string"
	) {
		return null;
	}
	return {
		sellerAccountId: account.id,
		sellerName: typeof account.title === "string" ? account.title : "",
		dueToday: price.units,
		money: price.money,
		planType,
	};
}

// Null is the platform's defaults.
export function planOrder(
	planId: string,
	title: string,
	plan: PlanCheckout,
	configuration: PaymentMethodConfiguration | null,
): Order {
	const setupFutureUsage = futureUsageFor([plan.planType]);
	const paymentMethodConfiguration = configuration ?? undefined;
	return {
		money: plan.money,
		lines: [
			{
				planId,
				title,
				subtitle: "",
				image: "",
				quantity: 1,
				price: plan.dueToday,
			},
		],
		seller: { accountId: plan.sellerAccountId, name: plan.sellerName },
		origin: "express",
		...(paymentMethodConfiguration ? { paymentMethodConfiguration } : {}),
		...(setupFutureUsage ? { setupFutureUsage } : {}),
	};
}

// The page offers only what the server sells (`soldByStore`).
export function toPlanChoice(plan: unknown): PlanChoice | null {
	if (!isRecord(plan) || typeof plan.id !== "string") return null;
	const price = planPrice(plan);
	return {
		id: plan.id,
		title: typeof plan.title === "string" ? plan.title : null,
		price,
		shownPrice: price,
		attributes: stringMap(plan.attributes),
		available: soldByStore(plan),
		checkout: planCheckout(plan),
	};
}

export function matchPlan(
	plans: PlanChoice[],
	options: VariantOption[],
	selected: Record<string, string>,
): PlanChoice | undefined {
	return plans.find(
		(plan) =>
			plan.attributes !== null &&
			options.every(
				(option) => plan.attributes?.[option.name] === selected[option.name],
			),
	);
}

// A tile prices its product from the same opening variant, so it never
// advertises a price the page doesn't open on. `shownPlans` are the same
// variants read in the buyer's currency (`shownPricingFor`); a variant missing
// from them, or a read that failed (null), shows its own price.
export function productChoices(
	product: unknown,
	rawPlans: readonly unknown[],
	shownPlans: readonly unknown[] | null = null,
): {
	options: VariantOption[];
	plans: PlanChoice[];
	opening: PlanChoice | undefined;
} {
	const options = productOptions(product);
	const shown = new Map(
		(shownPlans ?? []).flatMap((plan) =>
			isRecord(plan) && typeof plan.id === "string" ? [[plan.id, plan]] : [],
		),
	);
	const plans = rawPlans
		.map(toPlanChoice)
		.filter(
			(plan): plan is PlanChoice =>
				plan !== null && (options.length === 0 || plan.attributes !== null),
		)
		.map((plan) => ({
			...plan,
			shownPrice: planPrice(shown.get(plan.id)) ?? plan.price,
		}));
	return { options, plans, opening: cheapestChoice(plans) };
}

export function tilePrice(
	product: unknown,
	rawPlans: readonly unknown[],
	shownPlans: readonly unknown[] | null = null,
): string | null {
	const price = productChoices(product, rawPlans, shownPlans).opening
		?.shownPrice;
	return price ? money(price.units, price.money) : null;
}

export type ShownPricing = {
	presentment_currency?: string;
	presentment_country?: string;
	ip_address?: string;
};

// What a server-rendered variant read asks for, so its prices match the
// store's quotes: the store's pick (`storedPick`, a currency or a country),
// else the buyer's own currency where Whop places their IP. A pick goes with
// the IP too, as the quotes send it: Whop checks a currency is payable where
// the buyer is, and places a read with none by the store's server. Without a
// pick or an IP to place them by, or with adaptive pricing off, the variants
// show their own currency.
export function shownPricingFor(
	adaptivePricing: boolean,
	picked: string | null,
	buyerIp: string | undefined,
): ShownPricing | null {
	if (!adaptivePricing) return null;
	const placed = buyerIp ? { ip_address: buyerIp } : {};
	if (picked) return { ...presentmentParams(picked), ...placed };
	return buyerIp ? { ...presentmentParams(AUTO), ...placed } : null;
}

export function productIndex(
	products: ReadonlyArray<{
		id: string;
		metadata?: Record<string, unknown> | null;
	}>,
): Map<string, string> {
	const index = new Map<string, string>();
	for (const product of products) {
		const slug = product.metadata?.source_slug;
		if (typeof slug === "string" && !index.has(slug)) {
			index.set(slug, product.id);
		}
		if (!index.has(product.id)) index.set(product.id, product.id);
	}
	return index;
}

export const PRODUCT_INDEX_MS = 60_000;
export const PARTIAL_INDEX_MS = 10_000;
// A slug neither the lookup nor the index found is answered as missing for a
// minute, at most this many of them, so a flood of unknown slugs costs one
// lookup per slug per minute and no listing behind each.
export const MISSED_SLUG_MS = 60_000;
export const MISSED_SLUGS_KEPT = 1_000;

// `next` is where a listing its deadline cut short stopped (Whop's cursor).
type CatalogListing = {
	items: ReadonlyArray<{
		id: string;
		metadata?: Record<string, unknown> | null;
	}>;
	complete: boolean;
	next?: string | null;
};

type ProductIndexEntry = {
	account: string;
	at: number | null;
	listedFrom: number | null;
	ids: Map<string, string>;
	complete: boolean;
	resumeFrom: string | null;
};

// `at` is when a listing last went into the index, and `listedFrom` when that
// listing started; both are null while only lookups have filled it. An index
// no listing has finished yet holds where the last one stopped
// (`resumeFrom`), so the next continues there, and a catalog too big to list
// in one deadline is read whole across a few. `misses` is keyed by account and
// slug. `listing` marks the catalog listing a request is running for an
// account, so the misses meanwhile wait for its index rather than list again.
export type KeptProductIndex = {
	current: ProductIndexEntry | null;
	misses: ExpiringMap<true>;
	listing: ListingMarker | null;
};

type ListingMarker = { account: string; startedAt: number };

export const LISTING_POLL_MS = 250;

export function createKeptProductIndex(): KeptProductIndex {
	return {
		current: null,
		misses: createExpiringMap(MISSED_SLUGS_KEPT),
		listing: null,
	};
}

const missKey = (account: string, slug: string) =>
	JSON.stringify([account, slug]);

function indexOf(
	kept: KeptProductIndex,
	account: string,
): ProductIndexEntry | null {
	return kept.current?.account === account ? kept.current : null;
}

export function forgetIndexedSlug(
	kept: KeptProductIndex,
	slug: string,
	productId: string,
): boolean {
	const ids = kept.current?.ids;
	if (ids?.get(slug) !== productId) return false;
	ids.delete(slug);
	if (ids.get(productId) === productId) ids.delete(productId);
	return true;
}

// What a listing found goes into the index as it is when the listing ends,
// stamped with when the listing started. One that started before the listing
// already in the index only adds the names it lacks. Otherwise a listing from
// the first page that reached the end replaces the index; one that went on
// from where the last stopped (`resumed`), or that its deadline cut short,
// adds to it, never shrinking it, and the index is complete once one reaches
// the end. A complete index stays complete, its answers that a slug isn't
// there included, when a refresh is cut short: the next goes on from where
// that one stopped.
function installListing(
	kept: KeptProductIndex,
	account: string,
	listed: CatalogListing,
	from: { startedAt: number; resumed: boolean },
	now: number,
) {
	const ids = productIndex(listed.items);
	for (const named of ids.keys()) kept.misses.delete(missKey(account, named));
	const current = indexOf(kept, account);
	if (
		current &&
		current.listedFrom !== null &&
		current.listedFrom > from.startedAt
	) {
		current.ids = new Map([...ids, ...current.ids]);
		return;
	}
	const replaces = listed.complete && !from.resumed;
	kept.current = {
		account,
		at: now,
		listedFrom: from.startedAt,
		ids: replaces || !current ? ids : new Map([...current.ids, ...ids]),
		complete: listed.complete || (current?.complete ?? false),
		resumeFrom: listed.complete ? null : (listed.next ?? null),
	};
}

// Whether another request's listing has landed, read from the index on this
// request's own timer: only finished data is kept across requests, as a Worker
// can't wait on I/O another request started. It has landed once the index
// holds a listing that started no earlier than it did, so an older one landing
// meanwhile is waited past. A marker that clears without that (the listing
// failed), or that outlives a listing's deadline, is a listing that never
// landed.
async function listingLanded(
	kept: KeptProductIndex,
	account: string,
	marker: ListingMarker,
	now: () => number,
	wait: (ms: number) => Promise<void>,
): Promise<boolean> {
	for (;;) {
		const from = indexOf(kept, account)?.listedFrom ?? null;
		if (from !== null && from >= marker.startedAt) return true;
		if (
			kept.listing !== marker ||
			now() - marker.startedAt >= CATALOG_READ_MS
		) {
			return false;
		}
		await wait(LISTING_POLL_MS);
	}
}

// A stale index is still served: the product page reads the product itself,
// so one gone since still 404s. A slug the index doesn't name is looked up on
// its own first, and what that finds is kept in the index, so the next view
// asks nothing. Only then is the catalog listed: once a minute behind a
// complete index, and once every 10 seconds behind one no listing has
// finished, going on from where a listing its deadline cut short stopped, and
// by one request at a time: the
// others read the index until its listing lands (`listingLanded`), and one
// whose listing never lands (it failed, or outlived its deadline) answers that
// the catalog couldn't be read, as the listing's own request does. A marker
// older than a listing's deadline is dead, and a new listing may start. Only a
// complete index answers that a slug isn't there, a miss for a minute
// (`MISSED_SLUG_MS`): asked again meanwhile, it costs nothing, and a listing
// that names it clears it. An index no listing has finished answers that the
// catalog couldn't be read, so the page offers to try again rather than 404 a
// product past the cut. The index is read again after every wait, as another
// request may have listed the catalog meanwhile.
export async function productIdFor(
	kept: KeptProductIndex,
	account: string,
	slug: string,
	reads: {
		list: (after: string | null) => Promise<CatalogListing>;
		lookUp: () => Promise<string | null>;
	},
	now: () => number = Date.now,
	wait: (ms: number) => Promise<void> = sleep,
): Promise<string | null> {
	const indexed = indexOf(kept, account)?.ids.get(slug);
	if (indexed) return indexed;
	if (kept.misses.get(missKey(account, slug), now())) return null;
	const missed = () => {
		if (!indexOf(kept, account)?.complete) throw new NoAnswer(CATALOG_READ_MS);
		const at = now();
		kept.misses.set(missKey(account, slug), true, at + MISSED_SLUG_MS, at);
		return null;
	};
	const found = await reads.lookUp();
	const current = indexOf(kept, account);
	if (found) {
		if (current) current.ids.set(slug, found);
		else {
			kept.current = {
				account,
				at: null,
				listedFrom: null,
				ids: new Map([[slug, found]]),
				complete: false,
				resumeFrom: null,
			};
		}
		return found;
	}
	const listedSince = current?.ids.get(slug);
	if (listedSince) return listedSince;
	if (
		current &&
		current.at !== null &&
		now() - current.at <
			(current.complete ? PRODUCT_INDEX_MS : PARTIAL_INDEX_MS)
	) {
		return missed();
	}
	const running = kept.listing;
	if (
		running?.account === account &&
		now() - running.startedAt < CATALOG_READ_MS
	) {
		if (!(await listingLanded(kept, account, running, now, wait))) {
			throw new NoAnswer(CATALOG_READ_MS);
		}
		return indexOf(kept, account)?.ids.get(slug) ?? missed();
	}
	const marker: ListingMarker = { account, startedAt: now() };
	const resumeFrom = current?.resumeFrom ?? null;
	kept.listing = marker;
	try {
		const listed = await reads.list(resumeFrom);
		installListing(
			kept,
			account,
			listed,
			{ startedAt: marker.startedAt, resumed: resumeFrom !== null },
			now(),
		);
	} finally {
		if (kept.listing === marker) kept.listing = null;
	}
	return indexOf(kept, account)?.ids.get(slug) ?? missed();
}
