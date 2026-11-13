import { createServerFn } from "@tanstack/react-start";
import {
	missing,
	pageRead,
	storefrontAccountId,
	storeSales,
	storeVariantApi,
	whopClient,
} from "../../whop.server";
import type {
	ChargedPayment,
	ChargeInputs,
	QuoteReading,
	Refusal,
} from "./charge-attempt";
import type { PaymentState } from "./payment-state";
import { STORE_UPDATED } from "./messages";
import { isRecord } from "./shared";
import {
	CHARGE_CALLS,
	QUOTE_CALLS,
	READ_CALLS,
	SALE_CHECK_MS,
} from "./deadline";
import {
	type MethodsRead,
	NO_WALLETS,
	type Order,
	type Quote,
	quoteSendsIp,
} from "./order";
import {
	chargeFor,
	currentSettings,
	STORE_UPDATED_REFUSAL,
	itemsRefusedForSale,
	onePerOrderRefusal,
	createKeptDocuments,
	handedQuoteFor,
	keptDocuments,
	loadOrderFor,
	logFailure,
	refusalOf,
	type OrderRefusal,
	paymentStateFor,
	planConfigurations,
	planLines,
	type OrderRequest,
	type QuoteRequest,
	quoteBody,
	quoteRequestOf,
	quoteWithSaleCheck,
	readQuoteFor,
	unreadIfForbidden,
} from "./order.handlers";
import {
	buyerIp,
	chargeQuoteApi,
	handoverQuoteApi,
	paymentReadApi,
	quoteOf,
	returnCheck,
	sellerDocuments,
	storeOrigins,
} from "./order.server";

const sellerReads = createKeptDocuments();

// Server-side because only server code holds the API credential. Each input
// type is what this store's pages send; a handler reads its `data` as unknown,
// since anyone can call these with any JSON. A POST, as a cart's lines in a
// GET's URL can pass the edge's limit before the server's own
// (`TOO_MANY_ITEMS`) answers.
export const loadOrder = createServerFn({ method: "POST" })
	.validator((input: OrderRequest): unknown => input)
	.handler(async ({ data }): Promise<Order | OrderRefusal | null> => {
		if (!currentSettings(data)) {
			return { refused: STORE_UPDATED, updated: true };
		}
		try {
			const store = storefrontAccountId();
			return await loadOrderFor(
				{
					store,
					linesFor: (items, lanes) =>
						planLines(storeVariantApi(), items, lanes),
					documents: () =>
						keptDocuments(sellerReads, store, () =>
							pageRead((client, options) =>
								sellerDocuments(client, store, options),
							),
						),
					sales: storeSales,
				},
				data,
			);
		} catch (failure) {
			logFailure("Loading an order", failure);
			throw failure;
		}
	});

export const quoteOrder = createServerFn({ method: "POST" })
	.validator((input: QuoteRequest): unknown => input)
	.handler(
		async ({ data }): Promise<{ quote: Quote } | { refusal: Refusal }> => {
			if (!currentSettings(data)) return { refusal: STORE_UPDATED_REFUSAL };
			const request = quoteRequestOf(data);
			if ("refusal" in request) return request;
			const { items } = request;
			const ip = quoteSendsIp(
				request.presentment,
				Boolean(request.shippingAddress),
			)
				? buyerIp()
				: undefined;
			try {
				const store = storefrontAccountId();
				const body = quoteBody(store, items, request, ip);
				const variants = storeVariantApi({ calls: QUOTE_CALLS });
				const answer = await quoteWithSaleCheck(
					() => itemsRefusedForSale(variants, store, items, storeSales),
					() => whopClient(QUOTE_CALLS).paymentQuotes.create(body),
					SALE_CHECK_MS,
				);
				return "refusal" in answer
					? answer
					: { quote: quoteOf(answer.quote, request.promoCode) };
			} catch (failure) {
				const refusal = refusalOf(failure);
				const limited = await onePerOrderRefusal(refusal, items, () =>
					storeVariantApi({ calls: QUOTE_CALLS }),
				);
				if (limited) return { refusal: limited };
				logFailure("Pricing an order", failure, { buyerIds: true });
				return { refusal };
			}
		},
	);

export const chargeQuote = createServerFn({ method: "POST" })
	.validator(
		(input: {
			key: string;
			inputs: ChargeInputs;
			resend?: true;
			settings: string;
		}): unknown => input,
	)
	.handler(
		async ({
			data,
		}): Promise<{ payment: ChargedPayment } | { refusal: Refusal }> =>
			chargeFor(
				() => ({
					api: {
						payments: whopClient(CHARGE_CALLS).payments,
						paymentQuotes: chargeQuoteApi(whopClient(READ_CALLS)).paymentQuotes,
					},
					store: storefrontAccountId(),
					origins: storeOrigins(),
					...returnCheck(),
					stale: !currentSettings(data),
				}),
				data,
				refusalOf,
			),
	);

export const readHandedQuote = createServerFn({ method: "POST" })
	.validator((input: QuoteRequest & { quoteId: string }): unknown => input)
	.handler(async ({ data }): Promise<{ quote: Quote } | null> => {
		if (!currentSettings(data)) return null;
		const handed = await handedQuoteFor(
			handoverQuoteApi(whopClient(READ_CALLS)),
			storefrontAccountId(),
			data,
			missing,
		);
		return handed
			? {
					quote: {
						...quoteOf(handed.quote, handed.promoCode),
						lifetimeMs: handed.lifetimeMs,
					},
				}
			: null;
	});

// For a charge Whop refused or never answered definitely: an attempt older than
// Whop's memory of its key, or a page restored from the browser's cache, can
// find its quote already used. The secret that continues the payment stays with
// the tab Whop gave it to.
export const readQuotePayment = createServerFn({ method: "POST" })
	.validator((input: { quoteId: string }): unknown => input)
	.handler(async ({ data }): Promise<QuoteReading | null> => {
		if (!isRecord(data) || typeof data.quoteId !== "string") return null;
		return readQuoteFor(
			paymentReadApi(whopClient(READ_CALLS), "quote"),
			storefrontAccountId(),
			data.quoteId,
			missing,
		);
	});

export const readPaymentState = createServerFn({ method: "POST" })
	.validator((input: { paymentId: string }): unknown => input)
	.handler(async ({ data }): Promise<PaymentState | null> => {
		if (!isRecord(data) || typeof data.paymentId !== "string") return null;
		return paymentStateFor(
			paymentReadApi(whopClient(READ_CALLS), "state"),
			storefrontAccountId(),
			data.paymentId,
		).catch((failure: unknown) => {
			logFailure("Reading a payment's status", unreadIfForbidden(failure), {
				buyerIds: true,
			});
			return null;
		});
	});

export const readVariantMethods = createServerFn({ method: "GET" })
	.validator((input: { planId: string }): unknown => input)
	.handler(async ({ data }): Promise<MethodsRead> => {
		if (!isRecord(data) || typeof data.planId !== "string") {
			return { configuration: NO_WALLETS };
		}
		const [read = { failed: true }] = await planConfigurations(
			storeVariantApi(),
			storefrontAccountId(),
			[data.planId],
		);
		return read;
	});
