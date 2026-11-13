import { useEffect, useRef, useState } from "react";
import { RefusedError } from "./charge-attempt";
import { type CurrencyPick, pickPending } from "./currency-pick";
import {
	refusalMessage,
	CURRENCY_REFUSED,
	PROMO_REFUSED,
	QUOTE_UNAVAILABLE,
} from "./messages";
import {
	type Address,
	addressKey,
	amountDue,
	type LinkInputs,
	type Order,
	orderKeyOf,
	type PageQuote,
	type PromoAwaiting,
} from "./order";
import { SERVER_WAIT_MS, within } from "./deadline";
import { storeCookies, tabStorage } from "./environment";
import { settingsFingerprint } from "./settings";
import { createLatest } from "./latest";
import { forgetLinkPromo, refuseLinkPromo } from "./link-codes";
import { usePageHidden } from "./use-page-visibility";
import { quoteOrder, readHandedQuote } from "./order.functions";
import {
	storedPick,
	dropHandedQuote,
	handedQuote,
	handOverQuote,
	keepPick,
	openedHandedQuote,
} from "./quote-handover";
import {
	answerItemsRefused,
	applyPromoCode,
	type OpeningQuotes,
	openingQuoteFailure,
	openingQuoteFor,
	pickCurrency as pickCurrencyWith,
	presentmentOf,
	priceDelivery,
	quoteFailure,
	type QuoteFlow,
	quoteToPay as quoteToPayWith,
	refreshQuote as refreshQuoteWith,
	refreshQuoteKeepingOrder as refreshQuoteKeepingOrderWith,
	removePromoCode,
	requestQuoteKeepingOrder as requestQuoteKeepingOrderWith,
	retryPricing,
	showQuote as showQuoteWith,
	unchargeableQuote,
	dropUnappliedPromo,
} from "./quote-flow";
import {
	ADDRESS_QUOTE_RETRIES,
	addressNeedsQuote,
	addressQuoteDelay,
	addressQuoteStalled,
	createQuoteRequests,
	pricingErrorClears,
	refusalAfterLanding,
} from "./quote-requests";

type CheckoutQuoteProps = {
	order: Order;
	// Complete only: a partly typed address is null.
	delivery: Address | null;
	linkInputsRef: { current: LinkInputs };
	adaptivePricing: boolean;
	openingQuote?: boolean;
	openingQuotes?: OpeningQuotes;
	// The checkout opens on a quote the cart or a product page handed over.
	takesHandedQuote?: boolean;
	onItemsRefused?: () => void;
};

export function useCheckoutQuote(props: CheckoutQuoteProps) {
	const { order, delivery, linkInputsRef, adaptivePricing } = props;
	const quoteRef = useRef<PageQuote | null>(null);
	const [idleCount, setIdleCount] = useState(0);
	const [requests] = useState(() =>
		createQuoteRequests(() => setIdleCount((count) => count + 1)),
	);
	// Not asked again until the address changes: Whop would refuse it the same
	// way.
	const refusedKeyRef = useRef<string | null>(null);
	const promoRef = useRef<string | null>(
		props.openingQuote === false
			? (linkInputsRef.current.promoCode ?? null)
			: null,
	);
	const [promoAsked, setPromoAsked] = useState(promoRef.current);
	const [promoAwaiting, setPromoAwaiting] = useState<PromoAwaiting | null>(
		null,
	);
	const deliveryRef = useRef<Address | null>(null);
	const spentQuotesRef = useRef(new Set<string>());
	const [picks] = useState(createLatest);
	// The buyer's currency pick: the page renders the state, and the flow's
	// async code reads and writes the ref, each write mirrored into the state.
	const [pick, setPick] = useState<CurrencyPick>(() => ({
		picked: adaptivePricing ? storedPick(storeCookies) : null,
		picks,
	}));
	const pickRef = useRef(pick);
	const [pickState] = useState(() => ({
		get current() {
			return pickRef.current;
		},
		set current(next: CurrencyPick) {
			pickRef.current = next;
			setPick(next);
		},
	}));

	const [quote, setQuote] = useState<PageQuote | null>(null);
	const [quoteError, setQuoteError] = useState<string | null>(null);
	const [opening, setOpening] = useState<{ quote: PageQuote | null } | null>(
		() => (props.openingQuote === false ? { quote: null } : null),
	);
	const [quoteAttempt, setQuoteAttempt] = useState(0);
	const [promoDraft, setPromoDraft] = useState("");
	const [promoPending, setPromoPending] = useState(false);
	const [promoError, setPromoError] = useState<string | null>(null);
	// A quote in the plans' own currency recommends only that one, so the last
	// longer list stays offered after the buyer picks it.
	const [currencyOptions, setCurrencyOptions] = useState<string[]>([]);
	const [currencyError, setCurrencyError] = useState<string | null>(null);
	const hidden = usePageHidden();

	deliveryRef.current = delivery;
	const deliveryKey = addressKey(delivery);
	const deliveryQuoted =
		deliveryKey !== null && quote?.addressKey === deliveryKey;

	// The buyer's own Remove drops the link's code for the tab, whatever the
	// quote answers; Whop refusing it, or leaving it out, drops it only for this
	// order.
	function forgetLinkCode(code: string) {
		if (code === linkInputsRef.current.promoCode) {
			forgetLinkPromo(code, tabStorage);
		}
	}

	function refuseLinkCode(code: string) {
		if (code === linkInputsRef.current.promoCode) {
			refuseLinkPromo(code, orderKeyOf(order), tabStorage);
		}
	}

	function dropPromo(failure: RefusedError) {
		const code = promoRef.current;
		if (!code) return;
		refuseLinkCode(code);
		promoRef.current = null;
		setPromoAsked(null);
		setPromoDraft(code);
		setPromoError(refusalMessage(failure, PROMO_REFUSED));
	}

	const listed = amountDue(order, null);
	const flow: QuoteFlow = {
		adaptivePricing,
		planCurrency: order.money.currency,
		quote: (request) =>
			answerItemsRefused(
				within(
					quoteOrder({
						data: {
							items: order.lines.map((line) => ({
								planId: line.planId,
								quantity: line.quantity,
							})),
							promoCode: request.promoCode ?? undefined,
							shippingAddress: request.address ?? undefined,
							presentment: request.presentment,
							settings: settingsFingerprint(),
						},
					}),
					SERVER_WAIT_MS,
				),
				props.onItemsRefused,
			),
		requests,
		inView: quoteRef,
		listed: { total: listed.amount, currency: listed.currency },
		pick: pickState,
		promo: promoRef,
		delivery: () => deliveryRef.current,
		land: (next) => {
			refusedKeyRef.current = refusalAfterLanding(
				refusedKeyRef.current,
				next.addressKey,
			);
			setQuote(next);
			if (
				pricingErrorClears({
					refusedKey: refusedKeyRef.current,
					landedKey: next.addressKey,
					deliveryKey: addressKey(deliveryRef.current),
				})
			) {
				setQuoteError(null);
			}
			if (next.recommendedCurrencies.length > 1) {
				setCurrencyOptions(next.recommendedCurrencies);
			}
		},
		dropPromo,
	};

	// Read again on the server before it opens the checkout: the tab's storage
	// is only where the cart or product page left its id. A read the server
	// answers with no quote lets the kept one go; one that fails keeps it.
	async function handedOpening(orderKey: string): Promise<PageQuote | null> {
		const promoCode = promoRef.current;
		const presentment = presentmentOf(flow);
		const handed = handedQuote(tabStorage, orderKey, {
			promoCode,
			presentment: presentment ?? null,
		});
		if (!handed) return null;
		const answer = await within(
			readHandedQuote({
				data: {
					quoteId: handed.id,
					items: order.lines.map((line) => ({
						planId: line.planId,
						quantity: line.quantity,
					})),
					promoCode: promoCode ?? undefined,
					presentment,
					settings: settingsFingerprint(),
				},
			}),
			SERVER_WAIT_MS,
		);
		if (!answer) {
			dropHandedQuote(tabStorage, orderKey);
			return null;
		}
		return openedHandedQuote(
			answer.quote,
			{ promoCode, presentment },
			Date.now(),
		);
	}

	const refreshQuote = (address?: Address | null) =>
		refreshQuoteWith(flow, address);
	const refreshQuoteKeepingOrder = (address?: Address | null) =>
		refreshQuoteKeepingOrderWith(flow, address);
	const requestQuoteKeepingOrder = (
		address: Address | null,
		promoCode: string | null,
		currency?: string,
	) => requestQuoteKeepingOrderWith(flow, address, promoCode, currency);

	useEffect(() => () => requests.supersede(), [requests]);

	function quoteTicket(): () => boolean {
		const ticket = requests.current();
		return () => requests.isNewest(ticket);
	}

	useEffect(() => {
		if (props.openingQuote === false) return;
		let destroyed = false;
		const link = linkInputsRef.current;

		// A link's promo code can be expired or mistyped, which must still open the
		// checkout, at full price with the reason on the promo box.
		async function openingQuote(): Promise<PageQuote | null> {
			promoRef.current = link.promoCode ?? null;
			setPromoAsked(promoRef.current);
			const address = deliveryRef.current;
			const orderKey = orderKeyOf(order);
			try {
				const first = await openingQuoteFor(
					flow,
					address,
					props.openingQuotes && {
						quotes: props.openingQuotes,
						orderKey,
						now: Date.now(),
					},
					adaptivePricing && props.takesHandedQuote
						? () => handedOpening(orderKey)
						: undefined,
				);
				if (first && adaptivePricing) {
					handOverQuote(tabStorage, orderKey, first);
				}
				return first;
			} catch (failure) {
				if (destroyed) return null;
				const shown = openingQuoteFailure(flow, failure);
				setPromoAsked(promoRef.current);
				setPromoAwaiting(shown.awaiting);
				if (shown.draft) setPromoDraft(shown.draft);
				if (shown.promoError) setPromoError(shown.promoError);
				if (shown.quoteError) {
					setQuoteError(shown.quoteError);
					if (address) refusedKeyRef.current = addressKey(address);
				}
				return null;
			}
		}

		void openingQuote().then((first) => {
			if (!destroyed) setOpening({ quote: first });
		});

		return () => {
			destroyed = true;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		setQuoteAttempt(0);
	}, [deliveryKey]);

	useEffect(() => {
		if (!hidden) setQuoteAttempt(0);
	}, [hidden]);

	// No keystroke may come to retry a failed quote, so it backs off and retries
	// on its own, and asks again once nothing else runs.
	useEffect(() => {
		const delay = addressQuoteDelay(quoteAttempt, hidden);
		if (
			delay === null ||
			!addressNeedsQuote({
				opened: opening !== null,
				deliveryKey,
				quotedKey: quote?.addressKey,
				refusedKey: refusedKeyRef.current,
				running: requests.running(),
			})
		) {
			return;
		}
		const timer = setTimeout(() => {
			void priceDelivery(flow).then((outcome) => {
				if (!outcome) return;
				if (outcome.refused) {
					setQuoteError(outcome.message);
					refusedKeyRef.current = addressKey(deliveryRef.current);
					return;
				}
				setQuoteError(
					quoteAttempt < ADDRESS_QUOTE_RETRIES
						? outcome.message
						: QUOTE_UNAVAILABLE,
				);
				setQuoteAttempt((attempt) => attempt + 1);
			});
		}, delay);
		return () => clearTimeout(timer);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opening, deliveryKey, deliveryQuoted, quoteAttempt, idleCount, hidden]);

	async function applyPromo(code: string | null) {
		if (code !== null && code.trim() === "") return;
		setPromoPending(true);
		setPromoError(null);
		const outcome = await (code === null
			? removePromoCode(flow, forgetLinkCode)
			: applyPromoCode(flow, code));
		setPromoAsked(promoRef.current);
		setPromoPending(false);
		setPromoAwaiting(
			code !== null && "awaitingAddress" in outcome
				? { code, until: "address" }
				: null,
		);
		if (outcome.applied || "awaitingAddress" in outcome) {
			if (code === null) setPromoDraft("");
			return;
		}
		if (outcome.promoError) setPromoError(outcome.promoError);
		if (outcome.quoteError) setQuoteError(outcome.quoteError);
	}

	async function pickCurrency(code: string) {
		setCurrencyError(null);
		const settled = await pickCurrencyWith(flow, code);
		if (!settled) {
			const picked = pickRef.current.picked;
			if (picked) keepPick(storeCookies, picked);
			return;
		}
		setCurrencyError(
			quoteFailure(settled.failure, {
				transient: QUOTE_UNAVAILABLE,
				unplaced: QUOTE_UNAVAILABLE,
				refused: CURRENCY_REFUSED,
			}),
		);
	}

	// Until a quote for the current pick is in view, the page would charge a
	// price the buyer didn't pick.
	const currencyPending = pickPending(adaptivePricing, pick.picked, quote);

	function retryQuote() {
		setQuoteError(null);
		setQuoteAttempt(0);
		void retryPricing(flow).then((failed) => {
			if (!failed) return;
			setQuoteError(failed.message);
			if (failed.refusedKey) refusedKeyRef.current = failed.refusedKey;
		});
	}

	const unchargeableAt = (
		candidate: PageQuote,
		at: Address,
		currency?: string,
	) =>
		unchargeableQuote(candidate, at, {
			promo: promoRef.current,
			presentment: presentmentOf(flow, currency),
			spent: spentQuotesRef.current,
			now: Date.now(),
		});

	const quoteToPay = (address: Address) => {
		setQuoteAttempt(0);
		return quoteToPayWith(flow, address, (candidate, at) =>
			unchargeableAt(candidate, at),
		);
	};

	// A wallet's quote never lands on the page, so the charge that found it
	// without the code it asked for takes the code off, as a landed quote does.
	const dropWalletPromo = (candidate: PageQuote) =>
		dropUnappliedPromo(flow, candidate);

	function retireQuote(quoteId: string) {
		spentQuotesRef.current.add(quoteId);
	}

	const quoteRetired = (quoteId: string) => spentQuotesRef.current.has(quoteId);

	function showQuote(shown: PageQuote) {
		showQuoteWith(flow, shown);
	}

	return {
		quote,
		quoteError,
		quoteStalled: addressQuoteStalled(quoteAttempt),
		opening,
		deliveryQuoted,
		quoteRef,
		promoRef,
		deliveryRef,
		promoAsked,
		promoAwaiting,
		promoDraft,
		setPromoDraft,
		promoPending,
		promoError,
		setPromoError,
		requestQuoteKeepingOrder,
		refreshQuote,
		refreshQuoteKeepingOrder,
		dropPromo,
		applyPromo,
		currencyOptions,
		currencyPending,
		currencyError,
		pickCurrency,
		retryQuote,
		quoteToPay,
		unchargeableAt,
		dropWalletPromo,
		retireQuote,
		quoteRetired,
		showQuote,
		quoteTicket,
	};
}
