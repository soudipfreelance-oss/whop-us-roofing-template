import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestHeader } from "./request.server";
import { requestCookies } from "./checkout/cookie-storage";
import { storeCookies } from "./checkout/environment";
import { storedPick } from "./checkout/quote-handover";

// The store's pick as this render sees it: the cookie the request carried on
// the server, the page's own in the browser, so both render the same picker.
export const currentPick = createIsomorphicFn()
	.server(() => storedPick(() => requestCookies(getRequestHeader("cookie"))))
	.client(() => storedPick(storeCookies));
