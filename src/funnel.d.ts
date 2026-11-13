import "@tanstack/react-router";

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		/**
		 * Where a funnel page sends the buyer next, as page paths: one for a plain step, two for an
		 * offer the buyer can accept or decline. The website editor draws these steps as arrows.
		 */
		funnel?: { next: string[] };
		/**
		 * The button that leads to each funnel step, as the step's path and the button's label. The
		 * website editor saves it when someone picks the button for an arrow.
		 */
		funnelButtons?: Record<string, string>;
		/**
		 * The page's own id, "pg_" and 12 letters or digits. It stays the same when the page's path
		 * changes; a copied page gets a new one.
		 */
		pageId?: string;
	}
}
