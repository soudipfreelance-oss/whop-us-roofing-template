import type {
	PaymentRequestResource,
	WalletButtonArt,
} from "@whop/elements/payments";
import {
	type PaymentRequestUpdate,
	type ShippingAddressChangeEvent,
	useWhop,
} from "@whop/elements-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChargeAttempt } from "./charge-attempt";
import type { ChargeRun } from "./charge-flow";
import {
	addressTooLongMessage,
	BuyerError,
	PROMO_NOT_APPLIED,
	QUOTE_UNAVAILABLE,
	repricedMessage,
	SHIP_COUNTRY_REFUSED,
	WALLET_ADDRESS_NEEDED,
	WALLET_ADDRESS_UNPRICED,
	buyerCanceled,
	markedOrderError,
	walletMessage,
} from "./messages";
import {
	type Address,
	addressOf,
	addressTooLong,
	amountDue,
	deliveryPlace,
	type Order,
	orderTagOf,
	type PageQuote,
	paymentSetupKey,
	taxFailed,
} from "./order";
import { quoteFailure } from "./quote-flow";
import type { ChargeControls } from "./use-charge-attempt";
import { documentVisibility } from "./use-page-visibility";
import { shipCountries, shipsTo } from "./settings";
import {
	answerShippingAddress,
	createSheetQuotes,
	createSheetRequests,
	offeredWallets,
	openSheet,
	liveWalletQuote,
	reusableWalletQuote,
	sameAddress,
	sheetAnswer,
	type SheetAnswer,
	sheetKey,
	sheetPrice,
	walletsOpenable,
	type WalletFlags,
	type WalletQuote,
	walletQuoteRefusal,
	walletQuoteToKeep,
	walletRequote,
	type WalletType,
} from "./wallet-sheet";

type WalletSheetProps = {
	order: Order;
	charge: ChargeControls;
	opening: { quote: PageQuote | null } | null;
	quote: PageQuote | null;
	// Elements fixes a sheet's currency once it is built.
	currency: string | null;
	methodsKnown?: boolean;
	quoteRef: { current: PageQuote | null };
	promoRef: { current: string | null };
	// Asked in the currency the sheet was built in, which it can't change.
	requestQuote: (
		address: Address | null,
		promoCode: string | null,
		currency: string,
	) => Promise<PageQuote>;
	unchargeable: (
		quote: PageQuote,
		address: Address,
		currency: string,
	) => string | null;
	dropUnappliedPromo: (quote: PageQuote) => void;
	// A quote the page retired (`retireQuote`) is never offered again.
	retired: (quoteId: string) => boolean;
	refreshQuote: () => Promise<PageQuote | null>;
	runCharge: (task: (run: ChargeRun) => Promise<void>) => Promise<void>;
	payQuote: (
		priced: PageQuote,
		confirmationToken: string,
		address: Address,
		requote: () => Promise<PageQuote | null>,
		run: ChargeRun,
	) => Promise<void>;
	resendStored: (attempt: ChargeAttempt) => void;
	// Elements' wallet takes it instead of asking for its own.
	payerEmail?: string;
	requests: SheetRequests;
};

type LiveSheet = {
	key: string;
	setup: string;
	request: PaymentRequestResource;
	currency: string;
	types: WalletType[];
	// Written again after the sheet closes, for the next opening, so what the
	// buyer saw is read at the close.
	shownAmount: number;
	release: () => void;
};

type ProbeResult = { ready: WalletFlags; button: WalletButtonArt | null };

export type Probed = ProbeResult & { key: string; setup: string };

const NO_WALLET_READY: WalletFlags = {
	applePay: false,
	googlePay: false,
	payPal: false,
};

// The published resource has no `dispose()` yet; one that does is released
// through it, after its listeners.
function disposeRequest(request: PaymentRequestResource) {
	if ("dispose" in request && typeof request.dispose === "function") {
		request.dispose();
	}
}

type SheetEvent = { updateWith: (update: PaymentRequestUpdate) => void };

type SheetHandlers = {
	build: (key: string) => LiveSheet | null;
	answerShippingChange: (
		event: ShippingAddressChangeEvent,
		sheet: LiveSheet,
	) => Promise<void>;
	answerChange: (event: SheetEvent, sheet: LiveSheet) => void;
	primed: (sheet: LiveSheet) => void;
};

export type SheetRequests = {
	sheets: ReturnType<typeof createSheetRequests<LiveSheet, ProbeResult>>;
	handlers: { current: SheetHandlers | null };
	// Elements' show() refuses until canMakePayment() has answered.
	probed: Probed | null;
};

// The request is built ahead of the tap, because Apple only opens the sheet
// when show() runs inside the tap.
export function useSheetRequests(): SheetRequests {
	const handlers = useRef<SheetHandlers | null>(null);
	const [probed, setProbed] = useState<Probed | null>(null);
	const [page] = useState(() => documentVisibility());
	const [sheets] = useState(() =>
		createSheetRequests<LiveSheet, ProbeResult>({
			build: (key) => handlers.current?.build(key) ?? null,
			probe: (sheet) =>
				sheet.request
					.canMakePayment({ types: sheet.types })
					.then((available) => ({
						ready: {
							applePay: Boolean(available?.applePay),
							googlePay: Boolean(available?.googlePay),
							payPal: Boolean(available?.payPal),
						},
						button: available?.wallets?.paypal_express?.button ?? null,
					})),
			primed: (sheet, result) => {
				setProbed({ ...result, key: sheet.key, setup: sheet.setup });
				handlers.current?.primed(sheet);
			},
			unprimed: () => setProbed(null),
			unanswered: (sheet) =>
				setProbed({
					ready: NO_WALLET_READY,
					button: null,
					key: sheet.key,
					setup: sheet.setup,
				}),
			hidden: () => !page.visible(),
		}),
	);
	useEffect(() => {
		const unwatch = page.watch(() => {
			if (page.visible()) sheets.shown();
		});
		return () => {
			unwatch();
			sheets.release();
		};
	}, [page, sheets]);
	return { sheets, handlers, probed };
}

export function useWalletSheet(props: WalletSheetProps) {
	const {
		order,
		opening,
		quote,
		currency,
		quoteRef,
		promoRef,
		requestQuote,
		runCharge,
		payQuote,
		resendStored,
		payerEmail,
		requests,
	} = props;
	const whop = useWhop();
	const { sheets } = requests;
	const [sheetQuotes] = useState(() => createSheetQuotes<PageQuote>());
	const walletQuoteRef = useRef<WalletQuote | null>(null);

	const configuration = order.paymentMethodConfiguration;
	const offered = offeredWallets(configuration);
	// Undefined is "not known yet": nothing built, nothing released.
	const wanted =
		!whop || props.methodsKnown === false || currency === null
			? undefined
			: offered.length > 0
				? sheetKey(order, currency)
				: null;
	const probed = requests.probed?.key === wanted ? requests.probed : null;
	const openable = walletsOpenable({
		primed: probed !== null,
		opening,
		order,
		quote,
		currency,
	});
	// Only a render React commits hands the live sheet its handlers.
	useLayoutEffect(() => {
		requests.handlers.current = {
			build,
			answerShippingChange,
			// The billing-address and shipping-option events never refuse over the
			// delivery address. Elements runs PayPal's billing handlers before its
			// shipping ones for each address and skips the shipping ones after a
			// billing refusal, and on Apple Pay and Google Pay a billing refusal
			// refuses authorization until a clean billing answer. So they answer with
			// the sheet's own address's quote when it prices the sheet, and otherwise
			// keep the sheet's total.
			answerChange: (event, sheet) =>
				answerSheet(
					event,
					sheetPrice(order, sheetQuotes.current(), sheet.currency, {
						allowUntaxed: false,
					}) ?? {},
					sheet,
				),
			primed: (sheet) => followPage(sheet, quoteRef.current),
		};
	});

	function build(key: string): LiveSheet | null {
		if (!whop || currency === null) return null;
		const latest = quoteRef.current;
		const opened = latest?.money.currency === currency ? latest : null;
		const price = sheetPrice(order, opened, currency, { allowUntaxed: true });
		if (!price) return null;
		const due = amountDue(order, opened);
		const request = whop.payments.paymentRequest.create({
			accountId: order.seller.accountId,
			currency: due.currency,
			amount: price.amount,
			requestPayerEmail: true,
			requestShipping: true,
			setupFutureUsage: order.setupFutureUsage,
			lineItems: price.lineItems,
			shippingOptions: [
				{
					id: "standard",
					label: "Shipping",
					detail: "Included",
					amount: 0,
				},
			],
		});
		const sheet: LiveSheet = {
			key,
			setup: paymentSetupKey(order),
			request,
			currency: due.currency,
			types: offered,
			shownAmount: price.amount,
			release: () => {},
		};
		const answerChange = (event: SheetEvent) => {
			const answer = requests.handlers.current?.answerChange;
			if (answer) answer(event, sheet);
			else event.updateWith({});
		};
		const unsubscribe = [
			// Its promise goes back to Elements, which fails the update at once if
			// it rejects before answering.
			request.onShippingAddressChange((event) => {
				const answer = requests.handlers.current?.answerShippingChange;
				if (!answer) return event.updateWith({});
				return answer(event, sheet);
			}),
			request.onShippingOptionChange(answerChange),
			request.onBillingAddressChange(answerChange),
		];
		sheet.release = () => {
			for (const stop of unsubscribe) stop();
			disposeRequest(request);
		};
		return sheet;
	}

	useEffect(() => {
		if (wanted !== undefined) sheets.want(wanted);
	}, [sheets, wanted, quote]);

	// Every read of the kept quote goes through here, so one retired since is
	// let go the moment it would be used.
	function keptWalletQuote(): WalletQuote | null {
		walletQuoteRef.current = liveWalletQuote(
			walletQuoteRef.current,
			props.retired,
		);
		return walletQuoteRef.current;
	}

	// The total a wallet told the buyer for its address holds the sheet while
	// it is still payable, so the next tap opens on it.
	function toldQuote(sheet: LiveSheet): PageQuote | null {
		const kept = keptWalletQuote();
		if (!kept?.told) return null;
		return reusableWalletQuote(
			kept,
			kept.address,
			promoRef.current,
			sheet.currency,
			Date.now(),
			sameAddress,
		);
	}

	// Elements refuses `update()` while a sheet is open; its own events price it
	// then.
	function followPage(sheet: LiveSheet | null, next: PageQuote | null) {
		if (!sheet || sheets.isOpen()) return;
		const price = sheetPrice(order, toldQuote(sheet) ?? next, sheet.currency, {
			allowUntaxed: true,
		});
		if (!price) return;
		sheet.request.update(price);
		sheet.shownAmount = price.amount;
	}

	useEffect(() => {
		followPage(sheets.active(), quote);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [quote, order]);

	function answerSheet(
		event: SheetEvent,
		answer: SheetAnswer,
		sheet: LiveSheet,
	) {
		if (answer.amount !== undefined) sheet.shownAmount = answer.amount;
		event.updateWith(answer);
	}

	// The full address is priced again before the charge.
	function answerShippingChange(
		event: ShippingAddressChangeEvent,
		sheet: LiveSheet,
	) {
		return answerShippingAddress({
			quotes: sheetQuotes,
			place: addressOf(event.address),
			shipCountries: shipCountries(),
			sheetCurrency: sheet.currency,
			promoCode: promoRef.current,
			remembered: keptWalletQuote(),
			now: Date.now(),
			price: (place) => requestQuote(place, promoRef.current, sheet.currency),
			answer: (priced) =>
				answerSheet(event, sheetAnswer(order, priced, sheet.currency), sheet),
			updateWith: (update) => event.updateWith(update),
		});
	}

	// Apple refuses to open the sheet if anything asynchronous runs before
	// show(). The opening quote settles the link's promo code first.
	function onWalletPay(type: WalletType) {
		const stored = props.charge.current();
		if (stored) {
			resendStored(stored);
			return;
		}
		const mark = props.charge.markedNow(orderTagOf(order));
		if (mark) {
			void runCharge(async () => {
				throw markedOrderError(mark);
			});
			return;
		}
		const sheet = sheets.active();
		if (!sheet || !openable) return;
		// Until the sheet shares its own address, its events keep the total it
		// opened on, an estimate from the buyer's IP included.
		sheetQuotes.land(sheetQuotes.ask(), null);
		void runCharge(async (run) => {
			let shownTotal: number | null = null;
			const shown = await openSheet({
				opened: sheets.opened,
				show: () =>
					sheet.request.show(
						type,
						payerEmail ? { email: payerEmail } : undefined,
					),
				closed: () => {
					shownTotal = sheet.shownAmount;
					sheets.closed();
					followPage(sheets.active(), quoteRef.current);
				},
			});
			if ("failure" in shown) {
				// Closing the sheet isn't a failed payment.
				if (buyerCanceled(shown.failure)) return;
				throw new BuyerError(walletMessage(shown.failure, type));
			}
			const { result } = shown;
			const ship = result.shipping?.address;
			const shipped = ship
				? { ...ship, name: ship.recipient || result.payer?.name }
				: null;
			const address = addressOf(shipped);
			if (!address) {
				const tooLong = addressTooLong(shipped);
				throw new BuyerError(
					tooLong ? addressTooLongMessage(tooLong) : WALLET_ADDRESS_NEEDED,
				);
			}
			if (!shipsTo(address.country, shipCountries())) {
				throw new BuyerError(SHIP_COUNTRY_REFUSED);
			}
			const priceAddress = async () => {
				const priced = await requestQuote(
					address,
					promoRef.current,
					sheet.currency,
				);
				walletQuoteRef.current = walletQuoteToKeep(
					address,
					priced,
					sheet.currency,
				);
				return priced;
			};
			// A total told for the wallet's address is the wallet's own: the next
			// tap opens the sheet on it, and the page keeps its own. The sheet this
			// tap opened may be released by now (the page's currency changed while
			// it was open): only the live one follows.
			const keepTold = (told: PageQuote) => {
				const toKeep = walletQuoteToKeep(address, told, sheet.currency);
				if (!toKeep) return;
				walletQuoteRef.current = { ...toKeep, told: true };
				followPage(sheets.active(), quoteRef.current);
			};
			const requote = walletRequote({
				inView: () => quoteRef.current,
				promoCode: () => promoRef.current,
				refreshPage: props.refreshQuote,
				price: priceAddress,
				keep: keepTold,
			});
			// The quote this address got on the last tap, still payable, is the one
			// the sheet just showed: asking again would spend a quote and could move
			// a converted total by a minor unit, and tell the buyer it changed.
			const kept = reusableWalletQuote(
				keptWalletQuote(),
				address,
				promoRef.current,
				sheet.currency,
				Date.now(),
				sameAddress,
			);
			const priced =
				kept ??
				(await priceAddress().catch((failure: unknown) => {
					throw new BuyerError(
						quoteFailure(failure, {
							transient: QUOTE_UNAVAILABLE,
							unplaced: WALLET_ADDRESS_UNPRICED,
						}),
					);
				}));
			const refused = walletQuoteRefusal(
				priced,
				address,
				sheet.currency,
				(quote, at) => props.unchargeable(quote, at, sheet.currency),
			);
			if (refused) {
				if (refused === PROMO_NOT_APPLIED) props.dropUnappliedPromo(priced);
				throw new BuyerError(refused, taxFailed(priced));
			}
			// The sheet showed the total for the redacted address; a different total
			// for the full one is never charged unseen. It is told for the sheet's
			// address, and the page keeps the total for its own. The told quote is
			// kept, and the sheet opens on it at the next tap, where an address the
			// wallet redacts down to an empty field still answers with it, so the
			// told total is the one paid.
			const repriced = repricedMessage(
				priced,
				{ total: shownTotal ?? priced.total, currency: sheet.currency },
				deliveryPlace(address),
			);
			if (repriced) {
				keepTold(priced);
				throw new BuyerError(repriced, taxFailed(priced));
			}
			// Once charged, the quote is the payment's, whatever Whop answers.
			walletQuoteRef.current = null;
			await payQuote(priced, result.ctok, address, requote, run);
		});
	}

	return {
		walletShown: probed?.ready ?? NO_WALLET_READY,
		payPalButton: probed?.button ?? null,
		walletPrimed: openable,
		onWalletPay,
		forgetWalletQuote: () => {
			walletQuoteRef.current = null;
		},
	};
}
