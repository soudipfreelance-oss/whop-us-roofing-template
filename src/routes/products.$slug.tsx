import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { preloadHints } from "@whop/elements";
import { useEffect, useState } from "react";
import { BusyRegion } from "../components/checkout/BusyRegion";
import { ExpressBuy } from "../components/checkout/ExpressBuy";
import { ENVIRONMENT } from "../lib/checkout/environment";
import { logFailure } from "../lib/checkout/order.handlers";
import {
	type Amount,
	money,
	type PageQuote,
	quotedPrice,
} from "../lib/checkout/order";
import { trackPixel } from "../lib/checkout/pixel";
import { CHECKOUT_SETTINGS } from "../lib/checkout/settings";
import { useCartStore } from "../lib/cart";
import type { PlanChoice } from "../lib/storefront-account";
import {
	type ProductView,
	useVariantSelection,
} from "../lib/variant-selection";
import { loadProductView } from "../whop.server";

const loadProduct = createServerFn({ method: "GET" })
	.validator((slug: string): unknown => slug)
	.handler(async ({ data }): Promise<ProductView> => {
		let product: ProductView | null;
		try {
			product = await loadProductView(data);
		} catch (failure) {
			logFailure("Loading a product", failure);
			throw failure;
		}
		if (!product) throw notFound();
		return product;
	});

export const Route = createFileRoute("/products/$slug")({
	loader: ({ params }) => loadProduct({ data: params.slug }),
	head: () => ({
		links: CHECKOUT_SETTINGS.requireTermsAgreement
			? []
			: [...preloadHints({ environment: ENVIRONMENT })],
	}),
	component: ProductPage,
	errorComponent: ProductLoadFailed,
});

// A product the store couldn't read right now (Whop slow or refusing, another
// request's catalog listing failing) is offered again, never shown as gone.
function ProductLoadFailed() {
	const router = useRouter();
	return (
		<section style={{ padding: "2rem" }}>
			<p role="alert">
				This product didn't load.{" "}
				<button type="button" onClick={() => void router.invalidate()}>
					Try again
				</button>
			</p>
		</section>
	);
}

// With adaptive pricing the variant's quote prices the line, in the buyer's
// currency, as the wallet sheet shows it. Until it comes, or when none does,
// the price the server read in that currency (`shownPrice`) shows.
function PriceLine({
	price,
	quoted,
}: {
	price: Amount | null;
	quoted: ReturnType<typeof quotedPrice>;
}) {
	if (quoted) {
		return (
			<p>
				{quoted.struck ? (
					<>
						<s>{money(quoted.struck.units, quoted.struck.money)}</s>{" "}
					</>
				) : null}
				{money(quoted.price.units, quoted.price.money)}
			</p>
		);
	}
	return price ? <p>{money(price.units, price.money)}</p> : null;
}

// The price the page shows for a variant, as a decimal in its currency: the
// variant's quote once it has come, as PriceLine shows it.
function variantPrice(plan: PlanChoice, quote: PageQuote | null) {
	const price =
		quotedPrice(quote, plan.id)?.price ?? plan.shownPrice ?? plan.price;
	return price
		? {
				value: price.units / 10 ** price.money.decimals,
				currency: price.money.currency.toUpperCase(),
			}
		: null;
}

function trackProduct(
	event: "view_content" | "add_to_cart" | "initiate_checkout",
	productId: string,
	plan: PlanChoice,
	quote: PageQuote | null,
) {
	trackPixel(event, {
		variant_id: plan.id,
		product_id: productId,
		...variantPrice(plan, quote),
	});
}

function ProductPage() {
	const product = Route.useLoaderData();
	const addLine = useCartStore((state) => state.addLine);
	const openCart = useCartStore((state) => state.openCart);
	const { options, selected, select, plan, isBuyable } =
		useVariantSelection(product);
	const [buying, setBuying] = useState(false);
	const [quote, setQuote] = useState<PageQuote | null>(null);
	useEffect(() => {
		if (plan) trackProduct("view_content", product.id, plan, null);
	}, [product.id, plan?.id]);
	const lineTitle =
		options.length > 0 && plan?.title
			? `${product.title} – ${plan.title}`
			: product.title;

	const price = plan ? variantPrice(plan, quote) : null;

	return (
		<section
			data-whop-product-id={product.id}
			data-whop-variant-id={plan?.id}
			data-whop-price={price?.value}
			data-whop-currency={price?.currency}
			style={{ padding: "2rem", display: "grid", gap: "1.5rem" }}
		>
			<h1>{product.title}</h1>
			{product.image ? (
				<img
					src={product.image}
					alt={product.title}
					style={{ maxWidth: "480px", width: "100%" }}
				/>
			) : null}
			{product.headline ? <p>{product.headline}</p> : null}
			<BusyRegion busy={buying} style={{ display: "grid", gap: "1.5rem" }}>
				{options.map((option, index) => (
					<fieldset
						key={option.name}
						style={{
							border: "none",
							padding: 0,
							display: "grid",
							gap: "0.5rem",
						}}
					>
						<legend>{option.label}</legend>
						<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
							{option.values.map((value) => {
								const isSelected = selected[option.name] === value;
								const buyable = isBuyable(index, value);
								return (
									<button
										key={value}
										type="button"
										aria-pressed={isSelected}
										onClick={() => select(option.name, value)}
										style={{
											fontWeight: isSelected ? 700 : 400,
											textDecoration: buyable ? "none" : "line-through",
											opacity: buyable ? 1 : 0.5,
										}}
									>
										{value}
									</button>
								);
							})}
						</div>
					</fieldset>
				))}
				{plan ? (
					<div style={{ display: "grid", gap: "0.75rem", maxWidth: "480px" }}>
						<PriceLine
							price={plan.shownPrice}
							quoted={quotedPrice(quote, plan.id)}
						/>
						{plan.available ? (
							<>
								<button
									type="button"
									onClick={() => {
										trackProduct("add_to_cart", product.id, plan, quote);
										addLine({
											planId: plan.id,
											title: lineTitle,
											quantity: 1,
											image: product.image ?? undefined,
										});
										openCart();
									}}
								>
									Add to cart
								</button>
								{plan.checkout ? (
									<ExpressBuy
										planId={plan.id}
										title={lineTitle}
										plan={plan.checkout}
										onBusyChange={setBuying}
										onQuote={setQuote}
										onWalletStart={() =>
											trackProduct("initiate_checkout", product.id, plan, quote)
										}
									/>
								) : null}
							</>
						) : (
							<button type="button" disabled>
								Sold out
							</button>
						)}
					</div>
				) : options.length > 0 ? (
					<p>This combination is not available.</p>
				) : null}
			</BusyRegion>
		</section>
	);
}
