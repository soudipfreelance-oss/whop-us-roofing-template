import { AUTO, isCountryPick } from "./presentment";
import { fnv1a, isRecord } from "./shared";

export type OrderLine = {
	planId: string;
	productId?: string;
	title: string;
	subtitle: string;
	image: string;
	quantity: number;
	price: number;
	originalPrice?: number;
};

export type PaymentMethodConfiguration = {
	enabled?: string[];
	disabled?: string[];
	include_platform_defaults?: boolean;
};

export const NO_WALLETS: PaymentMethodConfiguration = {
	include_platform_defaults: false,
	enabled: [],
};

// A null configuration means Whop's platform defaults.
export type MethodsRead =
	| { configuration: PaymentMethodConfiguration | null }
	| { failed: true };

export type Seller = { accountId: string; name: string };

// Whop's API documents a variant with no configuration of its own as taking
// the platform defaults, which Elements applies as `include_platform_defaults:
// true` with nothing enabled or disabled, so none and that one key alike.
export function configurationKey(
	configuration: PaymentMethodConfiguration | undefined,
): string {
	return JSON.stringify([
		[...(configuration?.enabled ?? [])].sort(),
		[...(configuration?.disabled ?? [])].sort(),
		configuration?.include_platform_defaults ?? true,
	]);
}

// Elements' payment element and wallet sheet can't change these once created.
export function paymentSetupKey(order: Order): string {
	return JSON.stringify([
		order.seller.accountId,
		order.setupFutureUsage ?? null,
		configurationKey(order.paymentMethodConfiguration),
	]);
}

export type PolicyLink = { label: string; href: string };

type PublishedDocument = { url: string | null } | null;

// In the order Whop's own checkout links them.
export function sellerDocumentsOf(account: {
	terms_of_service: PublishedDocument;
	privacy_policy: PublishedDocument;
	return_policy: PublishedDocument;
	eula: PublishedDocument;
}): PolicyLink[] {
	return [
		{ label: "Terms of Service", href: account.terms_of_service?.url },
		{ label: "Privacy Policy", href: account.privacy_policy?.url },
		{ label: "Refund Policy", href: account.return_policy?.url },
		{ label: "EULA", href: account.eula?.url },
	].flatMap(({ label, href }) => (href ? [{ label, href }] : []));
}

// Both come from Whop's own Money, never a table kept here: COP is charged in
// centavos but written in whole pesos.
export type MoneyFormat = {
	currency: string;
	decimals: number;
	displayDecimals: number;
};

export type ApiMoney = {
	amount: string;
	currency: string;
	decimals: number;
	display_decimals: number;
};

export function isApiMoney(value: unknown): value is ApiMoney {
	return (
		isRecord(value) &&
		typeof value.amount === "string" &&
		typeof value.currency === "string" &&
		typeof value.decimals === "number" &&
		typeof value.display_decimals === "number"
	);
}

// A currency is lowercased once, as Whop's answer is read, so any two compare
// as they are, whatever case Whop wrote them in.
export function formatOf(value: ApiMoney): MoneyFormat {
	return {
		currency: value.currency.toLowerCase(),
		decimals: value.decimals,
		displayDecimals: value.display_decimals,
	};
}

// A payment's lines and total are each stated in the currency the buyer paid
// in, which can differ from the one it settles in.
export type Amount = { units: number; money: MoneyFormat };

export function amountOf(value: ApiMoney | null): Amount | null {
	if (!value) return null;
	if (!Number.isFinite(Number(value.amount))) return null;
	return {
		units: minorUnits(value.amount, value.decimals),
		money: formatOf(value),
	};
}

// A paid order's discount and added tax, for the order-complete summary.
// Whop's payment states no discount: its `subtotal` is the price before
// discounts, tax and fees, and its `total` the price after discounts with any
// tax added on top. So the discount is worked out from them, and only where
// that is exact: every figure in the one currency the buyer paid in, and the
// lines adding up to the subtotal. A converted payment's subtotal and tax are
// in the store's currency while its lines and total are the buyer's, and
// converting either would round, so it gets neither row.
export function paymentBreakdown(payment: {
	subtotal: ApiMoney | null;
	total: ApiMoney | null;
	presentment_total: ApiMoney | null;
	tax_amount: ApiMoney | null;
	tax_behavior: string | null;
	line_items: ReadonlyArray<{ subtotal: ApiMoney | null }>;
}): { discount: Amount | null; tax: Amount | null } {
	const none = { discount: null, tax: null };
	const subtotal = amountOf(payment.subtotal);
	const total = amountOf(payment.total);
	if (!subtotal || !total) return none;
	const inTotal = (amount: Amount | null): amount is Amount =>
		amount !== null && amount.money.currency === total.money.currency;
	const shown = payment.presentment_total
		? amountOf(payment.presentment_total)
		: total;
	if (!inTotal(subtotal) || !inTotal(shown) || shown.units !== total.units) {
		return none;
	}
	const lines = payment.line_items.map((item) => amountOf(item.subtotal));
	const linesTotal = lines.reduce<number | null>(
		(sum, line) => (inTotal(line) && sum !== null ? sum + line.units : null),
		0,
	);
	if (linesTotal !== subtotal.units) return none;
	const added =
		payment.tax_behavior === "exclusive" ? amountOf(payment.tax_amount) : null;
	if (added && !inTotal(added)) return none;
	const discount = subtotal.units + (added?.units ?? 0) - total.units;
	if (discount < 0) return none;
	return {
		discount: discount > 0 ? { units: discount, money: total.money } : null,
		tax: added && added.units > 0 ? added : null,
	};
}

export type Order = {
	money: MoneyFormat;
	lines: OrderLine[];
	seller: Seller;
	sellerDocuments?: PolicyLink[];
	// The seller's documents couldn't be read: the terms box can't show which
	// the buyer agrees to.
	policiesUnread?: boolean;
	// Whop refused the documents read itself (a 401, 403, 404 or another
	// definite 4xx), so asking again fails the same way until the store's setup
	// is fixed.
	policiesRefused?: boolean;
	origin: OrderOrigin;
	paymentMethodConfiguration?: PaymentMethodConfiguration;
	// The payment element then offers only methods that can be saved and says so,
	// and PayPal's one-time sheet isn't offered.
	setupFutureUsage?: "off_session";
};

export type OrderItem = { planId: string; quantity: number };

// An estimate from the buyer's IP with no tax is the normal state before an
// address, as tax is worked out on the address; only an address quote's
// missing tax is a failure.
export function taxFailed(quote: Quote | null): boolean {
	return quote?.taxStatus === "unavailable" && !quote.estimated;
}

export function withCartImages(
	order: Order,
	cart: ReadonlyArray<{ planId: string; image?: string }>,
): Order {
	const images = new Map(
		cart.flatMap((line) => (line.image ? [[line.planId, line.image]] : [])),
	);
	return {
		...order,
		lines: order.lines.map((line) =>
			line.image ? line : { ...line, image: images.get(line.planId) ?? "" },
		),
	};
}

export type OrderOrigin = "cart" | "link" | "express";

export function futureUsageFor(
	planTypes: readonly string[],
): "off_session" | undefined {
	return planTypes.includes("renewal") ? "off_session" : undefined;
}

// Whop's own limit on one line's quantity: a cart line holds no more, and the
// server refuses a line asking for more.
export const MAX_LINE_QUANTITY = 999_999;

// The one rule for a line's quantity, wherever it is set (the cart, a saved
// cart, a link) or checked (the server): a whole number, held to
// MAX_LINE_QUANTITY. Less than one is no line.
export function lineQuantity(quantity: number): number {
	return Number.isFinite(quantity)
		? Math.min(Math.floor(quantity), MAX_LINE_QUANTITY)
		: 0;
}

export function isLineQuantity(quantity: unknown): quantity is number {
	return (
		typeof quantity === "number" &&
		quantity >= 1 &&
		lineQuantity(quantity) === quantity
	);
}

// A link's quantity is raised to one. A repeated `quantity`, like a repeated
// `items`, is a broken link, null.
export function linkQuantity(raw: unknown): number | null {
	if (Array.isArray(raw)) return null;
	return Math.max(lineQuantity(Number(raw ?? 1)), 1);
}

// A rewritten URL can name any variant of the account, a cheaper hidden one
// included: Whop sells those by link too, at Whop's price, never one the URL
// names, and the server functions refuse what the store doesn't sell
// (`soldByStore`). Items that don't read (a repeated `items`, an entry that
// isn't a plan and a whole count of at least one) are a broken link, null,
// never part of the cart. A plan named more than once is one line, and every
// line is held to the line rule (`lineQuantity`), as the cart's are.
export function parseItems(raw: unknown): OrderItem[] | null {
	if (raw === undefined || raw === "") return [];
	if (typeof raw !== "string") return null;
	const items: OrderItem[] = [];
	for (const entry of raw.split(",")) {
		const [planId, count, ...rest] = entry.split(":");
		const quantity = Number(count ?? 1);
		if (
			!planId ||
			rest.length > 0 ||
			!Number.isInteger(quantity) ||
			quantity < 1
		) {
			return null;
		}
		items.push({ planId, quantity });
	}
	return mergeItems(items).map(({ planId, quantity }) => ({
		planId,
		quantity: lineQuantity(quantity),
	}));
}

// A cart line Whop no longer sells here, by the title the server read for it,
// or null when it has none to give (a variant Whop doesn't know, or another
// account's). `left` is how many the store still has of one whose stock is
// below the line's quantity.
export type GoneLine = { planId: string; title: string | null; left?: number };

export function goneTitles(
	gone: readonly GoneLine[],
	cart: ReadonlyArray<{ planId: string; title: string }>,
): GoneLine[] {
	return gone.map((line) => ({
		...line,
		title:
			line.title ??
			cart.find((entry) => entry.planId === line.planId)?.title ??
			null,
	}));
}

// The checkout link's search for a cart, as the cart drawer and the gone-lines
// notice both build it: the first line names the route, every line `items`.
export function checkoutSearchFor(
	items: readonly OrderItem[],
): { planId: string; quantity: number; items: string } | null {
	const [first] = items;
	if (!first) return null;
	return {
		planId: first.planId,
		quantity: first.quantity,
		items: items.map((item) => `${item.planId}:${item.quantity}`).join(","),
	};
}

// A gone line comes out, and a line short of stock is held to what is left,
// never raised above what it holds.
export function withoutGone<T extends OrderItem>(
	items: readonly T[],
	gone: readonly GoneLine[],
): T[] {
	return items.flatMap((item) => {
		const line = gone.find((entry) => entry.planId === item.planId);
		if (!line) return [item];
		return line.left
			? [{ ...item, quantity: Math.min(item.quantity, line.left) }]
			: [];
	});
}

// A checkout link as the loader and the gone-lines notice both read it: its
// `items` when it names any (a cart's checkout), otherwise its route's plan in
// the link's own quantity. Null for a link that doesn't read.
export type CheckoutLink = {
	planId: string;
	quantity: number;
	// Empty for a plan's own link.
	items: OrderItem[];
};

export function checkoutLink(
	planId: string,
	search: { quantity?: unknown; items?: unknown },
): CheckoutLink | null {
	const items = parseItems(search.items);
	const quantity = linkQuantity(search.quantity);
	if (items === null || quantity === null) return null;
	return { planId, quantity, items };
}

export function linkLines(link: CheckoutLink): OrderItem[] {
	return link.items.length > 0
		? link.items
		: [{ planId: link.planId, quantity: link.quantity }];
}

// What the gone-lines notice does. A cart's checkout whose items are the
// stored cart's lines (the same variants, whatever another tab did to their
// quantities since it loaded) is the cart's: the cart as it stands loses its
// gone lines and holds its short ones to what is left (`cart`), and is checked
// out next. Any other checkout came from a link, maybe shared into a browser
// with another cart or none: the cart is left alone (`cart` null), and the
// link's own lines, less the gone ones, are checked out next, a plan's own
// link staying one. `lines` are what goes on; with none, there is no next
// checkout.
export function afterGoneLines<T extends OrderItem>(
	link: CheckoutLink,
	stored: readonly T[],
	gone: readonly GoneLine[],
): {
	cart: T[] | null;
	lines: OrderItem[];
	next: { planId: string; quantity: number; items?: string } | null;
} {
	const variants = (lines: readonly OrderItem[]) =>
		[...new Set(lines.map((line) => line.planId))].sort().join(",");
	if (
		link.items.length > 0 &&
		stored.length > 0 &&
		variants(link.items) === variants(stored)
	) {
		const cart = withoutGone(stored, gone);
		return { cart, lines: cart, next: checkoutSearchFor(cart) };
	}
	const lines = withoutGone(linkLines(link), gone);
	const [only] = lines;
	const next =
		link.items.length === 0 && only
			? { planId: only.planId, quantity: only.quantity }
			: checkoutSearchFor(lines);
	return { cart: null, lines, next };
}

export function cartKeyOf(items: readonly OrderItem[]): string {
	return mergeItems(items)
		.sort((a, b) => (a.planId < b.planId ? -1 : a.planId > b.planId ? 1 : 0))
		.map(({ planId, quantity }) => `${planId}:${quantity}`)
		.join(",");
}

export function orderKeyOf(order: Order): string {
	return cartKeyOf(order.lines);
}

// Without the origin, a product page's one-tap would mark a cart checkout of
// the same item paid. The digest keeps any cart short enough for a return URL.
export function orderTag(origin: OrderOrigin, orderKey: string): string {
	return `${origin}-${fnv1a(orderKey).toString(36)}`;
}

export function orderTagOf(order: Order): string {
	return orderTag(order.origin, orderKeyOf(order));
}

// Whop prices a plan named twice as one line, so the page's lines must match.
export function mergeItems(items: readonly OrderItem[]): OrderItem[] {
	const merged = new Map<string, number>();
	for (const { planId, quantity } of items) {
		merged.set(planId, (merged.get(planId) ?? 0) + quantity);
	}
	return [...merged].map(([planId, quantity]) => ({ planId, quantity }));
}

// Whop sends whole-currency decimals.
export function minorUnits(
	amount: number | string | null | undefined,
	decimals: number,
): number {
	const value = Number(amount ?? 0);
	return Number.isFinite(value) ? Math.round(value * 10 ** decimals) : 0;
}

// Whop's `initial_price_due` is the initial price plus a renewal's first
// period unless a trial applies, and each part has its own struck price.
export function planLinePrices(plan: {
	dueToday: ApiMoney;
	initialPrice: number;
	struckInitialPrice: number | null;
	struckRenewalPrice: number | null;
	quantity: number;
}): { price: number; originalPrice: number | undefined } {
	const { decimals } = plan.dueToday;
	const dueToday = minorUnits(plan.dueToday.amount, decimals);
	const initial = minorUnits(plan.initialPrice, decimals);
	const firstPeriod = dueToday - initial;
	const struckPeriod = firstPeriod > 0 ? plan.struckRenewalPrice : null;
	if (plan.struckInitialPrice === null && struckPeriod === null) {
		return { price: dueToday * plan.quantity, originalPrice: undefined };
	}
	const struck =
		(plan.struckInitialPrice === null
			? initial
			: minorUnits(plan.struckInitialPrice, decimals)) +
		(struckPeriod === null ? firstPeriod : minorUnits(struckPeriod, decimals));
	return {
		price: dueToday * plan.quantity,
		originalPrice: struck * plan.quantity,
	};
}

const formats = new Map<string, Intl.NumberFormat>();

export function money(amount: number, format: MoneyFormat): string {
	const key = `${format.currency}:${format.displayDecimals}`;
	let formatter = formats.get(key);
	if (!formatter) {
		formatter = new Intl.NumberFormat("en-US", {
			style: "currency",
			currency: format.currency,
			minimumFractionDigits: format.displayDecimals,
			maximumFractionDigits: format.displayDecimals,
		});
		formats.set(key, formatter);
	}
	return formatter.format(amount / 10 ** format.decimals);
}

// Whop sells a hidden variant by its link. The store sells none generated for
// an invoice, which Whop's charge would still take, and none archived, on a
// waitlist or out of stock, which Whop's charge refuses only once the buyer has
// entered a card. The product page and the server read this one rule. A
// variant's read names its product by id and title alone, so an archived
// product's variants are left to Whop's charge.
export function soldByStore(variant: unknown): boolean {
	return (
		isRecord(variant) &&
		variant.invoice === null &&
		variant.visibility !== "archived" &&
		variant.release_method !== "waitlist" &&
		!(variant.unlimited_stock === false && variant.stock === 0)
	);
}

export function shownByStore(variant: unknown): boolean {
	return (
		isRecord(variant) &&
		variant.visibility === "visible" &&
		variant.invoice === null
	);
}

// Only a variant with limited stock can stop being for sale, or start again,
// without the seller editing it.
export function stockLimited(variant: unknown): boolean {
	return isRecord(variant) && variant.unlimited_stock === false;
}

// How many of a variant one order can buy here: none of one the store doesn't
// sell, and no more than the stock of one whose stock is limited, as Whop's
// charge refuses more only once the buyer has entered a card. Whop shows
// `stock` only to a key with the `plan:basic:read` scope, so a limited
// variant can come with none: its stock is unknown, so it is neither refused
// for stock nor taken as unlimited, held to what a line takes, and Whop's
// charge decides.
export function unitsForSale(variant: unknown): number {
	if (!isRecord(variant) || !soldByStore(variant)) return 0;
	if (!stockLimited(variant)) return Number.POSITIVE_INFINITY;
	return typeof variant.stock === "number" ? variant.stock : MAX_LINE_QUANTITY;
}

// Named as Whop's own checkout links name them (`promoCode`, `a`). Campaign
// tags are left to the Whop pixel, which hosting adds and which reads them from
// the URL.
export type LinkInputs = {
	promoCode?: string;
	affiliateCode?: string;
};

// Whop's charge takes any affiliate code of up to 255 characters, so one an
// older username rule allowed (an underscore, a dot) still credits its
// affiliate. Whitespace or a control character is never part of one.
export const AFFILIATE_CODE = /^[^\s\p{Cc}]{1,255}$/u;
const VALUE_LIMIT = 512;

// Whop's own limit on a promo code: up to 40 characters, none of them a
// control character (C0, DEL or C1, as for an affiliate code). Counted by code
// point, as Ruby's String#length counts them, so an emoji is one.
const CONTROL = /\p{Cc}/u;

export function promoCodeOk(code: string): boolean {
	const length = [...code].length;
	return length >= 1 && length <= 40 && !CONTROL.test(code);
}

// The router keeps every search param as text (search-text.ts), so a code
// arrives exactly as the link carried it.
function searchParam(
	search: Record<string, unknown>,
	key: string,
): string | undefined {
	const value = search[key];
	const text = typeof value === "string" ? value.trim() : "";
	return text && text.length <= VALUE_LIMIT ? text : undefined;
}

export function linkInputsOf(search: Record<string, unknown>): LinkInputs {
	const affiliateCode = [searchParam(search, "a"), searchParam(search, "af")]
		.filter((code) => code !== undefined)
		.find((code) => AFFILIATE_CODE.test(code));
	const promoCode = searchParam(search, "promoCode");
	return {
		promoCode: promoCode && promoCodeOk(promoCode) ? promoCode : undefined,
		affiliateCode,
	};
}

// The fields a Whop address takes besides `country`: its payment and payment
// quote inputs keep only these and drop any other key. Quoting, charging and a
// stored attempt all check an address with the one `addressOf`.
export const ADDRESS_FIELDS = [
	"name",
	"line1",
	"line2",
	"city",
	"state",
	"postal_code",
] as const;

export type AddressField = (typeof ADDRESS_FIELDS)[number];

export type Address = Partial<
	Record<(typeof ADDRESS_FIELDS)[number], string>
> & { country: string };

// What Whop's address element gives: an address whose name may come split in
// two, which Whop's own address doesn't take; it is joined into `name`
// (`addressName`).
export type AddressInput = Address & {
	first_name?: string;
	last_name?: string;
};

// Whop's own limits: a two-letter country, and values of up to 255 characters,
// counted in code points (as promoCodeOk counts), so an emoji is one.
const ADDRESS_VALUE_LIMIT = 255;

// The one rule for an address, wherever it comes from (the page's form, a
// wallet sheet, a stored attempt, the server's input): every value trimmed, a
// blank one left out, a name split in two joined when there is no name, and
// only Whop's keys kept. A value that isn't text, a country that isn't two
// letters, or a value over Whop's limit is no address.
export function addressOf(value: unknown): Address | null {
	const read = readAddress(value);
	return read && "address" in read ? read.address : null;
}

// The first field over Whop's limit, which makes an address no address, so
// the page can say which to shorten.
export function addressTooLong(value: unknown): AddressField | null {
	const read = readAddress(value);
	return read && "tooLong" in read ? read.tooLong : null;
}

function readAddress(
	value: unknown,
): { address: Address } | { tooLong: AddressField } | null {
	if (!isRecord(value)) return null;
	const parts: Record<string, string | undefined> = {};
	for (const key of [...ADDRESS_FIELDS, "first_name", "last_name", "country"]) {
		const entry = value[key];
		if (entry === undefined || entry === null) continue;
		if (typeof entry !== "string") return null;
		const trimmed = entry.trim();
		if (trimmed) parts[key] = trimmed;
	}
	const country = parts.country;
	if (!country || !/^[a-z]{2}$/i.test(country)) return null;
	const address: Address = { country };
	for (const field of ADDRESS_FIELDS) {
		const entry =
			field === "name"
				? (parts.name ??
					addressName({
						first_name: parts.first_name,
						last_name: parts.last_name,
					}))
				: parts[field];
		if (entry === undefined) continue;
		if ([...entry].length > ADDRESS_VALUE_LIMIT) return { tooLong: field };
		address[field] = entry;
	}
	return { address };
}

export function deliveryPlace(address: Address): string {
	const town = [address.city, address.state].filter(Boolean).join(", ");
	return town || address.postal_code || address.country;
}

export type AddressValue = {
	complete: boolean;
	address: AddressInput;
};

export type EmailValue = {
	email: string;
	complete: boolean;
};

// Joined the way Elements joins it for the card's billing details.
export function addressName(
	address: Partial<AddressInput>,
): string | undefined {
	const joined = [address.first_name, address.last_name]
		.map((part) => part?.trim())
		.filter(Boolean)
		.join(" ");
	return address.name?.trim() || joined || undefined;
}

// The recipient's name is left out: it doesn't change the tax.
export function addressKey(value: unknown): string | null {
	const address = addressOf(value);
	if (!address) return null;
	return JSON.stringify([
		address.country,
		address.state,
		address.postal_code,
		address.city,
		address.line1,
		address.line2,
	]);
}

// A code the order keeps for its next quote, which asks for it: the one with
// the buyer's address (`address`, Whop needs it first), or any, once Whop
// answers (`answer`).
export type PromoAwaiting = { code: string; until: "address" | "answer" };

export function promoShown(state: {
	asked: string | null;
	quote: Quote | null;
	entry: boolean;
	error: string | null;
	awaiting?: PromoAwaiting | null;
}): {
	visible: boolean;
	applied: string | null;
	awaiting: PromoAwaiting | null;
} {
	const awaiting =
		state.awaiting &&
		state.asked === state.awaiting.code &&
		state.quote?.promoCode !== state.awaiting.code
			? state.awaiting
			: null;
	const applied = awaiting
		? null
		: (state.asked ?? state.quote?.promoCode ?? null);
	return {
		visible: Boolean(state.entry || applied || awaiting || state.error),
		applied,
		awaiting,
	};
}

// The methods that need a billing phone take it in E.164 (`+14155552671`).
export function billingPhone(raw: string): string | null {
	const phone = raw.trim().replace(/[\s().-]/g, "");
	return /^\+[1-9]\d{6,14}$/.test(phone) ? phone : null;
}

// The name goes on the token beside it (`addressName`).
export function billingPayload(value: AddressValue) {
	const address = addressOf(value.address);
	if (!address) return undefined;
	const { line1, line2, city, state, postal_code, country } = address;
	return { line1, line2, city, state, postal_code, country };
}

// The element calls a form complete whatever its lengths, so payment waits on
// a billing address the charge can send, as it waits on the delivery address:
// a field over Whop's limit leaves none (`addressTooLong`).
export function billingReady(value: AddressValue | null): boolean {
	return (
		value !== null && value.complete && billingPayload(value) !== undefined
	);
}

export type TaxStatus = "calculated" | "not_applicable" | "unavailable";
export type TaxBehavior = "exclusive" | "inclusive";

// A quote located by the buyer's IP (`estimated`) is never charged.
export type Quote = {
	id: string;
	money: MoneyFormat;
	baseMoney: MoneyFormat;
	exchangeRate: string | null;
	baseTotal: number;
	recommendedCurrencies: string[];
	taxStatus: TaxStatus;
	taxBehavior: TaxBehavior | null;
	subtotal: number;
	discount: number;
	tax: number;
	total: number;
	lines: Array<{ planId: string | null; subtotal: number }>;
	promoCode: string | null;
	estimated: boolean;
	// How long Whop keeps the quote, from its own `created_at` to its
	// `expires_at`, so no clock but Whop's is read.
	lifetimeMs: number;
};

export const PAYABLE_MARGIN_MS = 60_000;

// A time that doesn't parse leaves no lifetime: the quote counts as expired
// everywhere it is judged, and is asked for again.
export function quoteLifetimeMs(createdAt: string, expiresAt: string): number {
	const lifetime = Date.parse(expiresAt) - Date.parse(createdAt);
	return Number.isFinite(lifetime) && lifetime > 0 ? lifetime : 0;
}

// `deadline` is this device's clock at receipt plus the quote's lifetime, never
// Whop's `expires_at` against the device's clock, which can be off by any
// amount (as Elements times its challenge offers, `challengeDeadlineOf`).
export type PageQuote = Quote & {
	addressKey: string | null;
	presentment: string | undefined;
	promoAsked: string | null;
	deadline: number;
};

// `auto` is the currency of the buyer's IP country, which Whop falls back from
// to the plans' own by itself.
export function presentmentFor(
	adaptivePricing: boolean,
	picked: string | null,
	baseCurrency: string | null,
): string | undefined {
	if (!adaptivePricing) return undefined;
	if (!picked) return AUTO;
	return picked === baseCurrency ? undefined : picked;
}

// A delivery address locates the buyer for tax; `auto` reads the currency from
// the IP even then, and with a country pick Whop judges what can collect it
// where the IP is.
export function quoteSendsIp(
	presentment: string | undefined,
	hasShippingAddress: boolean,
): boolean {
	return (
		!hasShippingAddress || presentment === AUTO || isCountryPick(presentment)
	);
}

export function shownMoney(order: Order, quote: Quote | null): MoneyFormat {
	return quote?.money ?? order.money;
}

// Display only: every charged figure comes from the quote.
export function inQuoteCurrency(
	amount: number,
	order: Order,
	quote: Quote | null,
): number | null {
	if (!quote || quote.money.currency === order.money.currency) {
		return amount;
	}
	const rate = Number(quote.exchangeRate);
	if (!quote.exchangeRate || !Number.isFinite(rate)) return null;
	const whole = amount / 10 ** order.money.decimals;
	return Math.round(whole * rate * 10 ** quote.money.decimals);
}

// A product page's price line from its variant's own quote (`ExpressBuy`): the
// quote's line, and with a code applied, the price after it with the line's
// own struck through. Null for a quote of anything else.
export function quotedPrice(
	quote: Quote | null,
	planId: string,
): { price: Amount; struck: Amount | null } | null {
	const line = quote?.lines.length === 1 ? quote.lines[0] : undefined;
	if (!quote || !line || line.planId !== planId) return null;
	const listed = { units: line.subtotal, money: quote.money };
	return quote.discount < 0
		? {
				price: { units: line.subtotal + quote.discount, money: quote.money },
				struck: listed,
			}
		: { price: listed, struck: null };
}

// Judged in the plans' own currency, so a conversion's rounding never makes a
// price look struck through.
export function struckPrice(line: OrderLine): number | undefined {
	return line.originalPrice !== undefined && line.originalPrice > line.price
		? line.originalPrice
		: undefined;
}

export function struckSavings(order: Order, quote: Quote | null): number {
	const struck = order.lines.reduce(
		(sum, line) => sum + (struckPrice(line) ?? line.price) - line.price,
		0,
	);
	return inQuoteCurrency(struck, order, quote) ?? 0;
}

export function amountDue(
	order: Order,
	quote: Quote | null,
): { amount: number; currency: string } {
	return quote
		? { amount: quote.total, currency: quote.money.currency }
		: {
				amount: order.lines.reduce((sum, line) => sum + line.price, 0),
				currency: order.money.currency,
			};
}

export function quotedLinePrice(
	order: Order,
	quote: Quote | null,
	line: OrderLine,
): number | null {
	const quoted = quote?.lines.find((entry) => entry.planId === line.planId);
	return quoted ? quoted.subtotal : inQuoteCurrency(line.price, order, quote);
}

// The sheet's lines must add up to its total, so the discount and any added tax
// get their own.
export function walletLineItems(order: Order, quote: Quote | null) {
	const lines = order.lines.flatMap((line) => {
		const amount = quotedLinePrice(order, quote, line);
		return amount === null ? [] : [{ label: line.title, amount }];
	});
	if (!quote) return lines;
	const discount =
		quote.discount < 0
			? [
					{
						label: quote.promoCode
							? `Discount (${quote.promoCode})`
							: "Discount",
						amount: quote.discount,
					},
				]
			: [];
	const tax =
		quote.taxBehavior === "exclusive" && quote.tax > 0
			? [
					{
						label: quote.estimated ? "Estimated tax" : "Tax",
						amount: quote.tax,
					},
				]
			: [];
	return [...lines, ...discount, ...tax];
}

// Apple redacts the sheet's address before the buyer pays, and some countries'
// postal codes arrive cut short.
export function compactPlace(value: string | undefined): string {
	return (value ?? "").toUpperCase().replace(/[\s-]/g, "");
}

// `blank` is how a field the redacted address left empty counts: as one the
// full address must leave empty too, or, for a total the buyer was already
// told, as unknown, so it doesn't rule the told address out.
export function samePlace(
	full: Address,
	redacted: Address,
	blank: "empty" | "unknown" = "empty",
): boolean {
	const agrees = (
		kept: string | undefined,
		shown: string | undefined,
		match: (kept: string, shown: string) => boolean,
	) => {
		const cut = compactPlace(shown);
		if (cut === "") return blank === "unknown" || compactPlace(kept) === "";
		return match(compactPlace(kept), cut);
	};
	const equal = (kept: string, shown: string) => kept === shown;
	return (
		compactPlace(full.country) === compactPlace(redacted.country) &&
		agrees(full.state, redacted.state, equal) &&
		agrees(full.city, redacted.city, equal) &&
		agrees(full.postal_code, redacted.postal_code, (kept, shown) =>
			kept.startsWith(shown),
		)
	);
}
