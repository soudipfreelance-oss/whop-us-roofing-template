import { createFileRoute, useRouter } from "@tanstack/react-router";
import { preloadHints, type WhopConstructor } from "@whop/elements";
import {
	type Appearance,
	BrandingElement,
	EmailElement,
	PaymentElement,
	Payments,
	type PaymentsHandle,
	WhopElements,
} from "@whop/elements-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	type CurrencyControls,
	OrderSummary,
	type PromoControls,
} from "../components/checkout/OrderSummary";
import { AttemptNote } from "../components/checkout/AttemptNote";
import { ReloadButton } from "../components/checkout/ReloadButton";
import { BusyRegion } from "../components/checkout/BusyRegion";
import { OrderMarkNote } from "../components/checkout/OrderMarkNote";
import { BillingAddress } from "../components/checkout/BillingAddress";
import { SeededAddress } from "../components/checkout/SeededAddress";
import { checkoutStyles } from "../components/checkout/styles";
import { TermsAgreement } from "../components/checkout/TermsAgreement";
import {
	WalletButtons,
	WalletSaveConsent,
} from "../components/checkout/WalletButtons";
import {
	ENVIRONMENT,
	loadElements,
	returnUrl,
} from "../lib/checkout/environment";
import {
	besideTaxRow,
	BILLING_ADDRESS_NEEDED,
	DELIVERY_ADDRESS_NEEDED,
	type PageError,
	pageError,
	buyerMessage,
	CHECKOUT_FAILED,
	ITEM_UNAVAILABLE,
	CONTINUE_TO_BANK,
	addressTooLongMessage,
	goneLinesButton,
	goneLinesMessage,
	storeUpdated,
	PAYMENTS_UNAVAILABLE,
	buyerCanceled,
	tokenUnlessCanceled,
} from "../lib/checkout/messages";
import {
	type AddressValue,
	addressName,
	addressOf,
	addressTooLong,
	billingPayload,
	billingPhone,
	billingReady,
	afterGoneLines,
	checkoutLink,
	type EmailValue,
	type GoneLine,
	goneTitles,
	linkInputsOf,
	linkQuantity,
	amountDue,
	money,
	type Order,
	promoShown,
	orderTagOf,
	paymentSetupKey,
	shownMoney,
	struckSavings,
	taxFailed,
	withCartImages,
} from "../lib/checkout/order";
import { loadOrder } from "../lib/checkout/order.functions";
import { trackCheckoutStart } from "../lib/checkout/pixel";
import { payWaitsOnQuote } from "../lib/checkout/quote-requests";
import {
	CHECKOUT_SETTINGS,
	settingsFingerprint,
	shipCountries,
} from "../lib/checkout/settings";
import type { ChargeControls } from "../lib/checkout/use-charge-attempt";
import { useCartStore } from "../lib/cart";
import { useChargeControls } from "../lib/checkout/use-charge-controls";
import { useCheckoutFlow } from "../lib/checkout/use-checkout-flow";
import { useSheetRequests } from "../lib/checkout/use-wallet-sheet";

// Fill in per store. Everything else in this file is the standard design. The
// shipping countries, terms checkbox and local currency are set in
// src/lib/checkout/settings.ts, never here: the server and product pages read
// them there too.
const STORE = {
	brandColor: "#000000",
	// Stays white unless the seller asks for another checkout color.
	pageBackground: "#ffffff",
	wordmark: { src: "/imported/wordmark.png", alt: "Store" },
	// A code a link carries still shows the box when this is false.
	promoCodeEntry: true,
	// Shopify's canonical policy paths, matching the shared footer — keep the
	// two lists pointing at the same pages when tuning them for a store.
	policyLinks: [
		{ label: "Refund policy", href: "/policies/refund-policy", inTerms: true },
		{
			label: "Privacy policy",
			href: "/policies/privacy-policy",
			inTerms: true,
		},
		{
			label: "Terms of service",
			href: "/policies/terms-of-service",
			inTerms: true,
		},
		{
			label: "Contact information",
			href: "/policies/contact-information",
			inTerms: false,
		},
	],
};

const STYLES = checkoutStyles(STORE);
const SHIP_COUNTRIES = shipCountries();

export const Route = createFileRoute("/checkout/$planId")({
	component: CheckoutPage,
	errorComponent: CheckoutLoadFailed,
	// The search stays exactly what the link carried: a key added, dropped or
	// changed here would make the router rewrite the shared link.
	validateSearch: (search: Record<string, unknown>) => search,
	loaderDeps: ({ search }) => ({
		quantity: search.quantity,
		items: search.items,
	}),
	loader: async ({ params, deps }) => {
		const link = checkoutLink(params.planId, deps);
		if (!link) return { refused: ITEM_UNAVAILABLE };
		return loadOrder({
			data: {
				...link,
				withTerms: CHECKOUT_SETTINGS.requireTermsAgreement,
				settings: settingsFingerprint(),
			},
		});
	},
	// Its order reads every line's variant and the seller's documents from
	// Whop: too much to spend on a hover over the cart's Checkout link. The
	// click loads it.
	preload: false,
	head: () => ({
		meta: [{ title: "Checkout" }],
		links: [...preloadHints({ environment: ENVIRONMENT })],
	}),
});

// The page is light, so the branding wordmark and every other element must
// render dark-on-light too: left unset, it can default to dark mode and paint
// text too light to see.
const FIELD = {
	height: "50px",
	border: "1px solid #dedede",
	borderRadius: "8px",
	color: "#111111",
	fontSize: "14px",
	boxShadow: "none",
};
const FIELD_FOCUS = {
	borderColor: "#dedede",
	boxShadow: "none",
	outline: `2px solid ${STORE.brandColor}`,
	outlineOffset: "-1px",
};
const MUTED = { color: "#707070" };

const ELEMENTS_APPEARANCE: Appearance = {
	theme: { appearance: "light" },
	classes: {
		"whop-Payment": { fontSize: "14px", color: "#111111" },
		"whop-EmailInput": FIELD,
		"whop-EmailInput:focus": FIELD_FOCUS,
		"whop-EmailInput::placeholder": MUTED,
		"whop-EmailLabel": MUTED,
		"whop-AddressFieldInput": FIELD,
		"whop-AddressFieldInput:focus": FIELD_FOCUS,
		"whop-AddressFieldInput::placeholder": MUTED,
		"whop-AddressFieldSelect": FIELD,
		"whop-AddressFieldSelect:focus": FIELD_FOCUS,
		"whop-AddressFieldSelect[data-empty]": MUTED,
		"whop-AddressFieldLabel": MUTED,
		"whop-PaymentMethodsSeparated": { gap: "12px" },
		"whop-PaymentMethodSeparated": {
			border: "1px solid #dedede",
			borderRadius: "8px",
			background: "#ffffff",
			boxShadow: "none",
		},
		"whop-PaymentMethodSelected": {
			borderColor: STORE.brandColor,
			background: "#ffffff",
		},
		"whop-PaymentMethodLabel": {
			fontSize: "14px",
			fontWeight: "500",
			color: "#111111",
		},
		"whop-PaymentMethodRadio": { borderColor: "#dedede" },
		"whop-PaymentMethodRadioSelected": {
			border: `6px solid ${STORE.brandColor}`,
			background: "#ffffff",
		},
		"whop-CardFieldGroup": { boxShadow: "none" },
		"whop-CardFieldInput": { borderColor: "#dedede", background: "#ffffff" },
		"whop-CardFieldInputFocused": FIELD_FOCUS,
		"whop-CardLabel": MUTED,
	},
};

// The page already collects the billing address, so the payment element
// doesn't ask for it a second time. That hides the element's phone input too,
// so the page asks for the phone itself when the selected method needs one
// (`requiresBillingPhone`) and passes it to the token.
const PAYMENT_FIELDS = { billingDetails: "never" } as const;

// The page draws Apple Pay, Google Pay and PayPal itself (`useWalletSheet`), so
// the payment element leaves them out of its list.
const OWN_WALLET_BUTTONS = {
	applePay: "never",
	googlePay: "never",
	payPal: "never",
} as const;

// Kept by the page rather than one cart's checkout, so a change of cart seeds
// the next checkout's fields instead of a blank email and address.
type BuyerEntry = {
	email: EmailValue;
	setEmail: (value: EmailValue) => void;
	shipping: AddressValue | null;
	setShipping: (value: AddressValue) => void;
	billing: AddressValue | null;
	setBilling: (value: AddressValue) => void;
	billingSameAsShipping: boolean;
	setBillingSameAsShipping: (value: boolean) => void;
};

function CheckoutSkeleton() {
	return (
		<div
			className="ck-skel-form"
			aria-busy="true"
			aria-label="Loading checkout"
		>
			<span className="ck-skel ck-skel-field" />
			<span className="ck-skel ck-skel-field ck-skel-gap" />
			<span className="ck-skel ck-skel-field" />
			<span className="ck-skel ck-skel-field" />
			<span className="ck-skel ck-skel-panel ck-skel-gap" />
			<span className="ck-skel ck-skel-button" />
		</div>
	);
}

function SummarySkeleton() {
	return (
		<div className="ck-summary" aria-hidden="true">
			<div className="ck-skel-item">
				<span className="ck-skel ck-skel-thumb" />
				<span className="ck-skel ck-skel-line" />
			</div>
			<span className="ck-skel ck-skel-field" />
			<span className="ck-skel ck-skel-line ck-skel-total" />
		</div>
	);
}

function CheckoutHeader() {
	return (
		<header className="ck-header">
			<a href="/" aria-label="Back to store">
				<img
					className="ck-wordmark"
					src={STORE.wordmark.src}
					alt={STORE.wordmark.alt}
				/>
			</a>
		</header>
	);
}

function CheckoutNotice(props: { title: string; children: ReactNode }) {
	return (
		<div className="ck">
			<style>{STYLES}</style>
			<CheckoutHeader />
			<div className="ck-bands">
				<div className="ck-band-left">
					<div className="ck-column">
						<h1 className="ck-heading">{props.title}</h1>
						<p className="ck-secure">{props.children}</p>
					</div>
				</div>
				<div className="ck-band-right" />
			</div>
		</div>
	);
}

function CheckoutLoadFailed() {
	const router = useRouter();
	return (
		<CheckoutNotice title="We couldn't load this checkout">
			Check your connection, then{" "}
			<button
				className="ck-link-button"
				type="button"
				onClick={() => void router.invalidate()}
			>
				try again
			</button>
			.
		</CheckoutNotice>
	);
}

// A line Whop no longer sells here is named, and the buyer goes on with the
// rest of the order once it is taken out; one the store has fewer of is named
// with how many are left, and goes on holding no more than those
// (`afterGoneLines` says whose lines change: the cart's, or only the link's).
function CartLinesGone(props: {
	gone: GoneLine[];
	planId: string;
	search: Record<string, unknown>;
}) {
	const router = useRouter();
	const cart = useCartStore((state) => state.lines);
	const removeLine = useCartStore((state) => state.removeLine);
	const setQuantity = useCartStore((state) => state.setQuantity);
	const link = checkoutLink(props.planId, props.search) ?? {
		planId: props.planId,
		quantity: 1,
		items: [],
	};
	const shown = afterGoneLines(link, cart, props.gone);
	const lowered = props.gone.filter((line) => line.left !== undefined);
	const removeGone = () => {
		const after = afterGoneLines(
			link,
			useCartStore.getState().lines,
			props.gone,
		);
		if (after.cart) {
			for (const line of props.gone) {
				const kept = after.cart.find((entry) => entry.planId === line.planId);
				if (kept) setQuantity(line.planId, kept.quantity);
				else removeLine(line.planId);
			}
		}
		if (!after.next) {
			void router.navigate({ to: "/" });
			return;
		}
		void router.navigate({
			to: "/checkout/$planId",
			params: { planId: after.next.planId },
			search: {
				...props.search,
				quantity: after.next.quantity,
				items: after.next.items,
			},
		});
	};
	return (
		<CheckoutNotice
			title={
				lowered.length === props.gone.length
					? "Some items are running low"
					: "Some items are no longer available"
			}
		>
			{goneLinesMessage(goneTitles(props.gone, cart))}{" "}
			<button className="ck-link-button" type="button" onClick={removeGone}>
				{goneLinesButton(props.gone, shown)}
			</button>
		</CheckoutNotice>
	);
}

function CheckoutPage() {
	const { planId } = Route.useParams();
	const search = Route.useSearch();
	const quantity = linkQuantity(search.quantity);
	const items = typeof search.items === "string" ? search.items : "";
	const linkCode = linkInputsOf(search).promoCode ?? "";
	const loaded = Route.useLoaderData();
	const order = loaded && !("refused" in loaded) ? loaded : null;

	const [elements, setElements] = useState<Promise<WhopConstructor> | null>(
		null,
	);
	const [email, setEmail] = useState<EmailValue>({
		email: "",
		complete: false,
	});
	const [shipping, setShipping] = useState<AddressValue | null>(null);
	const [billing, setBilling] = useState<AddressValue | null>(null);
	const [billingSameAsShipping, setBillingSameAsShipping] = useState(true);
	const charge = useChargeControls();
	// A load the browser blocked or lost (an ad blocker, a strict CSP, a bad
	// connection). The provider would otherwise throw it to the router's error
	// boundary and take the order summary down with the payment panel.
	const [elementsFailure, setElementsFailure] = useState<{
		retry: () => void;
	} | null>(null);

	useEffect(() => {
		if (!order) return;
		setElements(loadElements());
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [Boolean(order)]);

	if (loaded && "refused" in loaded && loaded.gone) {
		return <CartLinesGone gone={loaded.gone} planId={planId} search={search} />;
	}

	if (loaded && "refused" in loaded && loaded.updated) {
		return (
			<CheckoutNotice title="This store was just updated">
				{loaded.refused} <ReloadButton />
			</CheckoutNotice>
		);
	}

	if (loaded && "refused" in loaded) {
		return (
			<CheckoutNotice title="This order can't be checked out">
				{loaded.refused}{" "}
				<a href="/" style={{ color: "var(--brand)" }}>
					Go back to the store
				</a>
				.
			</CheckoutNotice>
		);
	}

	if (!order) {
		return (
			<CheckoutNotice title="We can't find this checkout">
				This product is no longer available.{" "}
				<a href="/" style={{ color: "var(--brand)" }}>
					Go back to the store
				</a>{" "}
				and try again.
			</CheckoutNotice>
		);
	}

	return (
		<WhopElements
			elements={elements}
			environment={ENVIRONMENT}
			onLoadError={(_failure, retry) => setElementsFailure({ retry })}
		>
			<Checkout
				// Keyed on what is being bought, the link's code and how it is paid,
				// not on the `order` object: the loader hands back a new object every
				// time it runs, and a remount wipes the payment details. The payment
				// element can't change its payment setup once created.
				key={`${planId}|${quantity}|${items}|${linkCode}|${paymentSetupKey(order)}`}
				order={order}
				search={search}
				charge={charge}
				elementsFailed={elementsFailure !== null}
				onRetryElements={() => {
					const failure = elementsFailure;
					setElementsFailure(null);
					failure?.retry();
				}}
				buyer={{
					email,
					setEmail,
					shipping,
					setShipping,
					billing,
					setBilling,
					billingSameAsShipping,
					setBillingSameAsShipping,
				}}
			/>
		</WhopElements>
	);
}

function Checkout(props: {
	order: Order;
	search: Record<string, unknown>;
	charge: ChargeControls;
	elementsFailed: boolean;
	onRetryElements: () => void;
	buyer: BuyerEntry;
}) {
	const { order, buyer } = props;
	const paymentsRef = useRef<{ handle: PaymentsHandle | null }>(null);

	const [ready, setReady] = useState(false);
	const [revealed, setRevealed] = useState(false);
	const [panelError, setPanelError] = useState<string | null>(null);
	// Closing a wallet sheet inside the payment element isn't an error.
	const showPanelError = (failure: { code?: string; message: string }) => {
		if (buyerCanceled(failure)) return;
		setPanelError(buyerMessage(failure.message, CHECKOUT_FAILED));
	};
	const [error, setError] = useState<PageError | null>(null);
	const [paymentComplete, setPaymentComplete] = useState(false);
	const [phoneRequired, setPhoneRequired] = useState(false);
	const [phoneDraft, setPhoneDraft] = useState("");
	const phone = billingPhone(phoneDraft);
	const [summaryOpen, setSummaryOpen] = useState(false);
	const [termsAccepted, setTermsAccepted] = useState(false);

	// The elements read their seed once, at creation; a change of payment setup
	// remounts the checkout (its key).
	const [emailSeed] = useState(() => buyer.email.email || undefined);
	const [methodConfiguration] = useState(
		() => order.paymentMethodConfiguration,
	);

	const emailValue = buyer.email;
	const shippingValue = buyer.shipping;
	const billingValue = buyer.billing;
	const billingSameAsShipping = buyer.billingSameAsShipping;

	const delivery = shippingValue?.complete
		? addressOf(shippingValue.address)
		: null;
	// A field over Whop's limit leaves no address to price, so the form says
	// which to shorten.
	const deliveryTooLong = shippingValue?.complete
		? addressTooLong(shippingValue.address)
		: null;
	const billingTooLong =
		!billingSameAsShipping && billingValue?.complete
			? addressTooLong(billingValue.address)
			: null;
	const requests = useSheetRequests();
	const router = useRouter();
	const {
		quote,
		quoteError,
		opening,
		deliveryQuoted,
		quoteStalled,
		promoAsked,
		promoAwaiting,
		promoDraft,
		setPromoDraft,
		promoPending,
		promoError,
		setPromoError,
		refreshQuoteKeepingOrder,
		applyPromo,
		currencyOptions,
		currencyPending,
		currencyError,
		pickCurrency,
		retryQuote,
		quoteToPay,
		submitting,
		runCharge,
		payQuote,
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
	} = useCheckoutFlow({
		order,
		charge: props.charge,
		search: props.search,
		delivery,
		adaptivePricing: CHECKOUT_SETTINGS.adaptivePricing,
		takesHandedQuote: true,
		setError,
		payerEmail: emailValue.complete ? emailValue.email.trim() : undefined,
		termsAccepted: () =>
			CHECKOUT_SETTINGS.requireTermsAgreement && termsAccepted,
		requests,
		// A line sold out or ran short since the order loaded: loading it
		// again names the line, with its Remove or Update.
		onItemsRefused: () => void router.invalidate(),
	});

	// The opening quote is the first amount the page shows; a failed one leaves
	// the order's own price.
	const checkoutStartTracked = useRef(false);
	useEffect(() => {
		if (!opening || checkoutStartTracked.current) return;
		checkoutStartTracked.current = true;
		trackCheckoutStart(order, opening.quote);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [opening]);

	const termsRequired = CHECKOUT_SETTINGS.requireTermsAgreement;
	// Placeholder policies stand in only for a seller who published none: a
	// read that failed holds the terms box, and payment, until it loads, and one
	// Whop refused holds them for good.
	const termsUnmet =
		termsRequired &&
		(!termsAccepted ||
			Boolean(order.policiesUnread) ||
			Boolean(order.policiesRefused));
	const emailComplete = emailValue.complete;
	const billingComplete = billingSameAsShipping || billingReady(billingValue);
	const shownFormat = shownMoney(order, quote);
	const taxUnavailable = taxFailed(quote);
	const cartLines = useCartStore((state) => state.lines);
	const summaryOrder = useMemo(
		() => withCartImages(order, cartLines),
		[order, cartLines],
	);
	const errorShown = besideTaxRow(error, taxUnavailable);
	// The payment element hides methods whose limits the amount falls outside, so
	// it follows the quote.
	const due = amountDue(order, quote);
	// The order-complete page's address for the confirmation token, as Whop
	// refuses a token whose URL is neither HTTPS nor a loopback host, which the
	// page's own address may not be. Whop sends the buyer back to the charge's
	// own return URL, which carries the attempt's return token too
	// (charge-flow.ts `payQuote`): a charge's URL takes the place of its
	// token's.
	const returnTo = returnUrl(orderTagOf(order));

	function onCompletePurchase() {
		const stored = props.charge.current();
		if (stored) {
			resendStored(stored);
			return;
		}
		const payments = paymentsRef.current?.handle;
		if (!payments) return;
		if (!delivery) {
			setError(pageError(DELIVERY_ADDRESS_NEEDED));
			return;
		}
		const addressValue = billingSameAsShipping ? shippingValue : billingValue;
		const billingAddress = addressValue
			? billingPayload(addressValue)
			: undefined;
		if (!addressValue || !billingAddress) {
			setError(
				pageError(
					billingTooLong
						? addressTooLongMessage(billingTooLong)
						: BILLING_ADDRESS_NEEDED,
				),
			);
			return;
		}
		// The price is settled before a token is made, so a moved total never
		// spends one. Nothing here needs the click's activation: the element lists
		// no wallets (`OWN_WALLET_BUTTONS`), and the page's own run from their
		// buttons. A long step inside the token (a bank's sign-in) can outlast the
		// quote, so it is checked again after; a quote still good is used as is.
		void runCharge(async (run) => {
			await quoteToPay(delivery);
			const token = await tokenUnlessCanceled(
				payments.createConfirmationToken({
					billingDetails: {
						email: emailValue.email.trim(),
						name: addressName(addressValue.address),
						address: billingAddress,
						...(phoneRequired && phone ? { phone } : {}),
					},
				}),
			);
			if (!token) return;
			const priced = await quoteToPay(delivery);
			await payQuote(
				priced,
				token.confirmationToken,
				delivery,
				() => refreshQuoteKeepingOrder(delivery),
				run,
			);
		});
	}

	const expressVisible =
		!marked &&
		(walletShown.applePay || walletShown.googlePay || walletShown.payPal);
	// The sheet can't tick the store's terms box. The wallets pay through their
	// own payment request, not the payment element, so one that errors or is
	// still loading holds only the card path.
	const walletDisabled =
		!props.charge.stored &&
		(!walletPrimed || promoPending || currencyPending || termsUnmet);
	const leftoverAttempt = props.charge.stored && !submitting;

	const promoBox = promoShown({
		asked: promoAsked,
		quote,
		entry: STORE.promoCodeEntry,
		error: promoError,
		awaiting: promoAwaiting,
	});
	const appliedPromo = promoBox.applied;
	const promo: PromoControls = {
		...promoBox,
		draft: promoDraft,
		pending: promoPending,
		error: promoError,
		onDraftChange: (value) => {
			setPromoDraft(value);
			setPromoError(null);
		},
		onApply: () => void applyPromo(promoDraft.trim()),
		onRemove: () => void applyPromo(null),
	};

	const currencies: CurrencyControls | null = CHECKOUT_SETTINGS.adaptivePricing
		? {
				options: currencyOptions,
				pending: currencyPending,
				error: currencyError,
				onPick: (code) => void pickCurrency(code),
			}
		: null;

	const struck = struckSavings(order, quote);

	const shown = revealed || props.elementsFailed;
	const totalShown = opening !== null;

	return (
		<div className={`ck${summaryOpen ? " ck-open" : ""}`}>
			<style>{STYLES}</style>
			<CheckoutHeader />

			<button
				className="ck-bar"
				type="button"
				onClick={() => setSummaryOpen(!summaryOpen)}
			>
				<span className="ck-bar-label">
					Order summary
					<svg
						className="ck-bar-chevron"
						aria-hidden="true"
						viewBox="0 0 12 12"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M3 4.5 6 7.5 9 4.5" />
					</svg>
				</span>
				{totalShown ? (
					<span className="ck-bar-totals ck-fade-in">
						{struck > 0 ? (
							<p className="ck-bar-original">
								{money(due.amount + struck, shownFormat)}
							</p>
						) : null}
						<p className="ck-bar-total">{money(due.amount, shownFormat)}</p>
					</span>
				) : (
					<span className="ck-skel ck-skel-line ck-skel-bar" />
				)}
			</button>

			<BusyRegion busy={submitting} className="ck-bands">
				<div className="ck-band-left">
					<div className="ck-column">
						<Payments
							ref={paymentsRef}
							accountId={order.seller.accountId}
							currency={due.currency}
							amount={due.amount}
							paymentMethodConfiguration={methodConfiguration}
							setupFutureUsage={order.setupFutureUsage}
							returnUrl={returnTo}
							appearance={ELEMENTS_APPEARANCE}
							onLoadingChange={(loading) => setRevealed(!loading)}
							fallback={
								props.elementsFailed ? (
									<p className="ck-panel-error">
										Payment details couldn't load. Check your connection, then{" "}
										<button
											className="ck-link-button"
											type="button"
											onClick={props.onRetryElements}
										>
											try again
										</button>
										.
									</p>
								) : (
									<CheckoutSkeleton />
								)
							}
						>
							<div className={`ck-reveal${revealed ? " ck-revealed" : ""}`}>
								<div
									className={`ck-section ck-express${
										expressVisible ? " ck-express-on" : ""
									}`}
								>
									<div className="ck-checkout-wallets">
										<WalletButtons
											applePay={walletShown.applePay && !marked}
											googlePay={walletShown.googlePay && !marked}
											payPal={walletShown.payPal && !marked}
											payPalButton={payPalButton}
											disabled={walletDisabled}
											onPay={onWalletPay}
										/>
									</div>
									<WalletSaveConsent
										setupFutureUsage={order.setupFutureUsage}
										applePay={walletShown.applePay && !marked}
										googlePay={walletShown.googlePay && !marked}
										payPal={walletShown.payPal && !marked}
									/>
									<p className="ck-or">or pay another way</p>
								</div>

								<div className="ck-section">
									<h2 className="ck-heading">Contact</h2>
									<EmailElement
										className="ck-email-slot"
										labelMode="floating"
										defaultValue={emailSeed}
										onChange={buyer.setEmail}
										onError={showPanelError}
									/>
								</div>

								<div className="ck-section">
									<h2 className="ck-heading">Delivery</h2>
									<SeededAddress
										mode="shipping"
										seed={shippingValue}
										allowedCountries={SHIP_COUNTRIES}
										onChange={buyer.setShipping}
										onError={(message) => showPanelError({ message })}
									/>
									{deliveryTooLong ? (
										<p className="ck-error" role="alert">
											{addressTooLongMessage(deliveryTooLong)}
										</p>
									) : null}
								</div>

								<div className="ck-section">
									<h2 className="ck-heading">Payment</h2>
									<p className="ck-secure">
										All transactions are secure and encrypted.
									</p>
								</div>

								<div className="ck-section">
									<div className="ck-panel">
										{panelError ? (
											<p className="ck-panel-error">{panelError}</p>
										) : null}
										<div hidden={Boolean(panelError)}>
											{/* The full payment element, not just card fields: it lists
										every method the seller has turned on for this currency and
										amount, such as local methods, buy now pay later, bank
										transfers and saved cards. The page draws its own Apple Pay,
										Google Pay and PayPal buttons above, so the element leaves
										those out rather than offer each wallet twice. */}
											<PaymentElement
												className="ck-payment-slot"
												fields={PAYMENT_FIELDS}
												wallets={OWN_WALLET_BUTTONS}
												onReady={() => setReady(true)}
												onChange={(payload) => {
													setPaymentComplete(payload.complete);
													setPhoneRequired(
														Boolean(payload.requiresBillingPhone),
													);
												}}
												onError={showPanelError}
											/>
											<div hidden={!ready}>
												{phoneRequired ? (
													<label className="ck-phone">
														Phone number
														<input
															className="ck-input"
															type="tel"
															inputMode="tel"
															autoComplete="tel"
															placeholder="+1 415 555 2671"
															value={phoneDraft}
															onChange={(event) =>
																setPhoneDraft(event.target.value)
															}
														/>
														<span className="ck-phone-hint">
															This payment method needs your phone number,
															country code first.
														</span>
													</label>
												) : null}
												<label className="ck-billing-toggle">
													<input
														type="checkbox"
														checked={billingSameAsShipping}
														onChange={(event) =>
															buyer.setBillingSameAsShipping(
																event.target.checked,
															)
														}
													/>
													Use shipping address as billing address
												</label>
												{billingSameAsShipping ? null : (
													// Under the same <Payments> as everything else, so it
													// shares the branding requirement and the
													// confirmation flow.
													<BillingAddress
														seed={billingValue}
														onChange={buyer.setBilling}
														onError={(message) => showPanelError({ message })}
													/>
												)}
												{billingTooLong ? (
													<p className="ck-error" role="alert">
														{addressTooLongMessage(billingTooLong)}
													</p>
												) : null}
											</div>
										</div>
									</div>
									{termsRequired && order.policiesRefused ? (
										<p className="ck-error" role="alert">
											{PAYMENTS_UNAVAILABLE}
										</p>
									) : termsRequired && order.policiesUnread ? (
										<p className="ck-error" role="alert">
											We couldn't load the store's policies.{" "}
											<button
												className="ck-link-button"
												type="button"
												onClick={() => void router.invalidate()}
											>
												Try again
											</button>
										</p>
									) : termsRequired ? (
										<TermsAgreement
											seller={order.seller.name || "the seller"}
											documents={
												order.sellerDocuments?.length
													? order.sellerDocuments
													: STORE.policyLinks.filter((link) => link.inTerms)
											}
											checked={termsAccepted}
											onChange={setTermsAccepted}
										/>
									) : null}
									{taxUnavailable ? (
										<p className="ck-error">
											We couldn't calculate tax for your order.
											<button
												className="ck-link-button"
												type="button"
												onClick={retryQuote}
											>
												Try again
											</button>
										</p>
									) : null}
									{quoteError ? (
										<p className="ck-error">
											{quoteError}
											{storeUpdated(quoteError) ? (
												<>
													{" "}
													<ReloadButton />
												</>
											) : null}
											{quoteStalled ? (
												<>
													{" "}
													<button
														className="ck-link-button"
														type="button"
														onClick={retryQuote}
													>
														Try again
													</button>
												</>
											) : null}
											{appliedPromo ? (
												<>
													{" "}
													<button
														className="ck-link-button"
														type="button"
														disabled={promoPending}
														onClick={() => void applyPromo(null)}
													>
														Remove the code {appliedPromo}
													</button>
												</>
											) : null}
										</p>
									) : null}
									{errorShown ? (
										<p className="ck-error" role="alert">
											{errorShown}
											{storeUpdated(errorShown) ? (
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
									) : null}
									{leftoverAttempt && !marked ? (
										<AttemptNote
											elsewhere={elsewhere}
											pending={!error}
											canStartOver={canStartOver}
											onStartOver={startOver}
										/>
									) : null}
									{marked ? (
										<OrderMarkNote mark={marked} onBuyAgain={buyAgain} />
									) : null}
									<button
										hidden={Boolean(marked)}
										className="ck-submit"
										type="button"
										disabled={
											!props.charge.stored &&
											(!ready ||
												props.elementsFailed ||
												Boolean(panelError) ||
												!emailComplete ||
												payWaitsOnQuote({
													deliveryQuoted,
													stalled: quoteStalled,
												}) ||
												taxUnavailable ||
												!billingComplete ||
												!paymentComplete ||
												(phoneRequired && !phone) ||
												termsUnmet ||
												promoPending ||
												currencyPending)
										}
										onClick={onCompletePurchase}
									>
										{submitting
											? "Working…"
											: props.charge.stored
												? "Confirm my payment"
												: "Pay now"}
									</button>
									{/* The branding notice is REQUIRED: every other payments
								element holds its reveal until it is mounted, and
								confirmation refuses without it on the page. */}
									<div data-busy-exempt>
										<BrandingElement className="ck-branding" />
									</div>
								</div>
							</div>
						</Payments>

						<div className="ck-policies">
							{STORE.policyLinks.map((link) => (
								<a key={link.href} href={link.href}>
									{link.label}
								</a>
							))}
						</div>
					</div>
				</div>

				<div className="ck-band-right">
					{shown ? (
						<OrderSummary
							order={summaryOrder}
							quote={quote}
							promo={promo}
							currencies={currencies}
						/>
					) : (
						<SummarySkeleton />
					)}
				</div>
			</BusyRegion>
		</div>
	);
}
