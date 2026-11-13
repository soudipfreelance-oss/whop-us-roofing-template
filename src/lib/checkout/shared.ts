// Imports nothing: the tool server imports this module too, and must never pull
// in app code that can grow browser or Vite dependencies. A tool-server test
// holds it to that.

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Over the text's UTF-16 code units, as an unsigned 32-bit number.
export function fnv1a(text: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < text.length; index += 1) {
		hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
	}
	return hash >>> 0;
}

// The order-complete route's path (src/routes/order-complete.tsx). The return
// URL each charge sends, the server's check of it and the root layout all read
// this one value: a store that renames the route changes it here, or every
// charge is refused.
export const ORDER_COMPLETE_PATH = "/order-complete";

// The return URL's params: the order's tag, and the return token the browser
// that paid kept when its charge started (order-marks.ts `keepReturnToken`).
export const ORDER_PARAM = "order";
export const RETURN_TOKEN_PARAM = "rt";

export const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,64}$/;

export type WhopEnvironment = "sandbox" | "production";

// Read by the page and by the build check alike, so the two never disagree.
export function whopEnvironment(value: string | undefined): WhopEnvironment {
	return value === "sandbox" ? "sandbox" : "production";
}

export function returnOriginOf(value: string | undefined): string | undefined {
	return value?.trim().replace(/\/$/, "") || undefined;
}

// Whether an address is one the public internet routes to. The tool server's
// URL checks and the store's buyer IP use this one rule. No node:net, as it
// also runs in the Worker.
const IPV4 =
	/^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function publicIpv4(parts: readonly number[]): boolean {
	if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
		return false;
	}
	const [first = 0, second = 0, third = 0] = parts;
	if (first === 0 || first === 10 || first === 127 || first >= 224) {
		return false;
	}
	if (first === 100 && second >= 64 && second <= 127) return false;
	if (first === 169 && second === 254) return false;
	if (first === 172 && second >= 16 && second <= 31) return false;
	if (first === 192 && second === 0 && third === 0) return false;
	if (first === 192 && second === 0 && third === 2) return false;
	if (first === 192 && second === 168) return false;
	if (first === 198 && (second === 18 || second === 19)) return false;
	if (first === 198 && second === 51 && third === 100) return false;
	if (first === 203 && second === 0 && third === 113) return false;
	return true;
}

// The eight groups of an IPv6 address as the URL parser writes it, which turns
// a dotted IPv4 tail (`::ffff:1.2.3.4`) into hex like any other.
function ipv6Groups(address: string): number[] | null {
	if (!address.includes(":") || !/^[\da-f:.]+$/i.test(address)) return null;
	let host: string;
	try {
		host = new URL(`http://[${address}]/`).hostname.slice(1, -1);
	} catch {
		// Not an IPv6 address.
		return null;
	}
	const groups = (part: string) =>
		part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
	const [head = "", tail] = host.split("::");
	const left = groups(head);
	if (tail === undefined) return left;
	const right = groups(tail);
	const gap = Array.from({ length: 8 - left.length - right.length }, () => 0);
	return [...left, ...gap, ...right];
}

function ipv4Of(high: number, low: number): number[] {
	return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

// An address that carries an IPv4 one is judged by it: IPv4-compatible
// (::/96), -mapped (::ffff:0:0/96), -translated (::ffff:0:0:0/96), NAT64
// (64:ff9b::/96; the local-use 64:ff9b:1::/48 is never public), 6to4
// (2002::/16) and Teredo's client (2001::/32, stored inverted).
function publicIpv6(groups: readonly number[]): boolean {
	const [a = 0, b = 0, c = 0, , e = 0, f = 0, g = 0, h = 0] = groups;
	const zero = (from: number, to: number) =>
		groups.slice(from, to).every((group) => group === 0);
	if (zero(0, 6)) return publicIpv4(ipv4Of(g, h));
	if (zero(0, 5) && f === 0xffff) return publicIpv4(ipv4Of(g, h));
	if (zero(0, 4) && e === 0xffff && f === 0) return publicIpv4(ipv4Of(g, h));
	if (a === 0x64 && b === 0xff9b) return zero(2, 6) && publicIpv4(ipv4Of(g, h));
	if (a === 0x2002) return publicIpv4(ipv4Of(b, c));
	if (a === 0x2001 && b === 0) {
		return publicIpv4(ipv4Of(g ^ 0xffff, h ^ 0xffff));
	}
	if ((a & 0xfe00) === 0xfc00) return false;
	if ((a & 0xffc0) === 0xfe80 || (a & 0xffc0) === 0xfec0) return false;
	if ((a & 0xff00) === 0xff00) return false;
	return !(a === 0x2001 && b === 0x0db8);
}

export function publicIp(address: string): boolean {
	if (IPV4.test(address)) return publicIpv4(address.split(".").map(Number));
	const groups = ipv6Groups(address);
	return groups?.length === 8 && publicIpv6(groups);
}
