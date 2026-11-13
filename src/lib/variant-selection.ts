import { useState } from "react";
import {
	matchPlan,
	type PlanChoice,
	type VariantOption,
} from "./storefront-account";

// Browser-safe: the product page's component imports this. Loading the view
// happens in whop.server.ts.

export type ProductView = {
	id: string;
	title: string;
	headline: string | null;
	description: string | null;
	image: string | null;
	gallery: string[];
	options: VariantOption[];
	plans: PlanChoice[];
	defaultPlanId: string | null;
};

function defaultSelection(product: ProductView): Record<string, string> {
	return (
		product.plans.find((plan) => plan.id === product.defaultPlanId)
			?.attributes ?? {}
	);
}

/**
 * Which option values the shopper picked, and the plan they add up to.
 *
 * `plan` is what Add to cart and checkout charge. It is undefined when the
 * picked values match no plan. `isBuyable` says whether a value in row `index`
 * still leads to something in stock given the rows above it, so one sold-out
 * size never greys out a whole color.
 */
export function useVariantSelection(product: ProductView) {
	const { options, plans } = product;
	// The router keeps the page mounted when only the slug changes, so opening
	// another product starts it over from that product's default.
	const [state, setState] = useState(() => ({
		productId: product.id,
		selected: defaultSelection(product),
	}));
	if (state.productId !== product.id) {
		setState({ productId: product.id, selected: defaultSelection(product) });
	}
	const selected =
		state.productId === product.id ? state.selected : defaultSelection(product);

	const plan =
		options.length > 0
			? matchPlan(plans, options, selected)
			: plans.find((entry) => entry.id === product.defaultPlanId);

	const select = (name: string, value: string) =>
		setState({
			productId: product.id,
			selected: { ...selected, [name]: value },
		});

	const isBuyable = (index: number, value: string) =>
		plans.some(
			(entry) =>
				entry.available &&
				entry.attributes?.[options[index].name] === value &&
				options
					.slice(0, index)
					.every(
						(option) =>
							entry.attributes?.[option.name] === selected[option.name],
					),
		);

	return { options, selected, select, plan, isBuyable };
}
