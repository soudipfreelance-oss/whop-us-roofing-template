import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { CartLine } from "../../lib/cart";
import { useCartStore } from "../../lib/cart";
import {
	type CartQuoteRequest,
	cartLinePrice,
	cartQuoteFor,
	createCartQuotes,
} from "../../lib/checkout/cart-quotes";
import { SERVER_WAIT_MS, within } from "../../lib/checkout/deadline";
import { storeCookies, tabStorage } from "../../lib/checkout/environment";
import {
	cartKeyOf,
	checkoutSearchFor,
	money,
	type PageQuote,
} from "../../lib/checkout/order";
import { quoteOrder } from "../../lib/checkout/order.functions";
import type { HandedQuote } from "../../lib/checkout/quote-handover";
import {
	CHECKOUT_SETTINGS,
	settingsFingerprint,
} from "../../lib/checkout/settings";

type CartDrawerProps = {
	open: boolean;
	onClose: () => void;
};

// The box may sit empty while the buyer types a new number. Only a whole
// number of one or more is saved; the Remove button is what takes a line out.
function QuantityInput({ line }: { line: CartLine }) {
	const setQuantity = useCartStore((state) => state.setQuantity);
	const [draft, setDraft] = useState(String(line.quantity));

	useEffect(() => {
		setDraft(String(line.quantity));
	}, [line.quantity]);

	return (
		<input
			type="number"
			min={1}
			step={1}
			aria-label={`Quantity of ${line.title}`}
			value={draft}
			onChange={(event) => {
				setDraft(event.target.value);
				const quantity = Math.floor(Number(event.target.value));
				if (event.target.value !== "" && quantity >= 1) {
					setQuantity(line.planId, quantity);
				}
			}}
			onBlur={() => setDraft(String(line.quantity))}
		/>
	);
}

async function quoteCart(request: CartQuoteRequest): Promise<PageQuote | null> {
	const answer = await within(
		quoteOrder({
			data: {
				items: request.items,
				promoCode: request.promoCode ?? undefined,
				presentment: request.presentment,
				settings: settingsFingerprint(),
			},
		}),
		SERVER_WAIT_MS,
	);
	if (!("quote" in answer)) return null;
	return {
		...answer.quote,
		addressKey: null,
		presentment: request.presentment,
		promoAsked: request.promoCode,
		deadline: Date.now() + answer.quote.lifetimeMs,
	};
}

// With adaptive pricing an open cart shows its quote's prices; without, or
// until one comes, it shows none, as before.
function useCartQuote(lines: CartLine[], open: boolean): HandedQuote | null {
	const [quote, setQuote] = useState<HandedQuote | null>(null);
	const [ask] = useState(() =>
		createCartQuotes({
			storage: tabStorage,
			picks: storeCookies,
			quote: quoteCart,
			shown: setQuote,
		}),
	);
	const key = cartKeyOf(lines);
	useEffect(() => {
		if (CHECKOUT_SETTINGS.adaptivePricing && open) void ask(lines);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ask, open, key]);
	return CHECKOUT_SETTINGS.adaptivePricing && open
		? cartQuoteFor(quote, lines)
		: null;
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
	const lines = useCartStore((state) => state.lines);
	const removeLine = useCartStore((state) => state.removeLine);
	const quote = useCartQuote(lines, open);

	if (!open) return null;

	const checkout = checkoutSearchFor(lines);

	return (
		<div
			role="dialog"
			style={{
				position: "fixed",
				inset: 0,
				background: "rgba(0,0,0,0.35)",
				display: "flex",
				justifyContent: "flex-end",
				zIndex: 50,
			}}
			onClick={onClose}
		>
			<aside
				style={{
					width: "min(420px, 100%)",
					background: "#fff",
					padding: "1.5rem",
				}}
				onClick={(event) => event.stopPropagation()}
			>
				<h2>Cart</h2>
				{lines.length === 0 ? (
					<p>Your cart is empty.</p>
				) : (
					<ul style={{ listStyle: "none", padding: 0 }}>
						{lines.map((line) => {
							const price = cartLinePrice(quote, line.planId);
							return (
								<li key={line.planId} style={{ marginBottom: "1rem" }}>
									<div>{line.title}</div>
									{price ? <div>{money(price.units, price.money)}</div> : null}
									<QuantityInput line={line} />
									<button type="button" onClick={() => removeLine(line.planId)}>
										Remove
									</button>
								</li>
							);
						})}
					</ul>
				)}
				{quote && lines.length > 0 ? (
					<p>Subtotal {money(quote.subtotal, quote.money)}</p>
				) : null}
				{checkout ? (
					<Link
						to="/checkout/$planId"
						params={{ planId: checkout.planId }}
						search={{
							quantity: checkout.quantity,
							items: checkout.items,
						}}
						onClick={onClose}
					>
						Checkout
					</Link>
				) : null}
			</aside>
		</div>
	);
}
