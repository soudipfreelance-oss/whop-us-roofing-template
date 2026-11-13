// The storefront's search params are text, end to end. TanStack's own parser
// turns `12` and `true` into a number and a boolean before any `parseSearch`
// sees them, and its default JSON-parses `1E5`, `12.50` and `null`, then writes
// them back changed, the canonical URL a server redirect lands on included
// (router-core `qss.js` `decode`, `searchParams.js`). A route that wants a
// number, as the checkout's `quantity`, reads it in its own `validateSearch`.
export function parseSearchAsText(
	searchStr: string,
): Record<string, string | string[]> {
	const query = new URLSearchParams(
		searchStr.startsWith("?") ? searchStr.slice(1) : searchStr,
	);
	// No prototype, so a param named `toString` or `__proto__` is only a param.
	const search: Record<string, string | string[]> = Object.create(null);
	for (const [key, value] of query) {
		const seen = Object.hasOwn(search, key) ? search[key] : undefined;
		const next =
			seen === undefined
				? value
				: [...(Array.isArray(seen) ? seen : [seen]), value];
		Object.defineProperty(search, key, {
			value: next,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	return search;
}

export function stringifySearchAsText(search: Record<string, unknown>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(search)) {
		for (const entry of Array.isArray(value) ? value : [value]) {
			const text = textOf(entry);
			if (text !== undefined) query.append(key, text);
		}
	}
	const text = query.toString();
	return text ? `?${text}` : "";
}

function textOf(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}
