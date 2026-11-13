import { useWhop } from "@whop/elements-react";
import { useEffect, useRef, useState } from "react";
import {
	attemptPlace,
	type ChargeAttempt,
	newChargeKey,
	type RefusedError,
	shownMark,
	startOverOffered,
	visibleFor,
} from "./charge-attempt";
import { type OrderMark } from "./order-marks";
import {
	type ChargeFlow,
	type ChargeRun,
	payQuote as payQuoteWith,
	resendStored as resendStoredWith,
	runCharge as runChargeWith,
	startOver as startOverWith,
	storedRequote,
} from "./charge-flow";
import { CHARGE_WAIT_MS, SERVER_WAIT_MS, sleep, within } from "./deadline";
import { documentVisibility } from "./use-page-visibility";
import { returnUrl } from "./environment";
import { settingsFingerprint } from "./settings";
import { BuyerError, type PageError, PAYMENT_UNCONFIRMED } from "./messages";
import {
	type Address,
	type LinkInputs,
	type Order,
	orderTagOf,
	type PageQuote,
} from "./order";
import {
	chargeQuote,
	readPaymentState,
	readQuotePayment,
} from "./order.functions";

export type ChargeControls = {
	stored: boolean;
	current: () => ChargeAttempt | null;
	record: (attempt: ChargeAttempt) => boolean;
	forget: (key: string) => void;
	marked: (order: string) => OrderMark | null;
	markedNow: (order: string) => OrderMark | null;
	buyAgain: ChargeFlow["buyAgain"];
	payingAgain: ChargeFlow["payingAgain"];
	markCharging: ChargeFlow["markCharging"];
	clearCharging: ChargeFlow["clearCharging"];
	recheckMark: (mark: OrderMark) => void;
	markPayment: ChargeFlow["markPayment"];
	inFlight: { current: boolean };
	leaving: { current: boolean };
	generation: { current: number };
	restored: number;
};

type ChargeAttemptProps = {
	order: Order;
	charge: ChargeControls;
	linkInputsRef: { current: LinkInputs };
	setError: (error: PageError | null) => void;
	dropPromo: (failure: RefusedError) => void;
	priceAt: (address: Address) => Promise<PageQuote>;
	showQuote: (quote: PageQuote) => void;
	quoteTicket: () => () => boolean;
	retireQuote: (quoteId: string) => void;
	onBusyChange?: (busy: boolean) => void;
	termsAccepted?: () => boolean;
};

function currentPage(): string {
	return `${window.location.pathname}${window.location.search}`;
}

export function useChargeAttempt(props: ChargeAttemptProps) {
	const { order, charge } = props;
	const whop = useWhop();
	const whopRef = useRef(whop);
	whopRef.current = whop;

	const [submitting, setSubmitting] = useState(false);
	const [unsettledKey, setUnsettledKey] = useState<string | null>(null);

	function busy(running: boolean) {
		setSubmitting(running);
		props.onBusyChange?.(running);
	}

	useEffect(() => {
		if (charge.restored > 0) busy(false);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [charge.restored]);

	const flow: ChargeFlow = {
		chargeQuote: (key, inputs, resend) =>
			within(
				chargeQuote({
					data: {
						key,
						inputs,
						...(resend ? { resend } : {}),
						settings: settingsFingerprint(),
					},
				}),
				CHARGE_WAIT_MS,
			),
		readQuotePayment: (quoteId) =>
			within(readQuotePayment({ data: { quoteId } }), SERVER_WAIT_MS),
		handleNextAction: async (clientSecret) => {
			const elements = whopRef.current;
			if (!elements) throw new BuyerError(PAYMENT_UNCONFIRMED);
			return elements.payments.handleNextAction({ clientSecret });
		},
		elementsLoaded: () => whopRef.current !== null,
		readPaymentState: (paymentId) =>
			within(readPaymentState({ data: { paymentId } }), SERVER_WAIT_MS),
		attempts: charge,
		marked: charge.markedNow,
		payingAgain: charge.payingAgain,
		markCharging: charge.markCharging,
		clearCharging: charge.clearCharging,
		buyAgain: charge.buyAgain,
		markPayment: charge.markPayment,
		retireQuote: props.retireQuote,
		dropPromo: props.dropPromo,
		navigate: (url) => window.location.assign(url),
		sleep,
		newKey: () => newChargeKey(),
		page: currentPage,
		returnUrl,
		newReturnToken: () => newChargeKey(),
		inFlight: charge.inFlight,
		leaving: charge.leaving,
		generation: charge.generation,
		busy,
		error: props.setError,
		unsettled: setUnsettledKey,
		visibleFor: (ms, live) => visibleFor(ms, documentVisibility(), live),
	};

	const stored = charge.stored ? charge.current() : null;
	const elsewhere = stored ? attemptPlace(stored, order, currentPage()) : null;
	const tag = orderTagOf(order);
	const marked = shownMark(charge.marked(tag), stored, order);
	const markShown = marked ? JSON.stringify(marked) : null;

	useEffect(() => {
		if (marked) charge.recheckMark(marked);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [markShown]);

	return {
		submitting,
		runCharge: (task: (run: ChargeRun) => Promise<void>) =>
			runChargeWith(flow, task),
		payQuote: (
			priced: PageQuote,
			confirmationToken: string,
			address: Address,
			requote: () => Promise<PageQuote | null>,
			run: ChargeRun,
		) =>
			payQuoteWith(flow, {
				order,
				priced,
				confirmationToken,
				address,
				affiliateCode: props.linkInputsRef.current.affiliateCode,
				termsAccepted: props.termsAccepted?.(),
				requote,
				run,
			}),
		resendStored: (attempt: ChargeAttempt) =>
			resendStoredWith(flow, {
				attempt,
				order,
				requote: storedRequote(attempt, {
					price: props.priceAt,
					show: props.showQuote,
					ticket: () => {
						const quoted = props.quoteTicket();
						const generation = charge.generation.current;
						return () => quoted() && charge.generation.current === generation;
					},
				}),
			}),
		elsewhere,
		canStartOver: startOverOffered(stored, elsewhere, unsettledKey),
		startOver: () => startOverWith(flow, stored),
		marked,
		buyAgain: () => charge.buyAgain(tag),
	};
}
