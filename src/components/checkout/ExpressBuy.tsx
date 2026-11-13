import { useRouterState } from "@tanstack/react-router";
import type { WhopConstructor } from "@whop/elements";
import { WhopElements } from "@whop/elements-react";
import { useEffect, useMemo, useState } from "react";
import { SERVER_WAIT_MS, within } from "../../lib/checkout/deadline";
import { ENVIRONMENT, loadElements } from "../../lib/checkout/environment";
import { CHECKOUT_SETTINGS } from "../../lib/checkout/settings";
import {
	NO_WALLETS,
	type Order,
	type PageQuote,
	type PaymentMethodConfiguration,
	paymentSetupKey,
} from "../../lib/checkout/order";
import {
	CONTINUE_TO_BANK,
	type PageError,
	storeUpdated,
} from "../../lib/checkout/messages";
import { readVariantMethods } from "../../lib/checkout/order.functions";
import { createOpeningQuotes } from "../../lib/checkout/quote-flow";
import { visibleFor } from "../../lib/checkout/charge-attempt";
import type { ChargeControls } from "../../lib/checkout/use-charge-attempt";
import { documentVisibility } from "../../lib/checkout/use-page-visibility";
import { useChargeControls } from "../../lib/checkout/use-charge-controls";
import { useCheckoutFlow } from "../../lib/checkout/use-checkout-flow";
import {
	type SheetRequests,
	useSheetRequests,
} from "../../lib/checkout/use-wallet-sheet";
import {
	createMethodReads,
	offeredWallets,
	readMethodsWhileShown,
	walletAvailable,
	walletLoadsElements,
	walletRow,
	walletRowError,
} from "../../lib/checkout/wallet-sheet";
import { type PlanCheckout, planOrder } from "../../lib/storefront-account";
import { WALLET_BUTTON_STYLES } from "./styles";
import { AttemptNote } from "./AttemptNote";
import { OrderMarkNote } from "./OrderMarkNote";
import { ReloadButton } from "./ReloadButton";
import { WalletButtons, WalletSaveConsent } from "./WalletButtons";

const EXPRESS_BUY_STYLES = `
.ck-express-buy { margin-top: 12px; }
.ck-wallet-row { display: flex; gap: 8px; height: 48px; }
.ck-wallet-row > button { flex: 1 1 0; min-width: 0; margin-top: 0; }
.ck-express-buy-note { margin: 8px 0 0; font-size: 13px; color: #707070; }
.ck-express-buy-error { margin: 8px 0 0; font-size: 13px; color: #b3261e; }
`;

const openingQuotes = createOpeningQuotes();

type ExpressBuyProps = {
	planId: string;
	title: string;
	plan: PlanCheckout;
	onBusyChange: (busy: boolean) => void;
	// The variant's quote, which prices the page's price line (`quotedPrice`)
	// as it prices the wallet sheet.
	onQuote?: (quote: PageQuote | null) => void;
	onWalletStart?: () => void;
};

// A store that requires agreeing to its terms (settings.ts) gets no wallet
// buttons, and no Elements: the sheet has no terms box.
export function ExpressBuy(props: ExpressBuyProps) {
	if (CHECKOUT_SETTINGS.requireTermsAgreement) return null;
	return <WalletBuy {...props} />;
}

// Read in the browser for every variant, the opening one included, so the
// product page never waits on it; the wallet row is held open meanwhile.
function useVariantMethods(
	planId: string,
): { configuration: PaymentMethodConfiguration | null } | null {
	const [reads] = useState(() =>
		createMethodReads((id) =>
			within(readVariantMethods({ data: { planId: id } }), SERVER_WAIT_MS),
		),
	);
	const [, setSettled] = useState(0);
	useEffect(() => {
		if (!reads.needsRead(planId)) return;
		const shown = new AbortController();
		const current = () => !shown.signal.aborted;
		void readMethodsWhileShown(
			reads,
			planId,
			(ms) => visibleFor(ms, documentVisibility(), current, shown.signal),
			() => {
				if (current()) setSettled((count) => count + 1);
			},
		);
		return () => shown.abort();
	}, [planId, reads]);
	return reads.known(planId);
}

function WalletBuy(props: ExpressBuyProps) {
	const [elements, setElements] = useState<Promise<WhopConstructor> | null>(
		null,
	);
	const [elementsFailed, setElementsFailed] = useState(false);
	const charge = useChargeControls();
	const { planId, title, plan } = props;
	const methods = useVariantMethods(planId);
	const configuration = methods ? methods.configuration : NO_WALLETS;
	const order = useMemo(
		() => planOrder(planId, title, plan, configuration),
		[planId, title, plan, configuration],
	);
	const requests = useSheetRequests();
	const [buyerCurrency, setBuyerCurrency] = useState<string | null>(null);

	const loadsElements = walletLoadsElements({ methods, stored: charge.stored });
	useEffect(() => {
		if (loadsElements) setElements((loading) => loading ?? loadElements());
	}, [loadsElements]);

	// A blocked or lost Elements load shows no wallet row: the buttons are an
	// extra, and Add to cart still works. The flow stays, with no Elements, so
	// the variant's quote still prices the page's price line, and a stored
	// attempt's note stays: checking on the payment and starting over need no
	// wallet.
	if (!charge.ready) {
		return (
			<div className="ck-express-buy">
				<style>{EXPRESS_BUY_STYLES}</style>
				<div className="ck-wallet-row" aria-hidden="true" />
			</div>
		);
	}
	return (
		<WhopElements
			key={elementsFailed ? "failed" : "elements"}
			elements={elementsFailed ? null : elements}
			environment={ENVIRONMENT}
			onLoadError={() => setElementsFailed(true)}
		>
			<style>{WALLET_BUTTON_STYLES + EXPRESS_BUY_STYLES}</style>
			<ExpressWallets
				key={props.planId}
				order={order}
				methodsRead={methods !== null}
				elementsFailed={elementsFailed}
				charge={charge}
				requests={requests}
				buyerCurrency={buyerCurrency}
				onQuoteCurrency={setBuyerCurrency}
				onQuote={props.onQuote}
				onBusyChange={props.onBusyChange}
				onWalletStart={props.onWalletStart}
			/>
		</WhopElements>
	);
}

// Keyed by variant: the quote and the charge are the order's own, while the
// payment request above it carries over (`requests`).
function ExpressWallets({
	order,
	methodsRead,
	elementsFailed,
	charge,
	requests,
	buyerCurrency,
	onQuoteCurrency,
	onQuote,
	onBusyChange,
	onWalletStart,
}: {
	order: Order;
	methodsRead: boolean;
	elementsFailed: boolean;
	charge: ChargeControls;
	requests: SheetRequests;
	buyerCurrency: string | null;
	onQuoteCurrency: (currency: string) => void;
	onQuote?: (quote: PageQuote | null) => void;
	onBusyChange: (busy: boolean) => void;
	onWalletStart?: () => void;
}) {
	const search = useRouterState({ select: (state) => state.location.search });
	const [error, setError] = useState<PageError | null>(null);
	// With adaptive pricing the variant's opening quote prices the page's price
	// line, so it is made whether or not a wallet is offered, and the sheet is
	// built in the currency it names. A variant whose probe found no wallet
	// settles its row.
	const noWallet = !walletAvailable(requests.probed, order);
	const probedHere = requests.probed?.setup === paymentSetupKey(order);
	const {
		quote,
		submitting,
		resendStored,
		elsewhere,
		canStartOver,
		startOver,
		marked,
		buyAgain,
		walletShown,
		payPalButton,
		walletPrimed,
		onWalletPay,
		quoteError,
		promoError,
		promoDraft,
	} = useCheckoutFlow({
		order,
		charge,
		search,
		delivery: null,
		adaptivePricing: CHECKOUT_SETTINGS.adaptivePricing,
		openingQuote: CHECKOUT_SETTINGS.adaptivePricing,
		setError,
		onBusyChange,
		requests,
		carriedCurrency: buyerCurrency,
		methodsKnown: methodsRead,
		openingQuotes,
	});
	useEffect(() => {
		if (quote) onQuoteCurrency(quote.money.currency);
		onQuote?.(quote);
	}, [quote, onQuoteCurrency, onQuote]);

	const disabled = !charge.stored && !walletPrimed;
	// A request checked with no wallet available is settled too: no quote
	// comes, and there is no row.
	const row = walletRow({
		methodsRead,
		offered: offeredWallets(order.paymentMethodConfiguration).length,
		primed: walletPrimed || (probedHere && noWallet),
		shown: walletShown,
		failed: elementsFailed,
	});
	const attemptNote =
		charge.stored && !submitting ? (
			<AttemptNote
				className="ck-express-buy-note"
				elsewhere={elsewhere}
				pending={!error}
				canStartOver={canStartOver}
				onStartOver={startOver}
				onCheck={
					row !== "none"
						? undefined
						: () => {
								const stored = charge.current();
								if (stored) resendStored(stored);
							}
				}
			/>
		) : null;
	const shownError = walletRowError({
		error: error?.message ?? null,
		quoteError,
		promoError,
		promoDraft,
	});
	const errorNote = shownError ? (
		<p className="ck-express-buy-error" role="alert">
			{shownError}
			{storeUpdated(shownError) ? (
				<>
					{" "}
					<ReloadButton />
				</>
			) : null}
			{error?.continueTo ? (
				<>
					{" "}
					<a href={error.continueTo}>{CONTINUE_TO_BANK}</a>
				</>
			) : null}
		</p>
	) : null;
	if (marked) {
		return (
			<div className="ck-express-buy">
				{errorNote}
				<OrderMarkNote
					className="ck-express-buy-note"
					mark={marked}
					onBuyAgain={buyAgain}
				/>
			</div>
		);
	}
	if (row === "none" && !attemptNote && !errorNote) return null;
	return (
		<div className="ck-express-buy">
			{row === "none" ? null : (
				<div className="ck-wallet-row" aria-hidden={row === "pending"}>
					{row === "shown" ? (
						<WalletButtons
							applePay={walletShown.applePay}
							googlePay={walletShown.googlePay}
							payPal={walletShown.payPal}
							payPalButton={payPalButton}
							disabled={disabled}
							onPay={(type) => {
								onWalletStart?.();
								onWalletPay(type);
							}}
						/>
					) : null}
				</div>
			)}
			{row === "shown" ? (
				<WalletSaveConsent
					setupFutureUsage={order.setupFutureUsage}
					applePay={walletShown.applePay}
					googlePay={walletShown.googlePay}
					payPal={walletShown.payPal}
				/>
			) : null}
			{errorNote}
			{attemptNote}
		</div>
	);
}
