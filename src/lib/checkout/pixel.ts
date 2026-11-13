import { amountDue, type Order, type Quote, shownMoney } from "./order";

// Tracking tools the seller installs read product views, cart adds and checkout
// starts from the Whop pixel hosting injects. The preview may have none.
export function trackPixel(event: string, data: Record<string, unknown>) {
	const pixel: unknown = Reflect.get(globalThis, "whop");
	if (
		typeof pixel !== "object" ||
		pixel === null ||
		!("track" in pixel) ||
		typeof pixel.track !== "function"
	) {
		return;
	}
	pixel.track(event, data);
}

// An event names one variant, so a cart of several sends only its total.
export function trackCheckoutStart(order: Order, quote: Quote | null) {
	const due = amountDue(order, quote);
	const [line, ...others] = order.lines;
	trackPixel("initiate_checkout", {
		...(line && others.length === 0
			? { variant_id: line.planId, product_id: line.productId }
			: {}),
		value: due.amount / 10 ** shownMoney(order, quote).decimals,
		currency: due.currency.toUpperCase(),
	});
}
