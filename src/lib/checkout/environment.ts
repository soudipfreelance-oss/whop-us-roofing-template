import { loadWhop, type WhopConstructor } from "@whop/elements";
import type { AttemptStorage } from "./charge-attempt";
import { cookieStorage, FRAMED_COOKIE } from "./cookie-storage";
import type { OrderLocks } from "./order-marks";
import {
	ORDER_COMPLETE_PATH,
	ORDER_PARAM,
	RETURN_TOKEN_PARAM,
	returnOriginOf,
	whopEnvironment,
} from "./shared";

const viteEnv: Record<string, string | undefined> = import.meta.env ?? {};

const ELEMENTS_SRC = viteEnv.VITE_WHOP_ELEMENTS_SRC;
export const ENVIRONMENT = whopEnvironment(viteEnv.VITE_WHOP_ENVIRONMENT);
// The order-complete page settles the order from this origin's own storage, so
// buyers return here. Only a dev build (Vite's `import.meta.env.DEV`) takes
// VITE_WHOP_RETURN_ORIGIN: Whop rejects a return URL that isn't HTTPS, except
// on a loopback host such as `localhost`.
export const RETURN_ORIGIN =
	import.meta.env?.DEV === true
		? returnOriginOf(viteEnv.VITE_WHOP_RETURN_ORIGIN)
		: undefined;

// Elements run in the browser only: server rendering hands the provider null. A
// local build named by VITE_WHOP_ELEMENTS_SRC goes on the page first, and
// loadWhop() takes it up instead of the release.
export function loadElements(): Promise<WhopConstructor> {
	if (ELEMENTS_SRC && !document.querySelector("script[data-whop-elements]")) {
		const script = document.createElement("script");
		script.src = ELEMENTS_SRC;
		script.async = true;
		script.setAttribute("data-whop-elements", "");
		document.head.append(script);
	}
	return loadWhop();
}

// The order's tag and the charge's return token ride the return URL, so the
// order-complete page in whichever tab of this browser the buyer comes back in
// (a bank app's new tab included) can mark the order paid and empty a cart
// holding exactly its lines. The store's own View your order link
// (`orderViewUrl`) carries no token, so it only shows the order, as does a
// link to the payment opened in any other browser.
export function returnUrl(order?: string, token?: string): string {
	if (typeof window === "undefined") return "";
	const url = new URL(
		`${RETURN_ORIGIN ?? window.location.origin}${ORDER_COMPLETE_PATH}`,
	);
	if (order) url.searchParams.set(ORDER_PARAM, order);
	if (token) url.searchParams.set(RETURN_TOKEN_PARAM, token);
	return url.toString();
}

// A charge attempt belongs to the tab that sent it; a paid order is the
// store's, so every tab of it sees one.
export const tabStorage = (): AttemptStorage => window.sessionStorage;
export const storeStorage = (): AttemptStorage => window.localStorage;
// What the store's server reads too (`cookie-storage.ts`): the currency pick.
export const storeCookies = (): AttemptStorage =>
	cookieStorage({
		read: () => document.cookie,
		write: (cookie) => {
			document.cookie = cookie;
		},
		attributes: window.top === window ? undefined : FRAMED_COOKIE,
	});

// The lock every tab of the store shares, or null where the browser has no Web
// Locks (`order-marks.ts` says what runs without them).
export function storeLocks(): OrderLocks | null {
	if (typeof navigator === "undefined" || !("locks" in navigator)) return null;
	return {
		// Async so TypeScript 5.9's lib.dom (whose `request` types a callback's
		// promise as `Promise<Promise<T>>`) and 6's both read it as `Promise<T>`.
		exclusive: async (name, run) =>
			navigator.locks.request(name, { mode: "exclusive" }, run),
	};
}
