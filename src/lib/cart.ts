import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";
import { CART_VERSION, type CartLine, migrateSavedCart } from "./cart-migrate";
import { lineQuantity } from "./checkout/order";
import { keepLinkCodes } from "./checkout/link-codes";
import { parseSearchAsText } from "./search-text";

export type { CartLine };

const CART_KEY = "storefront-cart";

export function cartChanged(key: string | null): boolean {
	return key === null || key === CART_KEY;
}

// The cart's storage never fails. Where the browser blocks localStorage (a
// private window, a site-data policy) any use of it throws, and zustand's
// `createJSONStorage` then gives no storage, so `persist` would leave its API
// off the store and every `useCartStore.persist` call would throw. From the
// first use that fails, the cart lives in this page's memory instead.
export function cartStorage(
	local: () => Storage = () => window.localStorage,
): StateStorage {
	const memory = new Map<string, string>();
	let blocked = false;
	const use = <T>(stored: (storage: Storage) => T, instead: () => T): T => {
		if (!blocked) {
			try {
				return stored(local());
			} catch {
				// Blocked, or full: this visit's memory holds the cart from here on.
				blocked = true;
			}
		}
		return instead();
	};
	return {
		getItem: (name) => {
			const saved = use(
				(storage) => storage.getItem(name),
				() => memory.get(name) ?? null,
			);
			return saved !== null && parses(saved) ? saved : null;
		},
		setItem: (name, value) =>
			use(
				(storage) => storage.setItem(name, value),
				() => {
					memory.set(name, value);
				},
			),
		removeItem: (name) =>
			use(
				(storage) => storage.removeItem(name),
				() => {
					memory.delete(name);
				},
			),
	};
}

// A saved cart that isn't JSON reads as none. zustand parses it inside the
// load, and a parse that throws leaves the load never finished.
function parses(saved: string): boolean {
	try {
		JSON.parse(saved);
		return true;
	} catch {
		// Not JSON: no saved cart.
		return false;
	}
}

// Told when the cart's load fails anyway (a migration that throws): zustand
// calls back with the error, but no finish listener.
const unreadable = new Set<() => void>();

export function onCartUnreadable(run: () => void): () => void {
	unreadable.add(run);
	return () => {
		unreadable.delete(run);
	};
}

type CartState = {
	lines: CartLine[];
	open: boolean;
	addLine: (line: CartLine) => void;
	removeLine: (planId: string) => void;
	setQuantity: (planId: string, quantity: number) => void;
	clear: () => void;
	openCart: () => void;
	closeCart: () => void;
};

// The one cart for the whole store. Pages, headers and drawers all read and
// write this store; a second cart store splits what the buyer added from what
// checkout charges.
export const useCartStore = create<CartState>()(
	persist(
		(set) => ({
			lines: [],
			open: false,
			addLine: (line) =>
				set((state) => {
					const added = lineQuantity(line.quantity);
					if (added < 1) return state;
					const existing = state.lines.find(
						(entry) => entry.planId === line.planId,
					);
					if (existing) {
						return {
							lines: state.lines.map((entry) =>
								entry.planId === line.planId
									? {
											...entry,
											quantity: lineQuantity(entry.quantity + added),
										}
									: entry,
							),
						};
					}
					return { lines: [...state.lines, { ...line, quantity: added }] };
				}),
			removeLine: (planId) =>
				set((state) => ({
					lines: state.lines.filter((entry) => entry.planId !== planId),
				})),
			setQuantity: (planId, quantity) =>
				set((state) => ({
					lines: state.lines
						.map((entry) =>
							entry.planId === planId
								? { ...entry, quantity: lineQuantity(quantity) }
								: entry,
						)
						.filter((entry) => entry.quantity > 0),
				})),
			clear: () => set({ lines: [] }),
			openCart: () => set({ open: true }),
			closeCart: () => set({ open: false }),
		}),
		{
			name: CART_KEY,
			version: CART_VERSION,
			migrate: migrateSavedCart,
			storage: createJSONStorage(() => cartStorage()),
			partialize: (state) => ({ lines: state.lines }),
			onRehydrateStorage: () => (_state, error) => {
				if (error) for (const run of unreadable) run();
			},
			// The server has no saved cart. Loading it before the first paint
			// would make the browser's cart differ from the server's HTML and
			// break hydration, so the root layout loads it after mounting.
			skipHydration: true,
		},
	),
);

// Every tab of the store saves the same cart: one paid and emptied in another
// tab empties here too. It starts with the module, not the root layout, which a
// reused site keeps as it was, and waits for the layout's first load of the
// cart so the page still matches its server HTML.
if (typeof window !== "undefined") {
	keepLinkCodes(
		parseSearchAsText(window.location.search),
		() => window.sessionStorage,
	);
	window.addEventListener("storage", (event) => {
		if (cartChanged(event.key) && useCartStore.persist.hasHydrated()) {
			void useCartStore.persist.rehydrate();
		}
	});
}
