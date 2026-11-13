import { useEffect, useMemo, useRef } from "react";
import { tabStorage } from "./environment";
import { keepLinkCodes, landingLinkInputs } from "./link-codes";
import type { PageError } from "./messages";
import { type Address, type LinkInputs, type Order, orderKeyOf } from "./order";
import type { OpeningQuotes } from "./quote-flow";
import { type ChargeControls, useChargeAttempt } from "./use-charge-attempt";
import { useCheckoutQuote } from "./use-checkout-quote";
import { type SheetRequests, useWalletSheet } from "./use-wallet-sheet";
import { sheetCurrencyFor } from "./wallet-sheet";

type CheckoutFlowProps = {
	order: Order;
	charge: ChargeControls;
	// The page's search params, exactly as the link carried them.
	search: Record<string, unknown>;
	// Complete only: a partly typed address is null.
	delivery: Address | null;
	adaptivePricing: boolean;
	openingQuote?: boolean;
	setError: (error: PageError | null) => void;
	onBusyChange?: (busy: boolean) => void;
	payerEmail?: string;
	requests: SheetRequests;
	carriedCurrency?: string | null;
	methodsKnown?: boolean;
	openingQuotes?: OpeningQuotes;
	takesHandedQuote?: boolean;
	termsAccepted?: () => boolean;
	onItemsRefused?: () => void;
};

export function useCheckoutFlow(props: CheckoutFlowProps) {
	const { order, charge, search, adaptivePricing, onItemsRefused } = props;
	const linkInputsRef = useRef<LinkInputs>({});
	const orderKey = orderKeyOf(order);
	linkInputsRef.current = useMemo(
		() => landingLinkInputs(search, tabStorage, orderKey),
		[search, orderKey],
	);
	useEffect(() => keepLinkCodes(search, tabStorage), [search]);
	const quoted = useCheckoutQuote({
		order,
		delivery: props.delivery,
		linkInputsRef,
		adaptivePricing,
		openingQuote: props.openingQuote,
		openingQuotes: props.openingQuotes,
		takesHandedQuote: props.takesHandedQuote,
		onItemsRefused:
			onItemsRefused &&
			(() => props.requests.sheets.whenClosed(onItemsRefused)),
	});
	const attempt = useChargeAttempt({
		order,
		charge,
		linkInputsRef,
		setError: props.setError,
		dropPromo: quoted.dropPromo,
		priceAt: (address) =>
			quoted.requestQuoteKeepingOrder(address, quoted.promoRef.current),
		showQuote: quoted.showQuote,
		quoteTicket: quoted.quoteTicket,
		retireQuote: quoted.retireQuote,
		onBusyChange: props.onBusyChange,
		termsAccepted: props.termsAccepted,
	});
	const wallet = useWalletSheet({
		order,
		charge,
		opening: quoted.opening,
		quote: quoted.quote,
		currency: sheetCurrencyFor({
			adaptivePricing,
			opening: quoted.opening,
			quote: quoted.quote,
			order,
			carried: props.carriedCurrency,
			probedKey: props.requests.probed?.key,
		}),
		methodsKnown: props.methodsKnown,
		quoteRef: quoted.quoteRef,
		promoRef: quoted.promoRef,
		requestQuote: quoted.requestQuoteKeepingOrder,
		unchargeable: quoted.unchargeableAt,
		dropUnappliedPromo: quoted.dropWalletPromo,
		retired: quoted.quoteRetired,
		refreshQuote: () => quoted.refreshQuote(),
		runCharge: attempt.runCharge,
		payQuote: attempt.payQuote,
		resendStored: attempt.resendStored,
		payerEmail: props.payerEmail,
		requests: props.requests,
	});
	// The page's "Try again" follows a tax failure, so the wallet's kept quote
	// is asked for again too.
	const retryQuote = () => {
		wallet.forgetWalletQuote();
		quoted.retryQuote();
	};
	return { ...quoted, ...attempt, ...wallet, retryQuote };
}
