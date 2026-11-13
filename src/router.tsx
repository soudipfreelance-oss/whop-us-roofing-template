import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { parseSearchAsText, stringifySearchAsText } from "./lib/search-text";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const router = createTanStackRouter({
		routeTree,
		scrollRestoration: true,
		// A hover's preload stays fresh for the router's default 30 seconds, so
		// the click after it doesn't read Whop again. The scaffold's 0 is for an
		// external cache, which this store has none of.
		defaultPreload: "intent",
		// Only a pause on a link preloads it, not a pointer sweeping across a
		// grid of product cards, each of which would read its product from Whop.
		defaultPreloadDelay: 250,
		// Links carry codes the buyer was given (`?promoCode=12.50`), so every
		// search param stays the text it was.
		parseSearch: parseSearchAsText,
		stringifySearch: stringifySearchAsText,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
