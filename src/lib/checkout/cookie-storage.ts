import type { AttemptStorage } from "./charge-attempt";

export type CookieJar = {
	read: () => string;
	write: (cookie: string) => void;
	attributes?: string;
};

// A cross-site frame (the dashboard's preview) gets no Lax cookie, set or
// sent; a partitioned one stays with that frame's top-level site.
export const FRAMED_COOKIE = "Secure; SameSite=None; Partitioned";

export function cookieValue(
	header: string | null | undefined,
	key: string,
): string | null {
	for (const part of (header ?? "").split(";")) {
		const separator = part.indexOf("=");
		if (separator === -1 || part.slice(0, separator).trim() !== key) continue;
		try {
			return decodeURIComponent(part.slice(separator + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

// A value every tab of the store shares and the store's server reads on each
// request, for as long as the browser session lasts: the storage a
// server-rendered page has to agree with.
export function cookieStorage(jar: CookieJar): AttemptStorage {
	return {
		getItem: (key) => cookieValue(jar.read(), key),
		setItem: (key, value) =>
			jar.write(
				`${key}=${encodeURIComponent(value)}; Path=/; ${jar.attributes ?? "SameSite=Lax"}`,
			),
		removeItem: (key) =>
			jar.write(
				`${key}=; Path=/; Max-Age=0; ${jar.attributes ?? "SameSite=Lax"}`,
			),
	};
}

export function requestCookies(
	header: string | null | undefined,
): AttemptStorage {
	return cookieStorage({ read: () => header ?? "", write: () => {} });
}
